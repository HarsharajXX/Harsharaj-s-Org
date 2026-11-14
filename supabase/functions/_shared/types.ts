export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

export interface AuthenticatedCustomer {
  id: string;
  email?: string;
}

export interface ShippingAddressInput {
  full_name: string;
  email: string;
  phone: string;
  line1: string;
  city: string;
  state?: string;
  postal_code: string;
}

export interface CheckoutItemInput {
  product_id: string;
  variant_id?: string | null;
  quantity: number;
}

export interface GatewayConfigRow {
  active_provider: 'razorpay';
  online_payments_enabled: boolean;
  razorpay_mode: 'test' | 'live';
  razorpay_route_enabled: boolean;
  route_approval_status?: 'not_approved' | 'pending_review' | 'approved' | 'suspended';
}

export interface ReservationResult {
  order_id: string;
  order_number: string;
  total_paise: number;
  currency: 'INR';
  reservation_expires_at: string;
  reused_existing: boolean;
}

export interface OrderPaymentSnapshot {
  id: string;
  order_number: string;
  customer_id: string;
  total_paise: number;
  currency: string;
  payment_method: 'cod' | 'online';
  payment_status: string;
  order_status: string;
  reservation_expires_at: string | null;
  reservation_released_at: string | null;
}

export interface PaymentAttemptRow {
  id: string;
  payment_id: string;
  order_id: string;
  attempt_number: number;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  amount_paise: number;
  currency: string;
  status: 'created' | 'pending' | 'authorized' | 'captured' | 'failed' | 'expired';
  signature_verified: boolean;
  api_verified: boolean;
}

export interface RegisteredAttemptResult {
  payment_id: string;
  attempt_id: string;
  attempt_number: number;
}

export interface CaptureFinalizationResult {
  order_id: string;
  payment_status: string;
  order_status: string;
  already_captured: boolean;
}

export interface PaymentStateUpdateResult {
  order_id: string;
  payment_status: string;
  order_status: string;
  ignored_out_of_order: boolean;
}

export interface RazorpayOrderEntity {
  id: string;
  amount: number;
  currency: string;
  receipt?: string;
  status: string;
}

export interface RazorpayPaymentEntity {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  method?: string;
  fee?: number;
  tax?: number;
  error_code?: string | null;
  error_description?: string | null;
}

export interface RazorpayApiClient {
  createOrder(params: {
    amountPaise: number;
    currency: 'INR';
    receipt: string;
    notes: Record<string, string>;
  }): Promise<RazorpayOrderEntity>;
  fetchPayment(paymentId: string): Promise<RazorpayPaymentEntity>;
  fetchOrderPayments(providerOrderId: string): Promise<RazorpayPaymentEntity[]>;
}

export interface ExpiredOrderCandidate {
  order: OrderPaymentSnapshot;
  attempts: PaymentAttemptRow[];
}

export interface LateCaptureResult {
  order_id: string;
  payment_status: string;
  order_status: string;
  requires_refund: boolean;
}

export interface PaymentEdgeRepository {
  authenticateCustomer(jwt: string): Promise<AuthenticatedCustomer | null>;
  getGatewayConfig(): Promise<GatewayConfigRow>;
  reserveOnlineOrderInventory(params: {
    customerId: string;
    shippingAddress: ShippingAddressInput;
    items: CheckoutItemInput[];
    idempotencyKey: string;
  }): Promise<ReservationResult>;
  getOrderPaymentSnapshot(orderId: string): Promise<OrderPaymentSnapshot | null>;
  listOrderAttempts(orderId: string): Promise<PaymentAttemptRow[]>;
  getAttemptByProviderOrderId(providerOrderId: string): Promise<{
    order: OrderPaymentSnapshot;
    attempt: PaymentAttemptRow;
  } | null>;
  registerPaymentAttempt(params: {
    orderId: string;
    customerId: string;
    providerOrderId: string;
    amountPaise: number;
    currency: 'INR';
    idempotencyKey: string;
    expiresAt: string;
    metadata?: Record<string, unknown>;
  }): Promise<RegisteredAttemptResult>;
  recordCreateOrderFailure(params: {
    orderId: string;
    customerId: string;
    amountPaise: number;
    idempotencyKey: string;
    failureCode: string;
    failureReason: string;
  }): Promise<void>;
  finalizePaymentCapture(params: {
    orderId: string;
    providerOrderId: string;
    providerPaymentId: string;
    amountPaise: number;
    currency: string;
    signatureVerified: boolean;
    apiVerified: boolean;
    gatewayMethod?: string | null;
    gatewayFeePaise?: number;
    verificationSource: 'verify_endpoint' | 'webhook';
  }): Promise<CaptureFinalizationResult>;
  recordPaymentState(params: {
    orderId: string;
    providerOrderId: string;
    providerPaymentId?: string | null;
    nextStatus: 'authorized' | 'failed';
    failureCode?: string | null;
    failureReason?: string | null;
    signatureVerified: boolean;
    apiVerified: boolean;
  }): Promise<PaymentStateUpdateResult>;
  beginWebhookEvent(params: {
    eventId: string;
    eventType: string;
    providerOrderId?: string | null;
    providerPaymentId?: string | null;
    signatureValid: boolean;
    safePayload: Record<string, unknown>;
  }): Promise<{ deduplicated: boolean; existingStatus?: string }>;
  completeWebhookEvent(params: {
    eventId: string;
    status: 'processed' | 'ignored' | 'failed';
    errorMessage?: string | null;
  }): Promise<void>;
  listExpiredPendingOrders(limit?: number): Promise<ExpiredOrderCandidate[]>;
  recordLateCaptureAfterExpiry(params: {
    orderId: string;
    providerOrderId: string;
    providerPaymentId: string;
    amountPaise: number;
    currency: string;
    signatureVerified: boolean;
    apiVerified: boolean;
  }): Promise<LateCaptureResult>;
  releaseExpiredOnlineOrderInventory(orderId?: string | null): Promise<number>;
}

