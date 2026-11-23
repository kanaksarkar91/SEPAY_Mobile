# Backend Integration Guide: Tokenized Stripe Card Payments (PCI-DSS SAQ-A Compliant)

## Overview
This document explains the updates made to `app/Controllers/Api/StripeCardController.php` to support **Tokenized Card Payments** (`paymentMethodId`).

### What Changed
Previously, the mobile app was transmitting raw card details (`card.number`, `card.cvc`, `card.expMonth`, `card.expYear`) to the backend, and the backend was attempting to tokenize the card using a server-side curl request to Stripe.

Now, the mobile app tokenizes the card **directly with Stripe** using the Publishable Key before calling the backend. The mobile app sends only the tokenized `paymentMethodId` (`pm_...`) along with non-sensitive display metadata (`cardLast4` and `cardBrand`).

---

## File to Deploy
The updated file is located at:
[`docs/backend/StripeCardController.php`](StripeCardController.php)

Deploy this file to your backend server at:
```
app/Controllers/Api/StripeCardController.php
```

---

## Detailed Code Changes in `createPaymentIntent()`

### Before (Vulnerable to PCI-DSS non-compliance):
```php
if (!empty($cardInput) && !empty($cardInput['number'])) {
    $cleanNumber = preg_replace('/\D/', '', (string)$cardInput['number']);
    $maskedCard  = $this->formatMaskedCard($cleanNumber);
    $cardType    = $this->detectCardBrand($cleanNumber);

    $expMonth = (int)($cardInput['expMonth'] ?? ($cardInput['exp_month'] ?? 0));
    $expYear  = (int)($cardInput['expYear'] ?? ($cardInput['exp_year'] ?? 0));
    $cvc      = trim((string)($cardInput['cvc'] ?? ''));

    // Server-side curl to Stripe with raw card numbers
    $tokenResult = $this->createPaymentMethodWithPublishableKey($cleanNumber, $expMonth, $expYear, $cvc);
    ...
}
```

### After (PCI-DSS SAQ-A Compliant):
```php
if ($paymentMethodType === 'card') {
    // 1. Enforce that card was tokenized by the mobile app
    $paymentMethodId = $input['paymentMethodId'] 
        ?? ($input['payment_method_id'] 
        ?? ($input['token'] 
        ?? ($input['card']['token'] ?? null)));

    if (empty($paymentMethodId)) {
        return $this->respond([
            'status' => false,
            'error'  => 'Missing paymentMethodId. Card must be securely tokenized with Stripe before creating payment intent.'
        ], 400);
    }

    // 2. Resolve safe display metadata from app payload
    if (!empty($input['cardLast4'])) {
        $maskedCard = '**** **** **** ' . preg_replace('/\D/', '', (string)$input['cardLast4']);
    }
    if (!empty($input['cardBrand'])) {
        $cardType = ucfirst(trim((string)$input['cardBrand']));
    }

    // 3. Confirm card details dynamically from Stripe PaymentMethod
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
}
```

---

## Incoming Request Contract from Mobile App

Endpoint: `POST /api/payment/create-intent`

```json
{
  "amount": 25.00,
  "currency": "aud",
  "paymentMethodType": "card",
  "paymentMethodId": "pm_1Oxxxxxxxxxxxxxxxxxxxx",
  "cardLast4": "4242",
  "cardBrand": "Visa",
  "shift_session_id": 105,
  "service_charges": 2.50,
  "pickup_id": null,
  "dropup_id": null
}
```

---

## Outgoing Response Contract (Unchanged)
The backend responds with the exact structure consumed by the mobile app:
```json
{
  "requiresAction": false,
  "clientSecret": "pi_3Oxxxxxxxx_secret_xxxx",
  "paymentIntentId": "pi_3Oxxxxxxxx",
  "amount": 2500,
  "amountInDollars": 25.00,
  "formattedAmount": "$25.00 AUD",
  "currency": "aud",
  "status": "succeeded",
  "redirectUrl": null
}
```
*(If 3D Secure bank OTP is required, Stripe sets `status: "requires_action"` and returns `redirectUrl`, which the mobile app automatically opens in an in-app browser).*
