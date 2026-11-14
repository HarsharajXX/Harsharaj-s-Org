import type { Order, UserRole } from '../types';

export type AdminTab =
  | 'overview'
  | 'sellers'
  | 'moderation'
  | 'orders'
  | 'refunds'
  | 'settlements'
  | 'customers'
  | 'communities'
  | 'returns'
  | 'content'
  | 'settings'
  | 'audit';

export const ADMIN_ROLE_PERMISSIONS: Record<string, AdminTab[]> = {
  super_admin: [
    'overview',
    'sellers',
    'moderation',
    'orders',
    'refunds',
    'settlements',
    'customers',
    'communities',
    'returns',
    'content',
    'settings',
    'audit',
  ],
  operations_admin: [
    'overview',
    'sellers',
    'orders',
    'refunds',
    'settlements',
    'customers',
    'returns',
  ],
  content_admin: ['overview', 'moderation', 'communities', 'content'],
};

export function canAccessAdminTab(role: UserRole, tab: AdminTab): boolean {
  const allowed = ADMIN_ROLE_PERMISSIONS[role];
  return Boolean(allowed && allowed.includes(tab));
}

export function prepareCheckoutItems(
  items: { product_id: string; variant_id?: string | null; quantity: number }[]
): { product_id: string; variant_id: string | null; quantity: number }[] {
  const merged = new Map<string, { product_id: string; variant_id: string | null; quantity: number }>();
  for (const item of items) {
    if (!item.product_id || item.quantity <= 0) continue;
    const variantId = item.variant_id || null;
    const key = `${item.product_id}::${variantId || ''}`;
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      merged.set(key, {
        product_id: item.product_id,
        variant_id: variantId,
        quantity: item.quantity,
      });
    }
  }
  return Array.from(merged.values()).sort((a, b) => {
    if (a.product_id !== b.product_id) return a.product_id < b.product_id ? -1 : 1;
    const va = a.variant_id || '';
    const vb = b.variant_id || '';
    if (va === vb) return 0;
    return va < vb ? -1 : 1;
  });
}

export function canCustomerCancelOrder(
  order: Pick<Order, 'status' | 'payment_status' | 'seller_orders'>
): boolean {
  const cancellableStatuses = [
    'pending',
    'pending_payment',
    'confirmed',
    'processing',
    'partially_cancelled',
    'Confirmed (Demo)',
  ];
  if (!cancellableStatuses.includes(order.status)) return false;
  if (order.payment_status === 'cod_collected') return false;
  const lockedSplitStatuses = ['packed', 'ready_to_dispatch', 'shipped', 'dispatched', 'delivered'];
  return !(order.seller_orders || []).some(
    (so) =>
      lockedSplitStatuses.includes(so.fulfilment_status) ||
      so.cod_reconciliation_status === 'collected' ||
      so.cod_reconciliation_status === 'settled'
  );
}

export function canSellerCancelOrderStatus(uiStatus: string): boolean {
  return ['new', 'confirmed', 'processing'].includes(uiStatus);
}

export function canAdminCancelOrder(order: {
  orderStatus: string;
  paymentStatus: string;
  sellerOrders: { fulfilmentStatus: string; codReconciliationStatus?: string }[];
}): boolean {
  return (
    order.orderStatus !== 'cancelled' &&
    order.paymentStatus !== 'cod_collected' &&
    !order.sellerOrders.some(
      (so) =>
        so.fulfilmentStatus === 'delivered' ||
        so.codReconciliationStatus === 'collected' ||
        so.codReconciliationStatus === 'settled'
    )
  );
}