export interface CreateOrderEnv {
  razorpayKeyId: string;
  razorpayKeySecret: string;
  razorpayWebhookSecretConfigured?: boolean;
}

export interface VerifyPaymentEnv {
  razorpayKeySecret: string;
}

export interface WebhookEnv {
  razorpayWebhookSecret: string;
}

export interface ExpireOrdersEnv {
  cronSecret?: string;
  serviceRoleKey?: string;
}

export interface RazorpayRefundEntity {
  id: string;
  entity?: 'refund';
  amount: number;
  currency: string;
  payment_id: string;
  receipt?: string | null;
  status: 'pending' | 'processed' | 'failed';
  speed_processed?: string;
  speed_requested?: string;
  error_code?: string | null;
  error_description?: string | null;
  notes?: Record<string, string>;
  created_at?: number;
}

export interface RazorpayRefundApiClient extends RazorpayApiClient {
  createRefund(
    paymentId: string,
    params: {
      amountPaise: number;
      speed?: 'normal' | 'optimum';
      receipt?: string;
      notes?: Record<string, string>;
    }
  ): Promise<RazorpayRefundEntity>;
  fetchRefund(refundId: string): Promise<RazorpayRefundEntity>;
}

export interface RefundItemReservationInput {
  order_item_id: string;
  quantity: number;
}

export interface ReserveOnlineRefundResult {
  refund_id: string;
  order_id: string;
  provider_payment_id: string;
  amount_paise: number;
  currency: string;
  already_initiated: boolean;
  provider_refund_id: string | null;
  refund_status: 'pending' | 'processed' | 'failed';
}

export interface FinalizeOnlineRefundResult {
  refund_id: string;
  order_id: string;
  refund_status: 'pending' | 'processed' | 'failed';
  order_payment_status: string;
  already_processed: boolean;
  ignored_out_of_order: boolean;
}

