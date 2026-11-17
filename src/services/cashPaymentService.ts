import { apiClient } from './apiClient';
import { appLogger } from './appLogger';

export interface CashPaymentPayload {
  amount: number;
  shift_session_id: number | string;
  service_charges?: number | null;
  pickup_id?: number | string | null;
  dropup_id?: number | string | null;
  dropoff_id?: number | string | null;
  pickup_location?: string | null;
  dropup_location?: string | null;
  pickup?: string | null;
  dropoff?: string | null;
  payment_attempt_id?: string | null;
  idempotency_key?: string | null;
}

export interface CashPaymentData {
  id: number;
  transaction_id: string;
  shift_session_id: number;
  user_id: number;
  amount: number;
  amount_formatted: string;
  service_fee: number;
  driver_payout: number;
  payment_method: string;
  account_type: string;
  payment_status: string;
  approval_code: string;
  transaction_date: string;
}

export interface CashPaymentResponse {
  status: boolean;
  message: string;
  data: CashPaymentData;
}

let cashPaymentPromise: Promise<CashPaymentData> | null = null;
let lastCashPaymentKey = '';
let lastCashPaymentTime = 0;

export const cashPaymentService = {
  /**
   * POST /api/payment/cash
   * Records a cash payment against the active shift session.
   * Usable by both Business Owner and Employee.
   */
  recordCashPayment: async (payload: CashPaymentPayload): Promise<CashPaymentData> => {
    const dedupeKey = `${payload.amount}_${payload.shift_session_id}`;
    const now = Date.now();

    // Prevent identical cash payment within 5 seconds
    if (lastCashPaymentKey === dedupeKey && now - lastCashPaymentTime < 5000) {
      appLogger.warn('CASH_PAYMENT', 'Duplicate cash payment blocked within 5 seconds');
      throw new Error('A cash payment for this amount was just recorded. Please wait a moment.');
    }

    if (cashPaymentPromise) {
      appLogger.warn('CASH_PAYMENT', 'Cash payment already in flight, awaiting current operation');
      return cashPaymentPromise;
    }

    const cleanPayload: Record<string, any> = {
      amount: payload.amount,
      shift_session_id: payload.shift_session_id,
    };

    if (payload.service_charges !== undefined && payload.service_charges !== null) {
      cleanPayload.service_charges = Number(payload.service_charges) || 0;
    }
    const rawPickupId = payload.pickup_id;
    const parsedPickupId =
      rawPickupId !== undefined && rawPickupId !== null && rawPickupId !== '' && !isNaN(Number(rawPickupId))
        ? Number(rawPickupId)
        : null;

    const rawDropId = payload.dropup_id ?? payload.dropoff_id;
    const parsedDropId =
      rawDropId !== undefined && rawDropId !== null && rawDropId !== '' && !isNaN(Number(rawDropId))
        ? Number(rawDropId)
        : null;

    cleanPayload.pickup_id = parsedPickupId;
    cleanPayload.dropup_id = parsedDropId;
    // pickup_location is ONLY sent for custom input (when pickup_id is null)
    cleanPayload.pickup_location = parsedPickupId !== null ? null : (payload.pickup_location || null);
    // dropup_location is ONLY sent for custom input (when dropup_id is null)
    cleanPayload.dropup_location = parsedDropId !== null ? null : (payload.dropup_location || null);

    const idempotencyKey =
      payload.idempotency_key ||
      payload.payment_attempt_id ||
      `cash_${payload.shift_session_id}_${payload.amount}_${Date.now()}`;
    cleanPayload.idempotency_key = idempotencyKey;

    cashPaymentPromise = (async () => {
      appLogger.info('CASH_PAYMENT', 'Sending cash payment to backend:', cleanPayload);
      try {
        const response = await apiClient.post<CashPaymentResponse>(
          '/api/payment/cash',
          cleanPayload,
          { headers: { 'Idempotency-Key': String(idempotencyKey) } }
        );
        appLogger.info('CASH_PAYMENT', 'Cash payment response:', response.data);

        if (!response.data?.status || !response.data?.data) {
          throw new Error(response.data?.message || 'Failed to record cash payment');
        }

        lastCashPaymentKey = dedupeKey;
        lastCashPaymentTime = Date.now();
        return response.data.data;
      } catch (err: any) {
        const errorMsg =
          err?.response?.data?.message ||
          err?.message ||
          'Cash payment could not be processed.';
        appLogger.error('CASH_PAYMENT', `Cash payment failed: ${errorMsg}`, err);
        throw new Error(errorMsg);
      } finally {
        cashPaymentPromise = null;
      }
    })();

    return cashPaymentPromise;
  },
};
