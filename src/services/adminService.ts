import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { UserRole } from './auth';
import { MEKHELA_IMAGE, DOKHONA_IMAGE } from '../data/mockData';

export type AdminTab =
  | 'overview'
  | 'sellers'
  | 'moderation'
  | 'orders'
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
    'customers',
    'communities',
    'returns',
    'content',
    'settings',
    'audit',
  ],
  operations_admin: ['overview', 'sellers', 'orders', 'customers', 'returns'],
  content_admin: ['overview', 'moderation', 'communities', 'content'],
};

export function canAccessAdminTab(role: UserRole, tab: AdminTab): boolean {
  const allowed = ADMIN_ROLE_PERMISSIONS[role];
  return Boolean(allowed && allowed.includes(tab));
}

export interface AdminSellerRecord {
  id: string;
  businessName: string;
  ownerName: string;
  location: string;
  accountStatus: 'active' | 'suspended';
  payoutVerification: 'unverified' | 'pending' | 'verified';
  productCount: number;
  orderCount: number;
}

export interface AdminProductSubmission {
  id: string;
  name: string;
  sellerName: string;
  community: string;
  category: string;
  material: string;
  productionMethod: string;
  price: number;
  stock: number;
  image: string;
  status: 'pending_review' | 'approved' | 'published' | 'rejected' | 'suspended' | 'archived';
  feedback?: string;
}

export interface AdminOrderRecord {
  id: string;
  orderNumber: string;
  customerName: string;
  total: number;
  paymentMethod: 'Online' | 'COD';
  paymentStatus: 'paid' | 'cod_pending' | 'cod_collected';
  orderStatus: 'pending' | 'confirmed' | 'fulfilled' | 'cancelled';
  sellerOrders: { sellerName: string; fulfilmentStatus: string; subtotal: number }[];
  createdAt: string;
}

export interface AdminAuditLog {
  id: string;
  actorRole: string;
  action: string;
  target: string;
  details: string;
  createdAt: string;
}

export interface MarketplaceSettings {
  commissionRate: number;
  codEnabled: boolean;
  freeShippingThreshold: number;
  returnWindowDays: number;
}

export const DEMO_ADMIN_SELLERS: AdminSellerRecord[] = [
  {
    id: 'sel-1',
    businessName: 'Sualkuchi Loom Collective (Demo)',
    ownerName: 'Pranjal Das',
    location: 'Sualkuchi, Assam',
    accountStatus: 'active',
    payoutVerification: 'verified',
    productCount: 3,
    orderCount: 2,
  },
  {
    id: 'sel-2',
    businessName: 'Kokrajhar Heritage Weaves (Demo)',
    ownerName: 'Bimala Basumatary',
    location: 'Kokrajhar, Assam',
    accountStatus: 'active',
    payoutVerification: 'pending',
    productCount: 1,
    orderCount: 0,
  },
];

export const DEMO_ADMIN_SUBMISSIONS: AdminProductSubmission[] = [
  {
    id: 'sub-1',
    name: 'Handwoven Bodo Dokhona',
    sellerName: 'Kokrajhar Heritage Weaves (Demo)',
    community: 'Bodo',
    category: 'Dokhona',
    material: 'Handspun Cotton & Eri',
    productionMethod: 'handwoven',
    price: 6800,
    stock: 2,
    image: DOKHONA_IMAGE,
    status: 'pending_review',
  },
  {
    id: 'sub-2',
    name: 'Traditional Assamese Mekhela Sador',
    sellerName: 'Sualkuchi Loom Collective (Demo)',
    community: 'Assamese',
    category: 'Mekhela Sador',
    material: 'Pat & Muga Silk',
    productionMethod: 'handwoven',
    price: 14500,
    stock: 4,
    image: MEKHELA_IMAGE,
    status: 'published',
  },
];

export const DEMO_ADMIN_ORDERS: AdminOrderRecord[] = [
  {
    id: 'ord-1',
    orderNumber: 'NHJ-402819',
    customerName: 'Ananya Baruah (Demo)',
    total: 14500,
    paymentMethod: 'Online',
    paymentStatus: 'paid',
    orderStatus: 'confirmed',
    sellerOrders: [
      { sellerName: 'Sualkuchi Loom Collective (Demo)', fulfilmentStatus: 'new', subtotal: 14500 },
    ],
    createdAt: '2026-02-18T09:30:00Z',
  },
  {
    id: 'ord-2',
    orderNumber: 'NHJ-402755',
    customerName: 'Rohan Kalita (Demo)',
    total: 1900,
    paymentMethod: 'COD',
    paymentStatus: 'cod_pending',
    orderStatus: 'pending',
    sellerOrders: [
      { sellerName: 'Sualkuchi Loom Collective (Demo)', fulfilmentStatus: 'processing', subtotal: 1900 },
    ],
    createdAt: '2026-02-17T14:15:00Z',
  },
];

export const adminService = {
  isLive(): boolean {
    return Boolean(isSupabaseConfigured && supabase);
  },
};
