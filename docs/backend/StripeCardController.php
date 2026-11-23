<?php

namespace App\Controllers\Api;

use App\Controllers\BaseController;
use App\Models\UserModel;
use App\Models\FeeConfigModel;
use App\Models\TransactionModel;
use App\Models\ShiftSessionModel;
use App\Models\AuditLogModel;
use App\Libraries\UniversalCipher;
use App\Libraries\JWTLibrary;
use Config\SecureDatabase;
use Config\EncryptionKey;
use CodeIgniter\API\ResponseTrait;
use Stripe\StripeClient;

/**
 * Stripe Card & Terminal Payment API Controller
 * 
 * Handles Stripe card payment configuration, Stripe Terminal connection tokens,
 * and PaymentIntent creation for Tap to Pay and Manual Card entry.
 * 
 * Important Rules:
 * - Uses decrypted keys from config/SecureDatabase.php.
 * - Does not modify any existing controllers or database tables.
 * - PaymentIntent amount uses the user's exact input amount (no card fee calculation added).
 * - PCI-DSS SAQ-A Compliant: Tokenized paymentMethodId flow. Never processes or logs raw card numbers.
 */
class StripeCardController extends BaseController
{
    use ResponseTrait;

    protected UserModel $userModel;
    protected FeeConfigModel $feeConfigModel;
    protected TransactionModel $transactionModel;
    protected ShiftSessionModel $shiftModel;
    protected AuditLogModel $auditModel;
    protected $db;

    private ?string $cachedSecretKey = null;
    private ?string $cachedPublishableKey = null;
    private ?StripeClient $stripeClient = null;

    public function __construct()
    {
        $this->userModel        = new UserModel();
        $this->feeConfigModel   = new FeeConfigModel();
        $this->transactionModel = new TransactionModel();
        $this->shiftModel       = new ShiftSessionModel();
        $this->auditModel       = new AuditLogModel();
        $this->db               = \Config\Database::connect();
        helper(['url', 'form', 'email']);
    }

    /**
     * GET /api/stripe/card or POST /api/stripe/card
     * 
     * Returns:
     * - Stripe publishable key (decrypted from config/SecureDatabase.php)
     * - Stripe secret key (decrypted from config/SecureDatabase.php)
     * - card_charge_fee (from fee_configs based on user type logic)
     * - card_charge_fee_type (from fee_configs based on user type logic)
     */
    public function index()
    {
        return $this->getCardConfig();
    }

    /**
     * Retrieve Stripe card credentials and fee configuration
     * 
     * Handles forward calculation of payment_amount & fee_amount when amount is provided:
     * - Percentage: fee_amount = amount * (card_charge_fee / 100), payment_amount = amount + fee_amount
     * - Fixed:      fee_amount = card_charge_fee, payment_amount = amount + fee_amount
     * - other_business / other_business_employee: no fee calculation needed
     */
    public function getCardConfig()
    {
        // 1. Authenticate via Bearer Token (JWT Auth Filter payload or direct Authorization header)
        $authData = $this->request->authenticatedUser ?? null;
        if (!$authData) {
            $authHeader = $this->request->getHeaderLine('Authorization');
            if (!empty($authHeader) && preg_match('/Bearer\s(\S+)/', $authHeader, $matches)) {
                $jwtLib = new JWTLibrary();
                $decoded = $jwtLib->decodeToken($matches[1]);
                if ($decoded && !empty($decoded->data)) {
                    $authData = (array)$decoded->data;
                }
            }
        }

        $input = $this->getRequestInput();
        $currentUserId = (int)($authData['user_id'] ?? ($input['user_id'] ?? ($this->request->getGet('user_id') ?? 0)));

        if (!$currentUserId) {
            return $this->respond([
                'status'  => false,
                'message' => 'Unauthorized access. Invalid or missing token.'
            ], 200);
        }

        // 2. Fetch authenticated user record
        $currentUser = $this->userModel->find($currentUserId);
        if (!$currentUser) {
            return $this->respond([
                'status'  => false,
                'message' => 'Authenticated user not found.'
            ], 200);
        }

        if ((int)$currentUser['is_active'] !== 1) {
            return $this->respond([
                'status'  => false,
                'message' => 'Your account is deactivated. Please contact support.'
            ], 200);
        }

        // Support optional target user_id (if a parent business manager queries for a subordinate)
        $requestedUserId = (int)($input['user_id'] ?? ($this->request->getGet('user_id') ?? 0));

        $targetUser = $currentUser;
        if ($requestedUserId > 0 && $requestedUserId !== $currentUserId) {
            $requestedUser = $this->userModel->find($requestedUserId);
            if ($requestedUser && (int)($requestedUser['parent_id'] ?? 0) === $currentUserId) {
                $targetUser = $requestedUser;
            }
        }

        // 3. Determine user_type_key
        $userTypeKey = determineUserTypeKey($targetUser);

        // 4. Determine Fee User ID according to user_type_key rules:
        // - other_business          => logged-in user's ID
        // - other_business_employee => logged-in user's parent_id
        // - taxi_business           => logged-in user's ID
        // - taxi_owner              => logged-in user's ID
        // - taxi_business_driver    => logged-in user's parent_id
        switch ($userTypeKey) {
            case 'other_business_employee':
            case 'taxi_business_driver':
                $feeUserId = !empty($targetUser['parent_id']) ? (int)$targetUser['parent_id'] : (int)$targetUser['id'];
                break;

            case 'other_business':
            case 'taxi_business':
            case 'taxi_owner':
            default:
                $feeUserId = (int)$targetUser['id'];
                break;
        }

        // 5. Fetch fee configuration from fee_config_history / fee_configs table
        $targetDate = $input['transaction_date'] ?? ($input['date'] ?? date('Y-m-d H:i:s'));
        $feeLookupUserId = $feeUserId;
        $feeConfig = $this->feeConfigModel->getFeeConfigForDate($feeLookupUserId, $targetDate);

        // Fallback: check without is_active condition if not found
        if (!$feeConfig) {
            $feeConfig = $this->feeConfigModel
                ->where('user_id', $feeLookupUserId)
                ->where('is_active', 1)
                ->first() ?: $this->feeConfigModel->where('user_id', $feeLookupUserId)->first();
        }

        $isOtherBusinessType = in_array($userTypeKey, ['other_business', 'other_business_employee'], true);

        $cardChargeFee     = $isOtherBusinessType ? 0.00 : (float)($feeConfig['card_charge_fee'] ?? 0.00);
        $cardChargeFeeType = $feeConfig['card_charge_fee_type'] ?? 'percentage';

        // 6. Forward calculation of payment_amount & fee_amount if amount is provided
        $amountInput = $input['amount']
            ?? ($input['receipt_amount']
            ?? ($input['base_amount']
            ?? ($this->request->getPost('amount')
            ?? ($this->request->getPost('receipt_amount')
            ?? ($this->request->getGet('amount') 
            ?? ($this->request->getGet('receipt_amount') ?? null))))));

        $receiptAmount = null;
        $baseAmount    = null;
        $feeAmount     = null;

        if ($amountInput !== null && is_numeric($amountInput)) {
            $baseAmount = round((float)$amountInput, 2);

            if ($isOtherBusinessType) {
                // For other_business and other_business_employee, no surcharge calculation is needed
                $feeAmount     = 0.00;
                $receiptAmount = $baseAmount;
            } else {
                // For taxi accounts (taxi_business, taxi_owner, taxi_business_driver), apply forward calculation:
                // payment_amount = base_amount + fee_amount (e.g. 100 + 100 * 4% = 104)
                $feeType = strtolower(trim((string)$cardChargeFeeType));

                if ($feeType === 'fixed') {
                    $feeAmount = round($cardChargeFee, 2);
                } else {
                    // Percentage calculation: fee_amount = (base_amount * card_charge_fee) / 100
                    $feeAmount = round(($baseAmount * $cardChargeFee) / 100, 2);
                }

                $receiptAmount = round($baseAmount + $feeAmount, 2);
            }
        }

        // 7. Format single consolidated API response
        return $this->respond([
            'status'                 => true,
            'message'                => 'Payment Fee retrieved successfully',
            'data'                   => [
                'card_charge_fee'        => $cardChargeFee,
                'card_charge_fee_type'   => $cardChargeFeeType,
                'user_id'                => (int)$targetUser['id'],
                'user_type_key'          => $userTypeKey,
                'payment_amount'         => $receiptAmount,
                'base_amount'            => $baseAmount,
                'card_charge_fee_amount' => $feeAmount, 
            ]
        ], 200);
    }

