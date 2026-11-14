export type PaymentMethod = 'online' | 'cod';
export type CurrencyCode = 'INR';
export type PaymentProviderName = 'razorpay';

/**
 * Monetary value in integer paise (1 INR = 100 paise).
 * All Stage 7.8+ payment, commission, refund, and settlement math must operate in integer paise.
 */
export type Paise = number;

export type OnlinePaymentStatus =
  | 'created'
  | 'pending'
  | 'authorized'
  | 'captured'
  | 'failed'
  | 'expired'
  | 'refund_pending'
  | 'partially_refunded'
  | 'refunded';

export type CodLifecycleStatus =
  | 'not_applicable'
  | 'pending_confirmation'
  | 'confirmed'
  | 'dispatched'
  | 'out_for_delivery'
  | 'delivered'
  | 'collected'
  | 'remitted'
  | 'cancelled'
  | 'failed_delivery';

export type CodReconciliationStatus =
  | 'not_applicable'
  | 'awaiting_collection'
  | 'collected'
  | 'remitted'
  | 'disputed'
  | 'cancelled'
  | 'settled';

export type ReservationOrderStatus =
  | 'pending'
  | 'pending_payment'
  | 'confirmed'
  | 'processing'
  | 'partially_dispatched'
  | 'dispatched'
  | 'partially_fulfilled'
  | 'fulfilled'
  | 'delivered'
  | 'cancelled'
  | 'partially_cancelled'
  | 'expired';

export interface CommissionBreakdownPaise {
  subtotalPaise: Paise;
  shippingPaise: Paise;
  taxPaise: Paise;
  commissionRateBps: number;
  commissionPaise: Paise;
  sellerPayablePaise: Paise;
}

export interface CreatePaymentOrderRequest {
  shippingAddress: Record<string, unknown>;
  items: Array<{
    product_id: string;
    variant_id?: string | null;
    quantity: number;
  }>;
  idempotencyKey: string;
  currency?: CurrencyCode;
  retryAttempt?: boolean;
}

export interface CreatePaymentOrderResponse {
  orderId: string;
  orderNumber: string;
  paymentId: string;
  attemptId: string;
  provider: PaymentProviderName;
  providerOrderId: string;
  amountPaise: Paise;
  currency: CurrencyCode;
  publicKeyId: string;
  reservationExpiresAt: string;
  reusedExisting: boolean;
}

export interface VerifyOnlinePaymentRequest {
  orderId: string;
  providerOrderId: string;
  providerPaymentId: string;
  providerSignature: string;
}

export interface VerifyOnlinePaymentResponse {
  verified: boolean;
  paymentStatus: OnlinePaymentStatus;
  orderStatus: ReservationOrderStatus;
  amountPaise: Paise;
}

