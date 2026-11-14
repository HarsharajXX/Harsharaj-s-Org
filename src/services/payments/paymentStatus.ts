import type {
  CodLifecycleStatus,
  CodReconciliationStatus,
  OnlinePaymentStatus,
  PaymentMethod,
} from './paymentTypes';

export const ONLINE_PAYMENT_STATUSES: readonly OnlinePaymentStatus[] = [
  'created',
  'pending',
  'authorized',
  'captured',
  'failed',
  'expired',
  'refund_pending',
  'partially_refunded',
  'refunded',
] as const;

export const COD_LIFECYCLE_STATUSES: readonly CodLifecycleStatus[] = [
  'not_applicable',
  'pending_confirmation',
  'confirmed',
  'dispatched',
  'out_for_delivery',
  'delivered',
  'collected',
  'remitted',
  'cancelled',
  'failed_delivery',
] as const;

export const COD_RECONCILIATION_STATUSES: readonly CodReconciliationStatus[] = [
  'not_applicable',
  'awaiting_collection',
  'collected',
  'remitted',
  'disputed',
  'cancelled',
  'settled',
] as const;

export function isOnlinePaymentStatus(value: string): value is OnlinePaymentStatus {
  return (ONLINE_PAYMENT_STATUSES as readonly string[]).includes(value);
}

export function isCodLifecycleStatus(value: string): value is CodLifecycleStatus {
  return (COD_LIFECYCLE_STATUSES as readonly string[]).includes(value);
}

export function isOnlinePaymentSettled(status: OnlinePaymentStatus): boolean {
  return status === 'captured' || status === 'partially_refunded' || status === 'refunded';
}

export function isOnlinePaymentRetryable(status: OnlinePaymentStatus): boolean {
  return status === 'created' || status === 'pending' || status === 'failed';
}

export function isCodCashCollected(status: CodLifecycleStatus): boolean {
  return status === 'collected' || status === 'remitted';
}

/**
 * Validates that COD orders do not adopt online Razorpay states and online orders
 * do not carry COD lifecycle states.
 */
export function assertPaymentMethodStatusCompatibility(
  paymentMethod: PaymentMethod,
  onlineStatus: string | null | undefined,
  codStatus: CodLifecycleStatus
): void {
  if (paymentMethod === 'online') {
    if (codStatus !== 'not_applicable') {
      throw new Error(`Online order must have cod_lifecycle_status='not_applicable', received '${codStatus}'.`);
    }
    if (onlineStatus && !isOnlinePaymentStatus(onlineStatus)) {
      throw new Error(`Invalid online payment status '${onlineStatus}'.`);
    }
    return;
  }

  if (codStatus === 'not_applicable') {
    throw new Error('COD order requires a concrete COD lifecycle status.');
  }
  if (onlineStatus && ['created', 'authorized', 'captured'].includes(onlineStatus)) {
    throw new Error(`COD order cannot use Razorpay online status '${onlineStatus}'.`);
  }
}

export function getOnlinePaymentStatusLabel(status: OnlinePaymentStatus): string {
  switch (status) {
    case 'created':
      return 'Checkout Initiated';
    case 'pending':
      return 'Awaiting Confirmation';
    case 'authorized':
      return 'Authorized';
    case 'captured':
      return 'Paid (Verified)';
    case 'failed':
      return 'Payment Failed';
    case 'expired':
      return 'Checkout Expired';
    case 'refund_pending':
      return 'Refund Pending';
    case 'partially_refunded':
      return 'Partially Refunded';
    case 'refunded':
      return 'Refunded';
  }
}

export function getCodLifecycleStatusLabel(status: CodLifecycleStatus): string {
  switch (status) {
    case 'not_applicable':
      return 'N/A';
    case 'pending_confirmation':
      return 'Pending Confirmation';
    case 'confirmed':
      return 'Confirmed (COD)';
    case 'dispatched':
      return 'Dispatched';
    case 'out_for_delivery':
      return 'Out for Delivery';
    case 'delivered':
      return 'Delivered (Awaiting Cash Collection)';
    case 'collected':
      return 'Cash Collected';
    case 'remitted':
      return 'Remitted to Marketplace';
    case 'cancelled':
      return 'Cancelled';
    case 'failed_delivery':
      return 'Delivery Failed';
  }
}

export function getRefundStatusLabel(
  status: 'pending' | 'processed' | 'failed',
  requestStatus?: string
): string {
  if (requestStatus === 'requested') return 'Requested (Pending Review)';
  if (requestStatus === 'approved') return 'Approved (Ready for Refund)';
  if (requestStatus === 'rejected') return 'Rejected';
  if (status === 'processed' || requestStatus === 'completed') return 'Refund Processed';
  if (status === 'failed' || requestStatus === 'failed') return 'Refund Failed';
  return 'Refund Processing';
}

export function canRequestCustomerRefund(params: {
  paymentMethod?: 'cod' | 'online';
  paymentStatus?: string;
  orderStatus?: string;
}): boolean {
  if (!params.paymentMethod || !params.paymentStatus) return false;
  if (['failed', 'expired', 'created', 'pending', 'refunded'].includes(params.paymentStatus)) {
    return false;
  }
  if (params.paymentMethod === 'online') {
    return ['paid', 'captured', 'partially_refunded'].includes(params.paymentStatus);
  }
  return params.paymentStatus === 'cod_collected' && params.orderStatus !== 'cancelled';
}
