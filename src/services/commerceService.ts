import { CartItem } from '../types';

export type ParentOrderStatus =
  | 'pending_payment'
  | 'confirmed'
  | 'processing'
  | 'partially_dispatched'
  | 'dispatched'
  | 'delivered'
  | 'cancelled'
  | 'partially_cancelled';

export type SellerFulfilmentStatus =
  | 'pending'
  | 'accepted'
  | 'processing'
  | 'ready_to_dispatch'
  | 'dispatched'
  | 'delivered'
  | 'cancelled';

export type PaymentStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'partially_refunded'
  | 'cod_pending'
  | 'cod_collected';

export interface MultiVendorSellerOrder {
  id: string;
  sellerId: string;
  sellerName: string;
  items: CartItem[];
  subtotal: number;
  commissionAmount: number;
  sellerPayoutAmount: number;
  fulfilmentStatus: SellerFulfilmentStatus;
  codReconciliationStatus: 'not_applicable' | 'awaiting_collection' | 'collected' | 'remitted' | 'settled';
  trackingNumber?: string;
}

export const commerceService = {
  splitCartBySeller(cart: CartItem[], commissionRate = 0.12, paymentMethod: 'cod' | 'online' = 'cod'): MultiVendorSellerOrder[] {
    const grouped = new Map<string, CartItem[]>();
    for (const item of cart) {
      const list = grouped.get(item.product.seller_id) || [];
      list.push(item);
      grouped.set(item.product.seller_id, list);
    }

    const sellerOrders: MultiVendorSellerOrder[] = [];
    grouped.forEach((items, sellerId) => {
      const subtotal = items.reduce((sum, i) => sum + i.product.price * i.quantity, 0);
      const commissionAmount = Math.round(subtotal * commissionRate);
      sellerOrders.push({
        id: `so-${sellerId}-${Date.now()}`,
        sellerId,
        sellerName: items[0].product.seller_name,
        items,
        subtotal,
        commissionAmount,
        sellerPayoutAmount: subtotal - commissionAmount,
        fulfilmentStatus: 'pending',
        codReconciliationStatus: paymentMethod === 'cod' ? 'awaiting_collection' : 'not_applicable',
      });
    });

    return sellerOrders;
  },
};
