export type ProductionMethod =
  | 'Handwoven'
  | 'Traditional Loom'
  | 'Artisan-Crafted'
  | 'Handmade'
  | 'Powerloom'
  | 'Sourced';
export type AvailabilityStatus = 'In Stock' | 'Made to Order' | 'Limited Run' | 'Out of Stock';
export type VerificationStatus = 'verified' | 'pending' | 'demo';
export type SellerAccountStatus =
  | 'pending_email_verification'
  | 'pending_approval'
  | 'active'
  | 'suspended'
  | 'rejected';

export type UserRole =
  | 'customer'
  | 'seller'
  | 'super_admin'
  | 'operations_admin'
  | 'content_admin';

export interface Community {
  id: string;
  name: string;
  slug: string;
  state: string;
  description: string;
  cultural_note: string;
  cover_image: string;
}

export interface Seller {
  id: string;
  business_name: string;
  owner_name: string;
  location: string;
  verification_status: VerificationStatus;
  created_at: string;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  size: string;
  colour: string;
  sku?: string | null;
  stock_quantity: number;
  price_override?: number | null;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  description: string;
  price: number;
  community_id: string;
  community_name: string;
  community_slug: string;
  category_id: string;
  category_name: string;
  occasion: string[];
  material: string;
  production_method: ProductionMethod;
  images: string[];
  sizes: string[];
  measurements: string;
  colours: string[];
  variants?: ProductVariant[];
  availability: AvailabilityStatus;
  stock_quantity?: number;
  dispatch_time: string;
  seller_id: string;
  seller_name: string;
  care_instructions: string;
  verification_status: VerificationStatus;
  is_featured?: boolean;
  created_at: string;
}

export interface Artisan {
  id: string;
  slug: string;
  name: string;
  location: string;
  craft_specialisation: string;
  community_association?: string;
  portrait_image: string;
  workshop_image: string;
  biography: string;
  craft_story: string;
  product_ids: string[];
  is_demo: boolean;
}

export interface CartItem {
  product: Product;
  quantity: number;
  selectedSize: string;
  selectedColour: string;
  variantId?: string;
  unitPrice?: number;
}

export interface OrderItem {
  id: string;
  order_id: string;
  seller_order_id?: string;
  product_id: string;
  variant_id?: string | null;
  product_name: string;
  seller_id: string;
  quantity: number;
  unit_price: number;
  unit_price_paise?: number;
  line_total_paise?: number;
  refunded_quantity?: number;
  refunded_paise?: number;
  restocked_quantity?: number;
}

export interface SellerOrderSummary {
  id: string;
  seller_id: string;
  seller_name?: string;
  subtotal: number;
  subtotal_paise?: number;
  commission_amount_paise?: number;
  seller_payable_paise?: number;
  refund_paise?: number;
  outstanding_balance_paise?: number;
  fulfilment_status: string;
  cod_reconciliation_status?: string;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
}

export interface Order {
  id: string;
  order_number?: string;
  customer_id: string;
  customer_name: string;
  customer_email: string;
  shipping_address: string;
  total: number;
  total_paise?: number;
  subtotal_paise?: number;
  shipping_amount: number;
  shipping_paise?: number;
  payment_method?: 'cod' | 'online';
  status: string;
  payment_status: string;
  cod_lifecycle_status?: string;
  reservation_expires_at?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  items: OrderItem[];
  seller_orders?: SellerOrderSummary[];
  refunds?: import('../services/payments/paymentTypes').CustomerRefundSummary[];
  is_demo?: boolean;
  created_at: string;
}

export interface CustomerUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  roles: UserRole[];
  saved_addresses: string[];
  is_demo: boolean;
}

export interface SellerApplication {
  id: string;
  applicant_name: string;
  business_name: string;
  phone: string;
  email: string;
  location: string;
  categories: string[];
  description: string;
  status: 'submitted' | 'under_review';
  created_at: string;
}