    /**
     * GET /api/terminal_config or /api/payment/terminal-config
     * 
     * Retrieves Stripe Terminal default location ID and publishable key.
     */
    public function terminalConfig()
    {
        $stripe = $this->getStripeClient();
        $publishableKey = $this->getStripePublishableKey() ?? '';
        $isConfigured = !empty($this->getStripeSecretKey());

        if (!$stripe) {
            return $this->respond([
                'locationId'       => 'loc_simulated',
                'publishableKey'   => $publishableKey,
                'stripeConfigured' => false
            ], 200);
        }

        try {
            $locationId = $this->getOrCreateLocation($stripe);
            return $this->respond([
                'locationId'       => $locationId ?: 'loc_simulated',
                'publishableKey'   => $publishableKey,
                'stripeConfigured' => $isConfigured
            ], 200);
        } catch (\Throwable $e) {
            return $this->respond([
                'locationId'       => 'loc_simulated',
                'publishableKey'   => $publishableKey,
                'stripeConfigured' => false
            ], 200);
        }
    }

    /**
     * POST /api/payment/connection-token
     */
    public function connectionToken()
    {
        $stripe = $this->getStripeClient();
        if (!$stripe) {
            return $this->respond([
                'status' => false,
                'error'  => 'STRIPE_SECRET_KEY is not configured in database'
            ], 500);
        }

        try {
            $locationId  = $this->getOrCreateLocation($stripe);
            $tokenParams = $locationId ? ['location' => $locationId] : [];
            $token       = $stripe->terminal->connectionTokens->create($tokenParams);

            // Note: Stripe Terminal SDK specifically inspects the root key 'secret'
            return $this->respond([
                'status'     => true,
                'secret'     => $token->secret,
                'locationId' => $locationId
            ], 200);
        } catch (\Throwable $err) {
            log_message('error', 'Error creating connection token: ' . $err->getMessage());
            return $this->respond([
                'status' => false,
                'error'  => $err->getMessage()
            ], 500);
        }
    }

