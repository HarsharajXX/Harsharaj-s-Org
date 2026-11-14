import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { COMMUNITIES, PRODUCTS } from '../data/mockData';
import {
  AvailabilityStatus,
  Community,
  Order,
  Product,
  ProductVariant,
  ProductionMethod,
} from '../types';
import { prepareCheckoutItems } from '../utils/commerceRules';

export interface DataResult<T> {
  data: T;
  mode: 'live' | 'demo';
  error?: string;
}

export interface CategoryOption {
  id: string;
  name: string;
  slug: string;
}

interface PublicSellerDirectoryRow {
  id: string;
  business_name: string;
  is_payout_verified: boolean;
}

interface RawProductRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  price: number | string;
  community_id: string | null;
  category_id: string | null;
  occasion?: string[] | null;
  is_featured?: boolean | null;
  material: string;
  production_method: string;
  measurements: string | null;
  care_instructions: string | null;
  dispatch_time: string;
  availability: string;
  stock_quantity?: number;
  seller_id: string;
  created_at: string;
  communities?: { name: string; slug: string } | null;
  categories?: { name: string; slug: string } | null;
  product_images?: { storage_path: string; sort_order: number }[] | null;
  product_variants?: {
    id: string;
    product_id: string;
    size: string;
    colour: string;
    sku?: string | null;
    stock_quantity: number;
    price_override?: number | string | null;
  }[] | null;
}

export function resolveStorageImageUrl(
  path: string | null | undefined,
  bucket: 'product-images' | 'seller-assets' = 'product-images'
): string {
  if (!path) return '';
  if (
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('/') ||
    path.startsWith('data:')
  ) {
    return path;
  }
  if (!supabase) return path;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl || path;
}

