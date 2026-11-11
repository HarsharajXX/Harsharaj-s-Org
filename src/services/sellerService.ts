import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { MEKHELA_IMAGE, DOKHONA_IMAGE } from '../data/mockData';

export type SellerProductStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'published'
  | 'rejected'
  | 'suspended'
  | 'archived';

export type SellerProductionMethod = 'handwoven' | 'handmade' | 'machine-made' | 'sourced';

export interface SellerProductDraft {
  id: string;
  name: string;
  description: string;
  community: string;
  category: string;
  material: string;
  productionMethod: SellerProductionMethod;
  fulfilmentType: 'ready-to-ship' | 'made-to-order';
  price: number;
  stockQuantity: number;
  sizes: string;
  colours: string;
  dispatchEstimate: string;
  images: string[];
  status: SellerProductStatus;
  rejectionReason?: string;
  updatedAt: string;
}

export interface SellerStoreProfile {
  storeName: string;
  ownerName: string;
  email: string;
  phone: string;
  location: string;
  sellerType: string;
  categories: string;
  description: string;
  socialLink: string;
  accountStatus: 'active' | 'pending_email_verification';
  payoutVerificationStatus: 'unverified' | 'pending' | 'verified';
}

export type SellerOrderStatus =
  | 'new'
  | 'confirmed'
  | 'processing'
  | 'ready_for_dispatch'
  | 'dispatched'
  | 'delivered'
  | 'cancelled';

export interface SellerOrderRecord {
  id: string;
  orderNumber: string;
  productName: string;
  quantity: number;
  amount: number;
  paymentMethod: 'Online' | 'COD';
  status: SellerOrderStatus;
  deliveryCity: string;
  courier?: string;
  trackingNumber?: string;
  createdAt: string;
}

export interface SellerNotification {
  id: string;
  type: 'product_approved' | 'product_rejected' | 'new_order' | 'order_status' | 'low_stock' | 'store_update';
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
}

export const DEMO_STORE_PROFILE: SellerStoreProfile = {
  storeName: 'Sualkuchi Loom Collective (Demo)',
  ownerName: 'Pranjal Das',
  email: 'seller@nohaj.com',
  phone: '+91 98640 00000',
  location: 'Sualkuchi, Kamrup, Assam',
  sellerType: 'Weaver Collective',
  categories: 'Mekhela Sador, Gamosa, Pat & Muga Silk',
  description: 'Demonstration store profile showcasing handwoven Assamese silk and cotton textiles.',
  socialLink: 'https://instagram.com/nohaj_demo',
  accountStatus: 'active',
  payoutVerificationStatus: 'unverified',
};

export const DEMO_SELLER_PRODUCTS: SellerProductDraft[] = [
  {
    id: 'sp-1',
    name: 'Traditional Assamese Mekhela Sador',
    description: 'Handwoven Pat & Muga silk Mekhela Sador with subtle golden motifs.',
    community: 'Assamese',
    category: 'Mekhela Sador',
    material: 'Pat & Muga Silk',
    productionMethod: 'handwoven',
    fulfilmentType: 'ready-to-ship',
    price: 14500,
    stockQuantity: 4,
    sizes: 'Free Size',
    colours: 'Warm Ivory & Gold',
    dispatchEstimate: '3-5 business days',
    images: [MEKHELA_IMAGE],
    status: 'published',
    updatedAt: '2026-02-15T10:00:00Z',
  },
  {
    id: 'sp-2',
    name: 'Handwoven Bodo Dokhona (Draft)',
    description: 'Earthy terracotta and ivory Dokhona with traditional geometric agor.',
    community: 'Bodo',
    category: 'Dokhona',
    material: 'Handspun Cotton & Eri',
    productionMethod: 'handwoven',
    fulfilmentType: 'made-to-order',
    price: 6800,
    stockQuantity: 2,
    sizes: 'Free Size',
    colours: 'Terracotta & Ivory',
    dispatchEstimate: '7-10 business days',
    images: [DOKHONA_IMAGE],
    status: 'pending_review',
    updatedAt: '2026-02-16T10:00:00Z',
  },
  {
    id: 'sp-3',
    name: 'Ceremonial Phulam Gamosa',
    description: 'Pure cotton ceremonial Gamosa.',
    community: 'Assamese',
    category: 'Gamosa & Stoles',
    material: 'Pure Cotton',
    productionMethod: 'handwoven',
    fulfilmentType: 'ready-to-ship',
    price: 950,
    stockQuantity: 0,
    sizes: 'Standard',
    colours: 'White & Red',
    dispatchEstimate: '2-3 business days',
    images: [MEKHELA_IMAGE],
    status: 'rejected',
    rejectionReason: 'Please upload clear close-up photographs of the woven border.',
    updatedAt: '2026-02-14T10:00:00Z',
  },
];

export const DEMO_SELLER_ORDERS: SellerOrderRecord[] = [
  {
    id: 'so-1',
    orderNumber: 'NHJ-402819',
    productName: 'Traditional Assamese Mekhela Sador',
    quantity: 1,
    amount: 14500,
    paymentMethod: 'Online',
    status: 'new',
    deliveryCity: 'Guwahati, Assam',
    createdAt: '2026-02-18T09:30:00Z',
  },
  {
    id: 'so-2',
    orderNumber: 'NHJ-402755',
    productName: 'Ceremonial Phulam Gamosa',
    quantity: 2,
    amount: 1900,
    paymentMethod: 'COD',
    status: 'processing',
    deliveryCity: 'Bengaluru, Karnataka',
    createdAt: '2026-02-17T14:15:00Z',
  },
];

export const DEMO_NOTIFICATIONS: SellerNotification[] = [
  {
    id: 'n-1',
    type: 'new_order',
    title: 'New Order Received (Demo)',
    message: 'Order NHJ-402819 for Traditional Assamese Mekhela Sador is awaiting confirmation.',
    createdAt: '2026-02-18T09:30:00Z',
    read: false,
  },
  {
    id: 'n-2',
    type: 'product_rejected',
    title: 'Product Needs Revision (Demo)',
    message: 'Ceremonial Phulam Gamosa was returned: Please upload clear close-up photographs.',
    createdAt: '2026-02-14T10:00:00Z',
    read: false,
  },
  {
    id: 'n-3',
    type: 'low_stock',
    title: 'Low Stock Alert (Demo)',
    message: 'Handwoven Bodo Dokhona has 2 units remaining.',
    createdAt: '2026-02-13T12:00:00Z',
    read: true,
  },
];

export const sellerService = {
  isLive(): boolean {
    return Boolean(isSupabaseConfigured && supabase);
  },
};