export interface RefundEdgeRepository {
  authenticateCustomer(jwt: string): Promise<AuthenticatedCustomer | null>;
  isOperationsAdmin(userId: string): Promise<boolean>;
  reserveOnlineRefund(params: {
    actorId: string;
    orderId: string;
    refundId?: string | null;
    sellerOrderId?: string | null;
    items?: RefundItemReservationInput[] | null;
    amountPaise?: number | null;
    shippingRefundPaise?: number;
    reason: string;
    idempotencyKey: string;
    internalNotes?: string | null;
  }): Promise<ReserveOnlineRefundResult>;
  finalizeOnlineRefundState(params: {
    refundId?: string | null;
    providerRefundId?: string | null;
    providerPaymentId?: string | null;
    nextStatus: 'pending' | 'processed' | 'failed';
    amountPaise?: number | null;
    failureReason?: string | null;
    actorId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<FinalizeOnlineRefundResult>;
  getRefundRecordById(refundId: string): Promise<{
    id: string;
    order_id: string;
    payment_id: string | null;
    amount_paise: number;
    status: string;
    provider_refund_id: string | null;
  } | null>;
  getRefundRecordByProviderRefundId(providerRefundId: string): Promise<{
    id: string;
    order_id: string;
    payment_id: string | null;
    amount_paise: number;
    status: string;
    provider_refund_id: string | null;
  } | null>;
  beginWebhookEvent(params: {
    eventId: string;
    eventType: string;
    providerOrderId?: string | null;
    providerPaymentId?: string | null;
    signatureValid: boolean;
    safePayload: Record<string, unknown>;
  }): Promise<{ deduplicated: boolean; existingStatus?: string }>;
  completeWebhookEvent(params: {
    eventId: string;
    status: 'processed' | 'ignored' | 'failed';
    errorMessage?: string | null;
  }): Promise<void>;
}

export interface CreateRefundEnv {
  razorpayKeyId: string;
  razorpayKeySecret: string;
}

export interface RefundWebhookEnv {
  razorpayWebhookSecret: string;
}

export interface RazorpayLinkedAccountEntity {
  id: string;
  type?: 'route';
  status?: 'created' | 'activated' | 'suspended' | 'rejected' | 'needs_clarification' | string;
  email: string;
  phone: string;
  legal_business_name: string;
  business_type?: string;
  contact_name?: string;
  reference_id?: string;
  notes?: Record<string, string>;
}

export interface RazorpayRouteProductEntity {
  id: string;
  account_id: string;
  product_name: 'route' | string;
  activation_status: 'under_review' | 'needs_clarification' | 'activated' | 'rejected' | 'suspended' | string;
  requirements?: Array<Record<string, unknown>>;
}

export interface RazorpayTransferEntity {
  id: string;
  entity?: 'transfer';
  source?: string;
  recipient: string;
  amount: number;
  currency: string;
  status: 'created' | 'pending' | 'processed' | 'failed';
  settlement_status?: 'pending' | 'on_hold' | 'settled' | 'failed' | null;
  recipient_settlement_id?: string | null;
  on_hold?: boolean;
  on_hold_until?: number | null;
  amount_reversed?: number;
  error?: { code?: string; description?: string } | null;
  notes?: Record<string, string>;
  created_at?: number;
}

export interface RazorpayTransferReversalEntity {
  id: string;
  entity?: 'reversal';
  transfer_id: string;
  amount: number;
  currency: string;
  status?: 'created' | 'processed' | 'failed';
  notes?: Record<string, string>;
  created_at?: number;
}

export interface RazorpaySettlementEntity {
  id: string;
  entity?: 'settlement';
  amount: number;
  status: 'created' | 'processed' | 'settled' | 'failed';
  utr?: string | null;
  created_at?: number;
}

export interface RazorpayRouteApiClient extends RazorpayRefundApiClient {
  createLinkedAccount(params: {
    email: string;
    phone: string;
    legalBusinessName: string;
    businessType: string;
    contactName: string;
    referenceId: string;
    pan?: string;
    gstin?: string;
    registeredAddress?: Record<string, unknown> | null;
  }): Promise<RazorpayLinkedAccountEntity>;
  updateLinkedAccount(
    accountId: string,
    params: {
      email?: string;
      phone?: string;
      legalBusinessName?: string;
      contactName?: string;
      pan?: string;
      gstin?: string;
    }
  ): Promise<RazorpayLinkedAccountEntity>;
  fetchLinkedAccount(accountId: string): Promise<RazorpayLinkedAccountEntity>;
  requestRouteProduct(
    accountId: string,
    params: { tncAccepted: boolean }
  ): Promise<RazorpayRouteProductEntity>;
  updateRouteProduct(
    accountId: string,
    productId: string,
    params: {
      accountNumber?: string;
      ifscCode?: string;
      beneficiaryName?: string;
      tncAccepted?: boolean;
    }
  ): Promise<RazorpayRouteProductEntity>;
  fetchRouteProduct(accountId: string, productId: string): Promise<RazorpayRouteProductEntity>;
  createPaymentTransfers(
    paymentId: string,
    transfers: Array<{
      account: string;
      amountPaise: number;
      onHold?: boolean;
      onHoldUntil?: number;
      notes?: Record<string, string>;
      linkedAccountNotes?: string[];
    }>
  ): Promise<RazorpayTransferEntity[]>;
  fetchTransfer(transferId: string): Promise<RazorpayTransferEntity>;
  reverseTransfer(
    transferId: string,
    params: { amountPaise: number; notes?: Record<string, string> }
  ): Promise<RazorpayTransferReversalEntity>;
  fetchSettlement(settlementId: string): Promise<RazorpaySettlementEntity>;
}

export interface SellerSettlementAccountRow {
  id: string;
  seller_id: string;
  legal_business_name: string;
  business_type?: string | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  pan_last4?: string | null;
  gstin?: string | null;
  beneficiary_name?: string | null;
  bank_account_last4?: string | null;
  bank_ifsc?: string | null;
  registered_address?: Record<string, unknown> | null;
  kyc_status: string;
  route_onboarding_status: string;
  payouts_enabled: boolean;
  razorpay_linked_account_id: string | null;
  razorpay_product_id: string | null;
  razorpay_raw_activation_status?: string | null;
  seller_consent_accepted: boolean;
  agreement_accepted: boolean;
}

export interface ReserveRouteTransferResult {
  transfer_id: string;
  seller_order_id: string;
  order_id: string;
  payment_id: string;
  provider_payment_id: string;
  seller_id: string;
  settlement_account_id: string;
  linked_account_id: string;
  amount_paise: number;
  currency: string;
  on_hold: boolean;
  hold_until: string | null;
  already_initiated: boolean;
  provider_transfer_id: string | null;
  transfer_status: string;
}

export interface FinalizeRouteTransferResult {
  transfer_id: string;
  seller_order_id: string;
  transfer_status: string;
  settlement_status: string;
  ignored_out_of_order: boolean;
}

export interface ReserveTransferReversalResult {
  reversal_id: string;
  seller_transfer_id: string;
  provider_transfer_id: string;
  seller_order_id: string;
  order_id: string;
  amount_paise: number;
  already_initiated: boolean;
  provider_reversal_id: string | null;
  reversal_status: string;
}

export interface FinalizeTransferReversalResult {
  reversal_id: string;
  seller_transfer_id: string;
  reversal_status: string;
  transfer_status: string;
  already_processed: boolean;
}

export interface ReconciliationTransferCandidate {
  id: string;
  provider_transfer_id: string;
  seller_order_id: string;
  seller_id: string;
  amount_paise: number;
  status: string;
  settlement_status: string;
  settlement_id: string | null;
}

export interface RouteEdgeRepository {
  authenticateCustomer(jwt: string): Promise<AuthenticatedCustomer | null>;
  isOperationsAdmin(userId: string): Promise<boolean>;
  getGatewayConfig(): Promise<GatewayConfigRow>;
  getSellerSettlementAccountById(accountId: string): Promise<SellerSettlementAccountRow | null>;
  getSellerSettlementAccountBySellerId(sellerId: string): Promise<SellerSettlementAccountRow | null>;
  getSellerSettlementAccountByLinkedAccountId(
    linkedAccountId: string
  ): Promise<SellerSettlementAccountRow | null>;
  syncLinkedAccountFromRoute(params: {
    accountId?: string | null;
    linkedAccountId: string;
    productId?: string | null;
    stakeholderId?: string | null;
    rawActivationStatus: string;
    kycRequirements?: unknown[] | null;
    actorId?: string | null;
  }): Promise<SellerSettlementAccountRow>;
  reserveSellerRouteTransfer(params: {
    actorId: string;
    sellerOrderId: string;
    amountPaise?: number | null;
    transferId?: string | null;
    onHold?: boolean;
    holdUntil?: string | null;
    idempotencyKey: string;
  }): Promise<ReserveRouteTransferResult>;
  finalizeSellerRouteTransfer(params: {
    transferId?: string | null;
    providerTransferId?: string | null;
    nextStatus: 'pending' | 'created' | 'on_hold' | 'processed' | 'settled' | 'failed';
    settlementId?: string | null;
    settlementUtr?: string | null;
    failureReason?: string | null;
    errorCode?: string | null;
    actorId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<FinalizeRouteTransferResult>;
  reserveSellerTransferReversal(params: {
    actorId: string;
    transferId: string;
    amountPaise?: number | null;
    refundId?: string | null;
    reason: string;
    idempotencyKey: string;
  }): Promise<ReserveTransferReversalResult>;
  finalizeSellerTransferReversal(params: {
    reversalId?: string | null;
    providerReversalId?: string | null;
    providerTransferId?: string | null;
    nextStatus: 'processed' | 'failed';
    amountPaise?: number | null;
    failureReason?: string | null;
    actorId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<FinalizeTransferReversalResult>;
  listPendingTransfersForReconciliation(limit?: number): Promise<ReconciliationTransferCandidate[]>;
  recordReconciliationRun(params: {
    runType: 'razorpay_transfers' | 'full';
    status: 'completed' | 'completed_with_discrepancies' | 'failed';
    checkedCount: number;
    discrepancyCount: number;
    summary: Record<string, unknown>;
    startedBy?: string | null;
  }): Promise<void>;
  beginWebhookEvent(params: {
    eventId: string;
    eventType: string;
    providerOrderId?: string | null;
    providerPaymentId?: string | null;
    signatureValid: boolean;
    safePayload: Record<string, unknown>;
  }): Promise<{ deduplicated: boolean; existingStatus?: string }>;
  completeWebhookEvent(params: {
    eventId: string;
    status: 'processed' | 'ignored' | 'failed';
    errorMessage?: string | null;
  }): Promise<void>;
}

export interface RouteApiEnv {
  razorpayKeyId: string;
  razorpayKeySecret: string;
  razorpayRouteEnabled: boolean;
}

export interface RouteWebhookEnv {
  razorpayWebhookSecret: string;
  razorpayRouteEnabled: boolean;
}

export interface RouteReconciliationEnv extends RouteApiEnv {
  cronSecret?: string;
  serviceRoleKey?: string;
}