function mapProductRow(
  row: RawProductRow,
  sellerLookup: Map<string, PublicSellerDirectoryRow>
): Product {
  const sortedImages = [...(row.product_images || [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((img) => resolveStorageImageUrl(img.storage_path, 'product-images'))
    .filter(Boolean);

  const variants: ProductVariant[] = (row.product_variants || []).map((v) => ({
    id: v.id,
    product_id: v.product_id || row.id,
    size: v.size,
    colour: v.colour,
    sku: v.sku ?? null,
    stock_quantity: Number(v.stock_quantity || 0),
    price_override:
      v.price_override !== null && v.price_override !== undefined
        ? Number(v.price_override)
        : null,
  }));

  const sizes = Array.from(new Set(variants.map((v) => v.size).filter(Boolean)));
  const colours = Array.from(new Set(variants.map((v) => v.colour).filter(Boolean)));
  const sellerInfo = sellerLookup.get(row.seller_id);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    community_id: row.community_id || '',
    community_name: row.communities?.name || 'Northeast India',
    community_slug: row.communities?.slug || 'assamese',
    category_id: row.category_id || '',
    category_name: row.categories?.name || 'Handwoven',
    occasion: Array.isArray(row.occasion) ? row.occasion : [],
    material: row.material,
    production_method: (row.production_method || 'Handwoven') as ProductionMethod,
    images: sortedImages,
    sizes: sizes.length > 0 ? sizes : ['Free Size'],
    measurements: row.measurements || 'Standard traditional drape',
    colours: colours.length > 0 ? colours : ['Natural'],
    variants,
    availability: (row.availability || 'In Stock') as AvailabilityStatus,
    stock_quantity: row.stock_quantity,
    dispatch_time: row.dispatch_time,
    seller_id: row.seller_id,
    seller_name: sellerInfo?.business_name || 'Verified Seller',
    care_instructions: row.care_instructions || 'Dry clean or gentle cold hand wash.',
    verification_status: sellerInfo?.is_payout_verified ? 'verified' : 'pending',
    is_featured: Boolean(row.is_featured),
    created_at: row.created_at,
  };
}

export const databaseService = {
  isLive(): boolean {
    return Boolean(isSupabaseConfigured && supabase);
  },

  async getCommunities(): Promise<DataResult<Community[]>> {
    if (!isSupabaseConfigured || !supabase) {
      return { data: COMMUNITIES, mode: 'demo' };
    }
    try {
      const { data, error } = await supabase
        .from('communities')
        .select('id, name, slug, state, description, cultural_note, cover_image')
        .order('name', { ascending: true });

      if (error) {
        return { data: [], mode: 'live', error: error.message };
      }
      const mapped = ((data || []) as Community[]).map((c) => ({
        ...c,
        cover_image: resolveStorageImageUrl(c.cover_image, 'product-images'),
      }));
      return { data: mapped, mode: 'live' };
    } catch (err) {
      return {
        data: [],
        mode: 'live',
        error: err instanceof Error ? err.message : 'Failed to load communities',
      };
    }
  },

  async getCategories(): Promise<DataResult<CategoryOption[]>> {
    if (!isSupabaseConfigured || !supabase) {
      return {
        data: [
          { id: 'cat-1', name: 'Mekhela Sador', slug: 'mekhela-sador' },
          { id: 'cat-2', name: 'Dokhona', slug: 'dokhona' },
          { id: 'cat-3', name: 'Gamosa & Stoles', slug: 'gamosa-stoles' },
          { id: 'cat-4', name: 'Traditional Sets', slug: 'traditional-sets' },
          { id: 'cat-5', name: 'Handwoven Textiles', slug: 'textiles' },
          { id: 'cat-6', name: 'Shawls & Wraps', slug: 'shawls' },
        ],
        mode: 'demo',
      };
    }
    try {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, slug')
        .order('name', { ascending: true });
      if (error) {
        return { data: [], mode: 'live', error: error.message };
      }
      return { data: (data || []) as CategoryOption[], mode: 'live' };
    } catch (err) {
      return {
        data: [],
        mode: 'live',
        error: err instanceof Error ? err.message : 'Failed to load categories',
      };
    }
  },

  async getPublishedProducts(): Promise<DataResult<Product[]>> {
    if (!isSupabaseConfigured || !supabase) {
      return { data: PRODUCTS, mode: 'demo' };
    }
    try {
      const { data, error } = await supabase
        .from('products')
        .select(`
          id, slug, name, description, price, community_id, category_id,
          occasion, is_featured, material, production_method, measurements,
          care_instructions, dispatch_time, availability, stock_quantity,
          seller_id, created_at,
          communities ( name, slug ),
          categories ( name, slug ),
          product_images ( storage_path, sort_order ),
          product_variants ( id, product_id, size, colour, sku, stock_quantity, price_override )
        `)
        .eq('approval_status', 'approved')
        .eq('is_published', true)
        .order('created_at', { ascending: false });

      if (error) {
        return { data: [], mode: 'live', error: error.message };
      }

      const rawRows = (data || []) as unknown as RawProductRow[];
      const sellerIds = Array.from(new Set(rawRows.map((r) => r.seller_id).filter(Boolean)));
      const sellerLookup = new Map<string, PublicSellerDirectoryRow>();

      if (sellerIds.length > 0) {
        const { data: sellerRows } = await supabase
          .from('public_seller_directory')
          .select('id, business_name, is_payout_verified')
          .in('id', sellerIds);

        for (const s of (sellerRows || []) as PublicSellerDirectoryRow[]) {
          sellerLookup.set(s.id, s);
        }
      }

      const mapped = rawRows.map((row) => mapProductRow(row, sellerLookup));
      return { data: mapped, mode: 'live' };
    } catch (err) {
      return {
        data: [],
        mode: 'live',
        error: err instanceof Error ? err.message : 'Failed to load products',
      };
    }
  },

  async getCustomerOrders(customerId: string): Promise<DataResult<Order[]>> {
    if (!isSupabaseConfigured || !supabase) {
      return { data: [], mode: 'demo' };
    }
    try {
      const [{ data, error }, { data: refundRows }] = await Promise.all([
        supabase
          .from('orders')
          .select(`
            id, order_number, customer_id, shipping_address, total_amount,
            shipping_amount, subtotal_paise, shipping_paise, total_paise,
            payment_method, payment_status, order_status, cod_lifecycle_status,
            reservation_expires_at, cancelled_at, cancellation_reason, created_at,
            order_items ( id, order_id, seller_order_id, product_id, variant_id, product_name, seller_id, quantity, unit_price, unit_price_paise, line_total_paise, refunded_quantity, refunded_paise, restocked_quantity ),
            seller_orders ( id, seller_id, subtotal, subtotal_paise, refund_paise, fulfilment_status, cod_reconciliation_status, cancelled_at, cancellation_reason )
          `)
          .eq('customer_id', customerId)
          .order('created_at', { ascending: false }),
        supabase.rpc('get_customer_refund_summaries'),
      ]);

      if (error) {
        return { data: [], mode: 'live', error: error.message };
      }

      const refundsByOrder = new Map<
        string,
        import('./payments/paymentTypes').CustomerRefundSummary[]
      >();
      for (const raw of (refundRows || []) as Record<string, unknown>[]) {
        const orderId = String(raw.order_id || '');
        if (!orderId) continue;
        const list = refundsByOrder.get(orderId) || [];
        list.push({
          refundId: String(raw.refund_id),
          orderId,
          sellerOrderId: raw.seller_order_id ? String(raw.seller_order_id) : null,
          refundChannel: raw.refund_channel === 'cod_manual' ? 'cod_manual' : 'razorpay',
          refundType: String(raw.refund_type || 'full'),
          amountPaise: Number(raw.amount_paise || 0),
          shippingRefundPaise: Number(raw.shipping_refund_paise || 0),
          status: (raw.status || 'pending') as 'pending' | 'processed' | 'failed',
          requestStatus: (raw.request_status || 'requested') as import('./payments/paymentTypes').RefundRequestStatus,
          reason: String(raw.reason || ''),
          rejectionReason: raw.rejection_reason ? String(raw.rejection_reason) : null,
          providerRefundId: raw.provider_refund_id ? String(raw.provider_refund_id) : null,
          manualReference: raw.manual_reference ? String(raw.manual_reference) : null,
          refundMethod: raw.refund_method ? String(raw.refund_method) : null,
          restockStatus: (raw.restock_status || 'not_applicable') as import('./payments/paymentTypes').RestockStatus,
          createdAt: String(raw.created_at || ''),
          processedAt: raw.processed_at ? String(raw.processed_at) : null,
        });
        refundsByOrder.set(orderId, list);
      }

      const orders: Order[] = (data || []).map((row: Record<string, unknown>) => {
        const addr = (row.shipping_address || {}) as Record<string, string>;
        const orderId = String(row.id);
        return {
          id: orderId,
          order_number: String(row.order_number || orderId),
          customer_id: String(row.customer_id),
          customer_name: addr.full_name || 'Customer',
          customer_email: addr.email || '',
          shipping_address: `${addr.line1 || ''}, ${addr.city || ''} - ${addr.postal_code || ''}`,
          total: Number(row.total_amount || 0),
          total_paise: typeof row.total_paise === 'number' ? row.total_paise : undefined,
          subtotal_paise: typeof row.subtotal_paise === 'number' ? row.subtotal_paise : undefined,
          shipping_amount: Number(row.shipping_amount || 0),
          shipping_paise: typeof row.shipping_paise === 'number' ? row.shipping_paise : undefined,
          payment_method: row.payment_method as 'cod' | 'online',
          status: String(row.order_status || 'pending'),
          payment_status: String(row.payment_status || 'pending'),
          cod_lifecycle_status: row.cod_lifecycle_status ? String(row.cod_lifecycle_status) : undefined,
          reservation_expires_at: row.reservation_expires_at ? String(row.reservation_expires_at) : null,
          cancelled_at: row.cancelled_at ? String(row.cancelled_at) : null,
          cancellation_reason: row.cancellation_reason ? String(row.cancellation_reason) : null,
          items: (row.order_items as Order['items']) || [],
          seller_orders: (row.seller_orders as Order['seller_orders']) || [],
          refunds: refundsByOrder.get(orderId) || [],
          is_demo: false,
          created_at: String(row.created_at),
        };
      });

      return { data: orders, mode: 'live' };
    } catch (err) {
      return {
        data: [],
        mode: 'live',
        error: err instanceof Error ? err.message : 'Failed to load orders',
      };
    }
  },

  async requestOrderRefund(params: {
    orderId: string;
    sellerOrderId?: string | null;
    items?: Array<{ order_item_id: string; quantity: number }> | null;
    amountPaise?: number | null;
    reason: string;
    idempotencyKey?: string;
  }): Promise<{ refundId?: string; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { error: 'Supabase is not configured.' };
    }
    const { data, error } = await supabase.rpc('request_order_refund', {
      p_order_id: params.orderId,
      p_seller_order_id: params.sellerOrderId ?? null,
      p_items: params.items ?? null,
      p_amount_paise: params.amountPaise ?? null,
      p_reason: params.reason,
      p_idempotency_key: params.idempotencyKey ?? null,
    });
    if (error) return { error: error.message };
    return { refundId: String(data) };
  },

  async createMultiVendorOrder(params: {
    shippingAddress: {
      full_name: string;
      email: string;
      phone: string;
      line1: string;
      city: string;
      state?: string;
      postal_code: string;
    };
    paymentMethod: 'cod' | 'online';
    items: { product_id: string; variant_id?: string | null; quantity: number }[];
  }): Promise<{ orderId: string | null; error?: string }> {
    if (params.paymentMethod === 'online') {
      return {
        orderId: null,
        error: 'Online payment gateway is not yet configured. Please select Cash on Delivery.',
      };
    }
    if (!isSupabaseConfigured || !supabase) {
      return { orderId: null, error: 'Supabase is not configured.' };
    }
    const normalizedItems = prepareCheckoutItems(params.items);
    const { data, error } = await supabase.rpc('create_multi_vendor_order', {
      p_shipping_address: params.shippingAddress,
      p_payment_method: params.paymentMethod,
      p_items: normalizedItems,
    });
    if (error) {
      return { orderId: null, error: error.message };
    }
    return { orderId: data as string };
  },

  async cancelCustomerOrder(
    orderId: string,
    reason = 'Cancelled by customer'
  ): Promise<{ ok: boolean; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { ok: false, error: 'Supabase is not configured.' };
    }
    const { error } = await supabase.rpc('cancel_customer_order', {
      p_order_id: orderId,
      p_reason: reason,
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  },

  async getWishlistProductIds(userId: string): Promise<string[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    const { data } = await supabase
      .from('wishlists')
      .select('product_id')
      .eq('user_id', userId);
    return (data || []).map((r: { product_id: string }) => r.product_id);
  },

  async toggleWishlistItem(userId: string, productId: string, add: boolean): Promise<{ error?: string }> {
    if (!isSupabaseConfigured || !supabase) return {};
    if (add) {
      const { error } = await supabase
        .from('wishlists')
        .upsert({ user_id: userId, product_id: productId }, { onConflict: 'user_id,product_id' });
      return error ? { error: error.message } : {};
    } else {
      const { error } = await supabase
        .from('wishlists')
        .delete()
        .eq('user_id', userId)
        .eq('product_id', productId);
      return error ? { error: error.message } : {};
    }
  },
};