export interface PaymentAttemptRecord {
  id: string;
  payment_id: string;
  order_id: string;
  attempt_number: number;
  provider: PaymentProviderName;
  provider_order_id?: string | null;
  provider_payment_id?: string | null;
  amount_paise: Paise;
  currency: CurrencyCode;
  status: Extract<OnlinePaymentStatus, 'created' | 'pending' | 'authorized' | 'captured' | 'failed' | 'expired'>;
  failure_code?: string | null;
  failure_reason?: string | null;
  signature_verified: boolean;
  api_verified: boolean;
  idempotency_key?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RefundItemRequest {
  order_item_id: string;
  quantity: number;
}

export interface RefundRequest {
  orderId: string;
  refundId?: string | null;
  sellerOrderId?: string | null;
  returnId?: string | null;
  items?: RefundItemRequest[] | null;
  amountPaise?: Paise | null;
  shippingRefundPaise?: Paise;
  reason: string;
  idempotencyKey: string;
  internalNotes?: string | null;
  speed?: 'normal' | 'optimum';
}

export interface RefundResult {
  refundId: string;
  orderId?: string;
  providerRefundId?: string | null;
  refundChannel: 'razorpay' | 'cod_manual';
  amountPaise: Paise;
  status: 'pending' | 'processed' | 'failed';
  orderPaymentStatus?: string;
  reversalStatus: 'not_applicable' | 'pending' | 'reversed' | 'failed';
  idempotentReplay?: boolean;
}

export type RefundRequestStatus =
  | 'requested'
  | 'approved'
  | 'rejected'
  | 'processing'
  | 'completed'
  | 'failed';

export type RestockStatus =
  | 'not_applicable'
  | 'pending_inspection'
  | 'restocked'
  | 'rejected_damaged';

export type CodCancellationStage =
  | 'before_collection'
  | 'after_dispatch'
  | 'failed_delivery_rto'
  | 'manual_refund_after_collection';

export interface CustomerRefundSummary {
  refundId: string;
  orderId: string;
  sellerOrderId?: string | null;
  refundChannel: 'razorpay' | 'cod_manual';
  refundType: string;
  amountPaise: Paise;
  shippingRefundPaise: Paise;
  status: 'pending' | 'processed' | 'failed';
  requestStatus: RefundRequestStatus;
  reason: string;
  rejectionReason?: string | null;
  providerRefundId?: string | null;
  manualReference?: string | null;
  refundMethod?: string | null;
  restockStatus: RestockStatus;
  createdAt: string;
  processedAt?: string | null;
}

export interface SellerRefundSummary {
  refundId: string;
  orderId: string;
  orderNumber: string;
  sellerOrderId: string;
  refundChannel: 'razorpay' | 'cod_manual';
  refundType: string;
  grossRefundPaise: Paise;
  commissionReversedPaise: Paise;
  sellerPayableReversedPaise: Paise;
  courierDeductionPaise: Paise;
  status: 'pending' | 'processed' | 'failed';
  requestStatus: RefundRequestStatus;
  reason: string;
  restockStatus: RestockStatus;
  createdAt: string;
  processedAt?: string | null;
}

export interface ProportionalReversalPaise {
  grossRefundPaise: Paise;
  commissionReversedPaise: Paise;
  sellerPayableReversedPaise: Paise;
}

export function assertNonNegativeSafeInteger(value: number, label = 'amountPaise'): Paise {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer in paise.`);
  }
  return value;
}

/**
 * Converts a numeric INR value (e.g. 2499.50) to integer paise (249950).
 */
export function inrToPaise(amountInr: number): Paise {
  if (!Number.isFinite(amountInr) || amountInr < 0) {
    throw new Error('INR amount must be a finite non-negative number.');
  }
  return Math.round(amountInr * 100);
}

/**
 * Converts integer paise to numeric INR with 2-decimal precision.
 */
export function paiseToInr(amountPaise: Paise): number {
  assertNonNegativeSafeInteger(amountPaise);
  return amountPaise / 100;
}

export function formatInrFromPaise(amountPaise: Paise): string {
  const inr = paiseToInr(amountPaise);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: amountPaise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(inr);
}

/**
 * Calculates platform commission strictly on product subtotal (never shipping or tax),
 * matching PostgreSQL round((subtotal_paise * commission_basis_points) / 10000).
 */
export function calculateCommissionPaise(params: {
  subtotalPaise: Paise;
  shippingPaise?: Paise;
  taxPaise?: Paise;
  commissionRateBps?: number;
}): CommissionBreakdownPaise {
  const subtotalPaise = assertNonNegativeSafeInteger(params.subtotalPaise, 'subtotalPaise');
  const shippingPaise = assertNonNegativeSafeInteger(params.shippingPaise ?? 0, 'shippingPaise');
  const taxPaise = assertNonNegativeSafeInteger(params.taxPaise ?? 0, 'taxPaise');
  const commissionRateBps = params.commissionRateBps ?? 1200;

  if (!Number.isInteger(commissionRateBps) || commissionRateBps < 0 || commissionRateBps > 5000) {
    throw new Error('commissionRateBps must be an integer between 0 and 5000.');
  }

  // Commission is applied exclusively to seller product subtotal.
  const commissionPaise = Math.round((subtotalPaise * commissionRateBps) / 10000);
  const sellerPayablePaise = subtotalPaise - commissionPaise;

  return {
    subtotalPaise,
    shippingPaise,
    taxPaise,
    commissionRateBps,
    commissionPaise,
    sellerPayablePaise,
  };
}

/**
 * Calculates exact proportional commission & seller-payable reversal in integer paise
 * strictly from the historical seller-order snapshot (never current marketplace_settings),
 * clamping cumulative reversals so repeated partial refunds sum without paise drift.
 */
export function calculateProportionalRefundReversalPaise(params: {
  sellerSubtotalPaise: Paise;
  historicalCommissionPaise: Paise;
  historicalSellerPayablePaise: Paise;
  grossRefundPaise: Paise;
  alreadyRefundedPaise?: Paise;
  alreadyCommissionReversedPaise?: Paise;
  alreadySellerPayableReversedPaise?: Paise;
}): ProportionalReversalPaise {
  const sellerSubtotalPaise = assertNonNegativeSafeInteger(params.sellerSubtotalPaise, 'sellerSubtotalPaise');
  const historicalCommissionPaise = assertNonNegativeSafeInteger(
    params.historicalCommissionPaise,
    'historicalCommissionPaise'
  );
  const historicalSellerPayablePaise = assertNonNegativeSafeInteger(
    params.historicalSellerPayablePaise,
    'historicalSellerPayablePaise'
  );
  const grossRefundPaise = assertNonNegativeSafeInteger(params.grossRefundPaise, 'grossRefundPaise');
  const alreadyRefundedPaise = assertNonNegativeSafeInteger(
    params.alreadyRefundedPaise ?? 0,
    'alreadyRefundedPaise'
  );
  const alreadyCommissionReversedPaise = assertNonNegativeSafeInteger(
    params.alreadyCommissionReversedPaise ?? 0,
    'alreadyCommissionReversedPaise'
  );
  const alreadySellerPayableReversedPaise = assertNonNegativeSafeInteger(
    params.alreadySellerPayableReversedPaise ?? 0,
    'alreadySellerPayableReversedPaise'
  );

  if (sellerSubtotalPaise <= 0 || grossRefundPaise <= 0) {
    return {
      grossRefundPaise,
      commissionReversedPaise: 0,
      sellerPayableReversedPaise: 0,
    };
  }

  const remainingSubtotal = Math.max(0, sellerSubtotalPaise - alreadyRefundedPaise);
  if (grossRefundPaise > remainingSubtotal) {
    throw new Error('Refund amount exceeds remaining seller order product subtotal.');
  }

  const remainingCommission = Math.max(0, historicalCommissionPaise - alreadyCommissionReversedPaise);
  const remainingPayable = Math.max(0, historicalSellerPayablePaise - alreadySellerPayableReversedPaise);

  if (grossRefundPaise >= remainingSubtotal) {
    const commissionReversedPaise = remainingCommission;
    const sellerPayableReversedPaise = Math.max(
      0,
      Math.min(grossRefundPaise - commissionReversedPaise, remainingPayable)
    );
    return {
      grossRefundPaise,
      commissionReversedPaise,
      sellerPayableReversedPaise,
    };
  }

  const commissionReversedPaise = Math.min(
    remainingCommission,
    Math.round((historicalCommissionPaise * grossRefundPaise) / sellerSubtotalPaise)
  );
  const sellerPayableReversedPaise = Math.max(
    0,
    Math.min(grossRefundPaise - commissionReversedPaise, remainingPayable)
  );

  return {
    grossRefundPaise,
    commissionReversedPaise,
    sellerPayableReversedPaise,
  };
}
