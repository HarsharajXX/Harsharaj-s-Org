export type ProductionMethod = 'Handwoven' | 'Powerloom' | 'Artisan-Crafted' | 'Traditional Loom';
export type AvailabilityStatus = 'In Stock' | 'Made to Order' | 'Limited Run' | 'Out of Stock';
export type VerificationStatus = 'verified' | 'pending' | 'demo';

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
  availability: AvailabilityStatus;
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
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  seller_id: string;
  quantity: number;
  unit_price: number;
}

export interface Order {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_email: string;
  shipping_address: string;
  total: number;
  shipping_amount: number;
  status: 'Confirmed (Demo)' | 'Preparing Shipment' | 'Dispatched' | 'Delivered';
  payment_status: 'Demo Checkout';
  items: OrderItem[];
  created_at: string;
}

export interface CustomerUser {
  id: string;
  name: string;
  email: string;
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
  community_association?: string;
  description: string;
  social_link?: string;
  additional_info?: string;
  status: 'submitted' | 'under_review';
  created_at: string;
}