    /**
     * POST /payment/create-intent or /create_payment_intent or /api/payment/create-intent
     * 
     * Creates a Stripe PaymentIntent using the user's input amount (NO fee calculation added).
     * 
     * Request Body for Card:
     * {
     *   "amount": 100.50,
     *   "currency": "aud",
     *   "paymentMethodType": "card",
     *   "paymentMethodId": "pm_1Oxxxxxxxxxxxxxxxxxxxx",  // Tokenized directly by mobile app
     *   "cardLast4": "4242",                             // Safe display info
     *   "cardBrand": "Visa",                             // Safe display info
     *   "shift_session_id": 123
     * }
     * 
     * Request Body for Tap to Pay:
     * {
     *   "amount": 100.50,
     *   "currency": "aud",
     *   "paymentMethodType": "tap",
     *   "shift_session_id": 123
     * }
     */
    public function createPaymentIntent()
    {
        $stripe = $this->getStripeClient();
        if (!$stripe) {
            return $this->respond([
                'error' => 'STRIPE_SECRET_KEY is not configured in database'
            ], 500);
        }

        $input = $this->getRequestInput();

        $amount            = (float)($input['amount'] ?? 0);
        $currency          = strtolower(preg_replace('/[^a-z]/i', '', (string)($input['currency'] ?? 'aud'))) ?: 'aud';
        $paymentMethodType = strtolower((string)($input['paymentMethodType'] ?? ($input['payment_method_type'] ?? 'tap')));

        if (!$amount || $amount <= 0) {
            return $this->respond(['error' => 'Invalid amount provided'], 400);
        }

        // Resolve User and Shift Session safely (strictly for logged-in user)
        [$userId, $shiftSessionId] = $this->resolveUserIdAndShift($input);
        if ($userId <= 0) {
            return $this->respond([
                'status'  => false,
                'message' => 'Unauthorized access. Please log in to process transactions.'
            ], 401);
        }

        if ($shiftSessionId <= 0) {
            return $this->respond([
                'status'  => false,
                'message' => 'No active open shift found for your account. Please start a shift first.'
            ], 400);
        }
        $targetUser = $userId > 0 ? $this->userModel->find($userId) : null;
        $userTypeKey = !empty($input['user_type_key']) ? (string)$input['user_type_key'] : ($targetUser ? determineUserTypeKey($targetUser) : '');

        $rawPickupId = $input['pickup_id'] ?? ($input['pickupId'] ?? null);
        $rawDropupId = $input['dropup_id'] ?? ($input['dropupId'] ?? ($input['drop_id'] ?? ($input['dropoff_id'] ?? null)));

        $pickupId = ($rawPickupId !== null && $rawPickupId !== '') ? (int)$rawPickupId : null;
        $dropupId = ($rawDropupId !== null && $rawDropupId !== '') ? (int)$rawDropupId : null;

        $rawpickup_location = $input['pickup_location'] ?? ($input['pickuplocation'] ?? null);
        $rawdropup_location = $input['dropup_location'] ?? ($input['dropuplocation'] ?? ($input['droplocation'] ?? ($input['dropofflocation'] ?? null)));

        $pickup_location = ($rawpickup_location !== null && trim((string)$rawpickup_location) !== '') ? trim((string)$rawpickup_location) : null;
        $dropup_location = ($rawdropup_location !== null && trim((string)$rawdropup_location) !== '') ? trim((string)$rawdropup_location) : null;

        // Convert decimal dollars to integer cents (e.g. $25.50 -> 2550 cents)
        $amountInCents = (int)round($amount * 100);

        // Common parameters
        $description        = 'SE PAY - ' . ($paymentMethodType === 'tap' ? 'Tap to Pay' : 'Card Entry');
        $maskedCard         = '****';
        $cardType           = 'Card';
        $paymentMethodIdInt = ($paymentMethodType === 'tap') ? 1 : 2;

        try {
            if ($paymentMethodType === 'card') {
                // --- MANUAL CARD FLOW (TOKENIZED VIA STRIPE CLIENT SDK) ---
                $paymentMethodId = $input['paymentMethodId'] 
                    ?? ($input['payment_method_id'] 
                    ?? ($input['token'] 
                    ?? ($input['card']['token'] ?? null)));

                // 1. Enforce that card was tokenized by the mobile app (PCI-DSS SAQ-A requirement)
                if (empty($paymentMethodId)) {
                    return $this->respond([
                        'status' => false,
                        'error'  => 'Missing paymentMethodId. Card must be securely tokenized with Stripe before creating payment intent.'
                    ], 400);
                }

                // 2. Resolve safe display metadata (last4 and brand) from app payload
                if (!empty($input['cardLast4'])) {
                    $maskedCard = '**** **** **** ' . preg_replace('/\D/', '', (string)$input['cardLast4']);
                }
                if (!empty($input['cardBrand'])) {
                    $cardType = ucfirst(trim((string)$input['cardBrand']));
                }

                // 3. Confirm card details dynamically from Stripe PaymentMethod object
                try {
                    $pmObj = $stripe->paymentMethods->retrieve($paymentMethodId);
                    if ($pmObj && $pmObj->card && !empty($pmObj->card->last4)) {
                        $maskedCard = '**** **** **** ' . $pmObj->card->last4;
                        $cardType   = ucfirst($pmObj->card->brand ?? $cardType);
                    }
                } catch (\Throwable $pmEx) {
                    log_message('info', '[StripeCardController] PaymentMethod details resolved from payload metadata: ' . $pmEx->getMessage());
                }

                // 4. Create and immediately confirm PaymentIntent with the tokenized payment_method
                $returnUrl = $input['return_url'] ?? base_url('api/payment/return');

                $params = [
                    'amount'         => $amountInCents,
                    'currency'       => $currency,
                    'capture_method' => 'automatic',
                    'description'    => $description,
                    'payment_method' => $paymentMethodId,
                    'confirm'        => true,
                    'return_url'     => $returnUrl,
                ];

                $paymentIntent = $stripe->paymentIntents->create($params);

            } else {
                // --- TAP TO PAY (NFC) FLOW ---
                $maskedCard = 'Tap & Go';
                $cardType   = 'Contactless';

                try {
                    // Modern Stripe API: allowed_payment_method_types for Stripe Terminal (Tap to Pay / card_present)
                    $paymentIntent = $stripe->paymentIntents->create([
                        'amount'                       => $amountInCents,
                        'currency'                     => $currency,
                        'allowed_payment_method_types' => ['card_present'],
                        'capture_method'               => 'automatic',
                        'description'                  => $description,
                    ]);
                } catch (\Throwable $tapErr) {
                    try {
                        // Legacy Stripe API fallback
                        $paymentIntent = $stripe->paymentIntents->create([
                            'amount'               => $amountInCents,
                            'currency'             => $currency,
                            'payment_method_types' => ['card_present'],
                            'capture_method'       => 'automatic',
                            'description'          => $description,
                        ]);
                    } catch (\Throwable $legacyErr) {
                        // Dynamic payment methods fallback with allow_redirects => never (required by Terminal SDK)
                        $paymentIntent = $stripe->paymentIntents->create([
                            'amount'                    => $amountInCents,
                            'currency'                  => $currency,
                            'capture_method'            => 'automatic',
                            'description'               => $description,
                            'automatic_payment_methods' => [
                                'enabled'         => true,
                                'allow_redirects' => 'never'
                            ]
                        ]);
                    }
                }
            }

            // Extract card details if available from latest charge
            if (!empty($paymentIntent->latest_charge)) {
                try {
                    $chargeObj = is_string($paymentIntent->latest_charge) 
                        ? $stripe->charges->retrieve($paymentIntent->latest_charge) 
                        : $paymentIntent->latest_charge;

                    $cDetails = $chargeObj->payment_method_details->card_present ?? ($chargeObj->payment_method_details->card ?? null);
                    if ($cDetails && !empty($cDetails->last4)) {
                        $maskedCard = '**** **** **** ' . $cDetails->last4;
                        if (!empty($cDetails->brand)) {
                            $cardType = ucfirst($cDetails->brand);
                        }
                    }
                } catch (\Throwable $chErr) {}
            }

            // Determine status
            if ($paymentIntent->status === 'succeeded') {
                $paymentStatus = 'success';
                $isSuccess     = true;
            } elseif (in_array($paymentIntent->status, ['canceled', 'failed'], true)) {
                $paymentStatus = 'failed';
                $isSuccess     = false;
            } else {
                $paymentStatus = 'pending';
                $isSuccess     = false;
            }

            // Extract remarks reason from Stripe gateway response for pending or failed transactions
            $remarksReason = $this->resolveRemarksReason($paymentIntent, $paymentStatus);

            // Resolve User and Shift Session safely
            [$userId, $shiftSessionId] = $this->resolveUserIdAndShift($input);
            $locationId = $input['terminal_id'] ?? ($input['locationId'] ?? ($input['location_id'] ?? null));

            // Generate unique transaction reference
            $txnId = $this->transactionModel->generateTransactionId('TXN');
            $approvalCode = $isSuccess ? (string)rand(100000, 999999) : null;

            // Extract service_charges if provided
            $serviceCharges = $input['service_charges'] ?? ($input['service_fee'] ?? null);
            if ($serviceCharges !== null && $serviceCharges !== '') {
                $serviceFee   = (float)$serviceCharges;
                $driverPayout = max(0.00, round($amount - $serviceFee, 2));
            } else {
                $serviceFee = 0.00;
                $driverPayout = max(0.00, round($amount - $serviceFee, 2));
            }

            $currentUser = $this->userModel->find($userId);
            $companyId = (!empty($currentUser['parent_id']) && (int)$currentUser['parent_id'] > 0) 
                ? (int)$currentUser['parent_id'] 
                : null;

            // INSERT RECORD IN TRANSACTIONS TABLE (Zero raw card numbers stored)
            $txnInsertData = [
                'transaction_id'         => $txnId,
                'shift_session_id'       => $shiftSessionId,
                'user_id'                => $userId,
                'company_id'             => $companyId,
                'pickup_id'              => $pickupId,
                'dropup_id'              => $dropupId,
                'pickup_location'        => $pickup_location,
                'dropup_location'        => $dropup_location,
                'transaction_date'       => date('Y-m-d H:i:s'),
                'statement_date'         => date('Y-m-d'),
                'amount'                 => $amount,
                'service_fee'            => $serviceFee,
                'driver_payout'          => $driverPayout,
                'request_payload'        => '',
                'payment_status'         => $paymentStatus,
                'remarks'                => $remarksReason,
                'terminal_id'            => $locationId,
                'card_number'            => $maskedCard,
                'card_type'              => $cardType,
                'account_type'           => $paymentMethodType === 'tap' ? 'TAP' : 'CRD',
                'approval_code'          => $approvalCode,
                'gateway_name'           => 'Stripe',
                'gateway_transaction_id' => $paymentIntent->id,
                'gateway_response'       => json_encode($paymentIntent->toArray()),
                'payment_method_id'      => $paymentMethodIdInt,
                'created_by'             => $userId
            ];

            $newTxnId = $this->transactionModel->insert($txnInsertData);

            // Direct DB safeguard to ensure fields are populated
            if ($newTxnId) {
                $directUpdates = [];
                if ($pickupId !== null) $directUpdates['pickup_id'] = $pickupId;
                if ($dropupId !== null) $directUpdates['dropup_id'] = $dropupId;
                if ($pickup_location !== null) $directUpdates['pickup_location'] = $pickup_location;
                if ($dropup_location !== null) $directUpdates['dropup_location'] = $dropup_location;
                if ($companyId !== null) $directUpdates['company_id'] = $companyId;
                if ($remarksReason !== null) $directUpdates['remarks'] = $remarksReason;

                if (!empty($directUpdates)) {
                    $this->db->table('transactions')->where('id', $newTxnId)->update($directUpdates);
                }
            }

            // If success immediately, update shift totals
            if ($isSuccess) {
                $this->shiftModel->recalculateTotals($shiftSessionId);
            }

            // Record in audit_logs table
            $this->auditModel->insert([
                'user_id'    => $userId,
                'action'     => $isSuccess ? 'TRANSACTION_RECORDED' : 'STRIPE_PAYMENT_INITIATED',
                'module'     => 'TRANSACTIONS',
                'record_id'  => $newTxnId,
                'old_data'   => null,
                'new_data'   => json_encode([
                    'transaction_id'         => $txnId,
                    'gateway_transaction_id' => $paymentIntent->id,
                    'amount'                 => $amount,
                    'service_fee'            => $serviceFee,
                    'card_number'            => $maskedCard,
                    'card_type'              => $cardType,
                    'payment_status'         => $paymentStatus,
                    'shift_session_id'       => $shiftSessionId
                ]),
                'ip_address' => $this->request->getIPAddress(),
                'user_agent' => $this->request->getUserAgent()->getAgentString(),
                'created_by' => $userId
            ]);

            // System log (Safe: only masked card logged)
            log_message('info', "[StripeCardController] PaymentIntent {$paymentIntent->id} for \${$amount} recorded: Txn {$txnId} (ID: {$newTxnId}), Status: '{$paymentStatus}', Masked Card: '{$maskedCard}'.");

            $requiresAction = ($paymentIntent->status === 'requires_action');
            $redirectUrl = $requiresAction 
                ? ($paymentIntent->next_action->redirect_to_url->url ?? ($paymentIntent->next_action->use_stripe_sdk->stripe_js ?? null))
                : null;

            // Return exact JSON required by mobile app
            return $this->respond([
                'requiresAction'  => $requiresAction,
                'clientSecret'    => $paymentIntent->client_secret,
                'paymentIntentId' => $paymentIntent->id,
                'amount'          => $paymentIntent->amount,
                'amountInDollars' => round($paymentIntent->amount / 100, 2),
                'formattedAmount' => '$' . number_format($paymentIntent->amount / 100, 2) . ' ' . strtoupper($paymentIntent->currency),
                'currency'        => $paymentIntent->currency,
                'status'          => $paymentIntent->status,
                'redirectUrl'     => $redirectUrl,
            ], 200);

        } catch (\Throwable $e) {
            log_message('error', '[StripeCardController] Error creating payment intent: ' . $e->getMessage());
            return $this->respond(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * GET /payment_intent/{id} or /api/payment/payment-intent/{id}
     * Also supports POST /payment_intent/{id} or POST with id in body
     * 
     * Used by the mobile app to verify if a transaction succeeded after Tap to Pay or 3D Secure redirect.
     */
    public function getPaymentIntentStatus($id = null)
    {
        $stripe = $this->getStripeClient();
        if (!$stripe) {
            return $this->respond(['error' => 'STRIPE_SECRET_KEY is not configured'], 500);
        }

        $id = $id ?: ($this->request->getGet('id') 
            ?: ($this->request->getPost('id') 
            ?: ($this->request->getJsonVar('id') 
            ?? ($this->request->getJsonVar('paymentIntentId') 
            ?? ($this->request->getJsonVar('payment_intent_id') ?? null)))));

        if (empty($id)) {
            return $this->respond(['error' => 'PaymentIntent ID is required'], 400);
        }

        try {
            $paymentIntent = $stripe->paymentIntents->retrieve($id, [
                'expand' => ['latest_charge', 'payment_method']
            ]);

            // Synchronize transaction status and card details in database
            $this->syncTransactionWithPaymentIntent($paymentIntent);

            $requiresAction = ($paymentIntent->status === 'requires_action');
            $redirectUrl = $requiresAction 
                ? ($paymentIntent->next_action->redirect_to_url->url ?? ($paymentIntent->next_action->use_stripe_sdk->stripe_js ?? null))
                : null;

            return $this->respond([
                'id'              => $paymentIntent->id,
                'status'          => $paymentIntent->status,
                'requiresAction'  => $requiresAction,
                'amount'          => $paymentIntent->amount,
                'amountInDollars' => round($paymentIntent->amount / 100, 2),
                'formattedAmount' => '$' . number_format($paymentIntent->amount / 100, 2) . ' ' . strtoupper($paymentIntent->currency),
                'currency'        => $paymentIntent->currency,
                'redirectUrl'     => $redirectUrl,
            ], 200);

        } catch (\Throwable $e) {
            log_message('error', '[StripeCardController] Error in getPaymentIntentStatus: ' . $e->getMessage());
            return $this->respond(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * POST /api/payment/stripe-webhook
     * POST /api/stripe/webhook
     * 
     * Authoritative Stripe Webhook endpoint.
     */
    public function webhook()
    {
        if ($this->request->getMethod() === 'GET') {
            return $this->respond([
                'status'  => true,
                'message' => 'Stripe Webhook endpoint is active and listening for POST events.'
            ], 200);
        }

        $payload       = (string)$this->request->getBody();
        $sigHeader     = $this->request->getHeaderLine('Stripe-Signature');
        $webhookSecret = $this->getStripeWebhookSecret();

        $stripe = $this->getStripeClient();
        if (!$stripe) {
            log_message('error', '[StripeCardController] Webhook received but Stripe client is not configured.');
            return $this->respond(['error' => 'Stripe is not configured in database'], 500);
        }

        $event = null;

        if (!empty($webhookSecret) && !empty($sigHeader)) {
            try {
                $event = \Stripe\Webhook::constructEvent($payload, $sigHeader, $webhookSecret);
            } catch (\Stripe\Exception\SignatureVerificationException $e) {
                log_message('error', '[StripeCardController] Webhook signature verification failed: ' . $e->getMessage());
                return $this->respond(['error' => 'Invalid webhook signature: ' . $e->getMessage()], 400);
            } catch (\Throwable $e) {
                log_message('error', '[StripeCardController] Webhook payload error: ' . $e->getMessage());
                return $this->respond(['error' => 'Invalid webhook payload: ' . $e->getMessage()], 400);
            }
        } else {
            $eventData = json_decode($payload, true);
            if (!is_array($eventData) || empty($eventData['type'])) {
                log_message('error', '[StripeCardController] Webhook received invalid JSON payload.');
                return $this->respond(['error' => 'Invalid JSON payload'], 400);
            }
            $event = $eventData;
        }

        $eventType = is_object($event) ? ($event->type ?? '') : ($event['type'] ?? '');
        log_message('info', "[StripeCardController] Stripe Webhook event received: {$eventType}");

        switch ($eventType) {
            case 'payment_intent.succeeded':
            case 'payment_intent.payment_failed':
            case 'payment_intent.canceled':
                $eventObj = is_object($event) ? ($event->data->object ?? null) : ($event['data']['object'] ?? null);
                $paymentIntentId = is_object($eventObj) ? ($eventObj->id ?? null) : ($eventObj['id'] ?? null);

                if (!empty($paymentIntentId)) {
                    try {
                        $paymentIntent = $stripe->paymentIntents->retrieve($paymentIntentId, [
                            'expand' => ['latest_charge', 'payment_method']
                        ]);

                        $this->syncTransactionWithPaymentIntent($paymentIntent);
                    } catch (\Throwable $e) {
                        log_message('error', "[StripeCardController] Webhook error synchronizing PaymentIntent {$paymentIntentId}: " . $e->getMessage());
                    }
                }
                break;

            case 'charge.refunded':
                $eventObj = is_object($event) ? ($event->data->object ?? null) : ($event['data']['object'] ?? null);
                $paymentIntentId = is_object($eventObj) ? ($eventObj->payment_intent ?? null) : ($eventObj['payment_intent'] ?? null);

                if (!empty($paymentIntentId)) {
                    $txn = $this->transactionModel->where('gateway_transaction_id', $paymentIntentId)->first();
                    if ($txn && $txn['payment_status'] !== 'refunded') {
                        $this->transactionModel->update($txn['id'], [
                            'payment_status' => 'refunded',
                            'updated_ts'     => date('Y-m-d H:i:s'),
                            'updated_by'     => $txn['user_id']
                        ]);
                        if (!empty($txn['shift_session_id'])) {
                            $this->shiftModel->recalculateTotals($txn['shift_session_id']);
                        }
                        log_message('info', "[StripeCardController] Webhook: PaymentIntent {$paymentIntentId} marked refunded.");
                    }
                }
                break;

            default:
                log_message('info', "[StripeCardController] Webhook unhandled event type: {$eventType}");
                break;
        }

        return $this->respond([
            'status'   => true,
            'received' => true,
            'event'    => $eventType
        ], 200);
    }

    /**
     * Resolve actual reason for pending or failed transaction status from Stripe gateway response.
     */
    protected function resolveRemarksReason($paymentIntent, string $paymentStatus): ?string
    {
        if ($paymentStatus === 'success') {
            return null;
        }

        $piStatus = is_object($paymentIntent) 
            ? ($paymentIntent->status ?? '') 
            : ($paymentIntent['status'] ?? '');

        $lastError = is_object($paymentIntent) 
            ? ($paymentIntent->last_payment_error ?? null) 
            : ($paymentIntent['last_payment_error'] ?? null);

        if (!empty($lastError)) {
            $msg = is_object($lastError) 
                ? ($lastError->message ?? null) 
                : ($lastError['message'] ?? null);
            if (!empty($msg) && is_string($msg) && trim($msg) !== '') {
                return trim($msg);
            }

            $declineCode = is_object($lastError) 
                ? ($lastError->decline_code ?? null) 
                : ($lastError['decline_code'] ?? null);
            if (!empty($declineCode) && is_string($declineCode)) {
                return 'Card declined: ' . ucwords(str_replace('_', ' ', trim($declineCode)));
            }

            $code = is_object($lastError) 
                ? ($lastError->code ?? null) 
                : ($lastError['code'] ?? null);
            if (!empty($code) && is_string($code)) {
                return 'Payment error: ' . ucwords(str_replace('_', ' ', trim($code)));
            }
        }

        $charge = is_object($paymentIntent) 
            ? ($paymentIntent->latest_charge ?? null) 
            : ($paymentIntent['latest_charge'] ?? null);

        if (!empty($charge)) {
            $failMsg = is_object($charge) 
                ? ($charge->failure_message ?? null) 
                : ($charge['failure_message'] ?? null);
            if (!empty($failMsg) && is_string($failMsg) && trim($failMsg) !== '') {
                return trim($failMsg);
            }

            $sellerMsg = is_object($charge) 
                ? ($charge->outcome->seller_message ?? null) 
                : ($charge['outcome']['seller_message'] ?? null);
            if (!empty($sellerMsg) && is_string($sellerMsg) && trim($sellerMsg) !== '') {
                return trim($sellerMsg);
            }

            $outcomeReason = is_object($charge) 
                ? ($charge->outcome->reason ?? null) 
                : ($charge['outcome']['reason'] ?? null);
            if (!empty($outcomeReason) && is_string($outcomeReason)) {
                return ucwords(str_replace('_', ' ', trim($outcomeReason)));
            }
        }

        $cancellationReason = is_object($paymentIntent) 
            ? ($paymentIntent->cancellation_reason ?? null) 
            : ($paymentIntent['cancellation_reason'] ?? null);

        if (!empty($cancellationReason) && is_string($cancellationReason)) {
            return 'Payment canceled: ' . ucwords(str_replace('_', ' ', trim($cancellationReason)));
        }

        if ($paymentStatus === 'failed' || $piStatus === 'canceled') {
            return 'Payment failed';
        }

        if ($paymentStatus === 'pending') {
            switch ($piStatus) {
                case 'requires_payment_method':
                    return 'Awaiting payment method';
                case 'requires_action':
                    return 'Requires customer authentication';
                case 'requires_confirmation':
                    return 'Awaiting payment confirmation';
                case 'requires_capture':
                    return 'Awaiting payment capture';
                case 'processing':
                    return 'Processing payment';
                default:
                    return !empty($piStatus) ? ucwords(str_replace('_', ' ', (string)$piStatus)) : 'Processing';
            }
        }

        return null;
    }

    /**
     * Synchronize a database transaction with a Stripe PaymentIntent object.
     */
    protected function syncTransactionWithPaymentIntent($paymentIntent): ?array
    {
        $id = is_object($paymentIntent) ? ($paymentIntent->id ?? null) : ($paymentIntent['id'] ?? null);
        if (empty($id)) {
            return null;
        }

        $txn = $this->transactionModel->where('gateway_transaction_id', $id)->first();
        if (!$txn) {
            log_message('warning', "[StripeCardController] syncTransaction: No transaction record found for PaymentIntent {$id}");
            return null;
        }

        $piStatus = is_object($paymentIntent) ? ($paymentIntent->status ?? '') : ($paymentIntent['status'] ?? '');
        $currentStatus = $txn['payment_status'];
        $newStatus = ($piStatus === 'succeeded') ? 'success' : 
                     (in_array($piStatus, ['canceled', 'failed']) ? 'failed' : $currentStatus);

        $lastError = is_object($paymentIntent) ? ($paymentIntent->last_payment_error ?? null) : ($paymentIntent['last_payment_error'] ?? null);
        if ($piStatus === 'requires_payment_method' && !empty($lastError)) {
            $newStatus = 'failed';
        }

        $remarksReason = $this->resolveRemarksReason($paymentIntent, $newStatus);

        $updateData = [];
        if ($newStatus !== $currentStatus) {
            $updateData['payment_status'] = $newStatus;
            $updateData['updated_ts']     = date('Y-m-d H:i:s');
            $updateData['updated_by']     = $txn['user_id'];
            if ($newStatus === 'success' && empty($txn['approval_code'])) {
                $updateData['approval_code'] = (string)rand(100000, 999999);
            }
        }

        if ($newStatus === 'success') {
            if (!empty($txn['remarks'])) {
                $updateData['remarks'] = null;
            }
        } elseif (!empty($remarksReason) && ($txn['remarks'] ?? null) !== $remarksReason) {
            $updateData['remarks'] = $remarksReason;
        }

        $charge = is_object($paymentIntent) ? ($paymentIntent->latest_charge ?? null) : ($paymentIntent['latest_charge'] ?? null);
        
        $cardDetails = null;
        if (is_object($charge)) {
            $cardDetails = $charge->payment_method_details->card_present ?? 
                           ($charge->payment_method_details->card ?? 
                           ($paymentIntent->payment_method->card ?? null));
        } elseif (is_array($charge)) {
            $cardDetails = $charge['payment_method_details']['card_present'] ?? 
                           ($charge['payment_method_details']['card'] ?? 
                           ($paymentIntent['payment_method']['card'] ?? null));
        }

        $last4 = is_object($cardDetails) ? ($cardDetails->last4 ?? null) : ($cardDetails['last4'] ?? null);
        $brand = is_object($cardDetails) ? ($cardDetails->brand ?? null) : ($cardDetails['brand'] ?? null);

        if (!empty($last4)) {
            $masked = '**** **** **** ' . $last4;
            if (empty($txn['card_number']) || in_array($txn['card_number'], ['****', 'Tap & Go', 'Pending Tap'])) {
                $updateData['card_number'] = $masked;
            }
            if (!empty($brand) && (empty($txn['card_type']) || in_array($txn['card_type'], ['Contactless', 'Card']))) {
                $updateData['card_type'] = ucfirst($brand);
            }
        }

        $gatewayResponse = is_object($paymentIntent) && method_exists($paymentIntent, 'toArray') 
            ? $paymentIntent->toArray() 
            : $paymentIntent;
        $updateData['gateway_response'] = json_encode($gatewayResponse);

        if (!empty($updateData)) {
            $this->transactionModel->update($txn['id'], $updateData);
            $this->db->table('transactions')->where('id', $txn['id'])->update($updateData);

            if ($newStatus === 'success' && !empty($txn['shift_session_id'])) {
                $this->shiftModel->recalculateTotals($txn['shift_session_id']);
            }

            $this->auditModel->insert([
                'user_id'    => $txn['user_id'],
                'action'     => 'TRANSACTION_STATUS_UPDATED',
                'module'     => 'TRANSACTIONS',
                'record_id'  => $txn['id'],
                'old_data'   => json_encode(['payment_status' => $currentStatus, 'card_number' => $txn['card_number']]),
                'new_data'   => json_encode([
                    'payment_status' => $newStatus,
                    'card_number'    => $updateData['card_number'] ?? $txn['card_number']
                ]),
                'ip_address' => $this->request->getIPAddress(),
                'user_agent' => $this->request->getUserAgent()->getAgentString(),
                'created_by' => $txn['user_id']
            ]);

            log_message('info', "[StripeCardController] PaymentIntent {$id} synchronized: Transaction {$txn['transaction_id']} (ID: {$txn['id']}) updated from '{$currentStatus}' to '{$newStatus}'.");
        }

        return array_merge($txn, $updateData);
    }

    /**
     * Resolve user ID and shift session ID strictly for the logged-in user.
     */
    private function resolveUserIdAndShift(array $input): array
    {
        $authData = $this->request->authenticatedUser ?? null;
        $userId = 0;

        if ($authData && !empty($authData['user_id'])) {
            $userId = (int)$authData['user_id'];
        } elseif ($authData && !empty($authData['id'])) {
            $userId = (int)$authData['id'];
        } elseif (!empty($this->request)) {
            $authHeader = $this->request->getHeaderLine('Authorization');
            if (!empty($authHeader) && preg_match('/Bearer\s+(\S+)/i', $authHeader, $matches)) {
                $decoded = (new \App\Libraries\JWTLibrary())->decodeToken($matches[1]);
                if ($decoded) {
                    $tokenData = (array)($decoded->data ?? []);
                    $userId = (int)($tokenData['user_id'] ?? ($tokenData['id'] ?? ($decoded->sub ?? 0)));
                }
            }
        }

        if ($userId <= 0) {
            $userId = (int)($input['user_id'] ?? ($input['userId'] ?? 0));
        }

        if ($userId <= 0) {
            return [0, 0];
        }

        $shiftSessionId = (int)($input['shift_session_id'] ?? ($input['shift_id'] ?? 0));

        if ($shiftSessionId > 0) {
            $shift = $this->shiftModel
                ->where('id', $shiftSessionId)
                ->where('user_id', $userId)
                ->first();

            if (!$shift) {
                $userOpenShift = $this->shiftModel
                    ->where('user_id', $userId)
                    ->where('status', 'open')
                    ->orderBy('id', 'DESC')
                    ->first();
                $shiftSessionId = $userOpenShift ? (int)$userOpenShift['id'] : 0;
            }
        } else {
            $userOpenShift = $this->shiftModel
                ->where('user_id', $userId)
                ->where('status', 'open')
                ->orderBy('id', 'DESC')
                ->first();
            $shiftSessionId = $userOpenShift ? (int)$userOpenShift['id'] : 0;
        }

        return [$userId, $shiftSessionId];
    }

    /**
     * Mask credit card number (e.g. **** **** **** 4242)
     */
    private function formatMaskedCard(?string $cardNumber): string
    {
        if (empty($cardNumber)) {
            return '****';
        }
        $clean = preg_replace('/\D/', '', $cardNumber);
        if (strlen($clean) < 4) {
            return '****';
        }
        return '**** **** **** ' . substr($clean, -4);
    }

    private function detectCardBrand(string $number): string
    {
        $clean = preg_replace('/\D/', '', $number);
        if (str_starts_with($clean, '4')) return 'Visa';
        if (preg_match('/^(5[1-5]|2[2-7])/', $clean)) return 'Mastercard';
        if (preg_match('/^3[47]/', $clean)) return 'American Express';
        if (preg_match('/^(6011|65|64[4-9])/', $clean)) return 'Discover';
        if (preg_match('/^(352[89]|35[3-8][0-9])/', $clean)) return 'JCB';
        return 'Card';
    }

    public function returnPage()
    {
        $html = '<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="utf-8">
            <title>Authentication Complete</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
            body { font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0F172A; color: white; text-align: center; }
            .card { padding: 36px 28px; background: #1E293B; border-radius: 16px; border: 1px solid #334155; max-width: 85%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
            .icon { font-size: 52px; margin-bottom: 16px; color: #10B981; }
            h2 { margin: 0 0 10px; color: #F8FAFC; font-size: 22px; }
            p { color: #94A3B8; margin: 0; font-size: 14px; line-height: 1.5; }
            </style>
        </head>
        <body>
            <div class="card">
            <div class="icon">&#10003;</div>
            <h2>Authentication Complete</h2>
            <p>Your bank verification has been submitted.<br>You may now close this window to return to TapToPay.</p>
            </div>
        </body>
        </html>';

        return $this->response->setContentType('text/html')->setBody($html);
    }

    /**
     * Resolve Stripe Client instance
     */
    protected function getStripeClient(): ?StripeClient
    {
        if ($this->stripeClient !== null) {
            return $this->stripeClient;
        }

        $secretKey = $this->getStripeSecretKey();
        if (empty($secretKey)) {
            return null;
        }

        $this->stripeClient = new StripeClient($secretKey);
        return $this->stripeClient;
    }

    /**
     * Resolve decrypted Stripe Secret Key
     */
    protected function getStripeSecretKey(): ?string
    {
        if ($this->cachedSecretKey !== null) {
            return $this->cachedSecretKey;
        }

        $secure    = new SecureDatabase();
        $keyConfig = new EncryptionKey();
        $masterKey = !empty($keyConfig->masterStripeKey) ? $keyConfig->masterStripeKey : $keyConfig->masterKey;

        try {
            $this->cachedSecretKey = UniversalCipher::decrypt($secure->Secretkey, $masterKey);
        } catch (\Throwable $e) {
            try {
                $this->cachedSecretKey = UniversalCipher::decrypt($secure->Secretkey, $keyConfig->masterKey);
            } catch (\Throwable $ex) {
                log_message('error', 'Stripe secret key decryption failed: ' . $ex->getMessage());
            }
        }

        return $this->cachedSecretKey;
    }

    /**
     * Resolve decrypted Stripe Publishable Key
     */
    protected function getStripePublishableKey(): ?string
    {
        if ($this->cachedPublishableKey !== null) {
            return $this->cachedPublishableKey;
        }

        $secure    = new SecureDatabase();
        $keyConfig = new EncryptionKey();
        $masterKey = !empty($keyConfig->masterStripeKey) ? $keyConfig->masterStripeKey : $keyConfig->masterKey;

        try {
            $this->cachedPublishableKey = UniversalCipher::decrypt($secure->Publishablekey, $masterKey);
        } catch (\Throwable $e) {
            try {
                $this->cachedPublishableKey = UniversalCipher::decrypt($secure->Publishablekey, $keyConfig->masterKey);
            } catch (\Throwable $ex) {
                log_message('error', 'Stripe publishable key decryption failed: ' . $ex->getMessage());
            }
        }

        return $this->cachedPublishableKey;
    }

    /**
     * Resolve Stripe Webhook Signing Secret
     */
    protected function getStripeWebhookSecret(): ?string
    {
        $secret = getenv('STRIPE_WEBHOOK_SECRET') ?: ($_ENV['STRIPE_WEBHOOK_SECRET'] ?? null);
        if (!empty($secret)) {
            return trim($secret);
        }

        $secure = new SecureDatabase();
        if (isset($secure->WebhookSecret) && !empty($secure->WebhookSecret)) {
            try {
                $keyConfig = new EncryptionKey();
                $masterKey = !empty($keyConfig->masterStripeKey) ? $keyConfig->masterStripeKey : $keyConfig->masterKey;
                return UniversalCipher::decrypt($secure->WebhookSecret, $masterKey);
            } catch (\Throwable $e) {
                return $secure->WebhookSecret;
            }
        }

        return null;
    }

    /**
     * Helper to resolve or create a Stripe Terminal Location
     */
    protected function getOrCreateLocation(StripeClient $stripe): ?string
    {
        try {
            $locations = $stripe->terminal->locations->all(['limit' => 1]);
            if (!empty($locations->data) && count($locations->data) > 0) {
                return $locations->data[0]->id;
            }

            try {
                $newLoc = $stripe->terminal->locations->create([
                    'display_name' => 'SE PAY Terminal Store',
                    'address'      => [
                        'line1'       => '100 George Street',
                        'city'        => 'Sydney',
                        'state'       => 'NSW',
                        'country'     => 'AU',
                        'postal_code' => '2000'
                    ]
                ]);
                return $newLoc->id;
            } catch (\Throwable $locErr) {
                $newLoc = $stripe->terminal->locations->create([
                    'display_name' => 'SE PAY Terminal Store',
                    'address'      => [
                        'line1'       => '123 Market Street',
                        'city'        => 'San Francisco',
                        'state'       => 'CA',
                        'country'     => 'US',
                        'postal_code' => '94103'
                    ]
                ]);
                return $newLoc->id;
            }
        } catch (\Throwable $err) {
            log_message('error', 'Could not resolve Terminal location: ' . $err->getMessage());
            return null;
        }
    }

    /**
     * Parse request input from JSON, POST, or raw input
     */
    private function getRequestInput(): array
    {
        try {
            $json = $this->request->getJSON(true);
            if (is_array($json) && !empty($json)) {
                return $json;
            }
        } catch (\Throwable $e) {
            // Fall through if JSON parsing fails
        }

        $post = $this->request->getPost();
        if (is_array($post) && !empty($post)) {
            return $post;
        }

        if (!empty($_POST)) {
            return $_POST;
        }

        $raw = $this->request->getRawInput();
        if (is_array($raw) && !empty($raw)) {
            return $raw;
        }

        return [];
    }
}
