import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { MEKHELA_IMAGE, DOKHONA_IMAGE } from '../data/mockData';
import type { ProductionMethod, SellerAccountStatus } from '../types';
import type { SellerRefundSummary } from './payments/paymentTypes';
import type {
  SellerSettlementAccount,
  SellerSettlementOnboardingInput,
  SellerSettlementPayoutRecord,
  SellerSettlementSummary,
  SellerTransferItem,
} from './payments/settlementTypes';
import { resolveStorageImageUrl } from './database';

export type SellerProductStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'published'
  | 'rejected'
  | 'suspended'
  | 'archived';

export type SellerProductionMethod = ProductionMethod;

export interface SellerProductDraft {
  id: string;
  name: string;
  description: string;
  community: string;
  category: string;
  occasion: string[];
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
  emailVerified: boolean;
  accountStatus: SellerAccountStatus;
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

export interface SellerLedgerEntry {
  id: string;
  entryType: string;
  direction: 'debit' | 'credit';
  amountPaise: number;
  description: string;
  referenceId?: string | null;
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

export const DEMO_SELLER_REFUNDS: SellerRefundSummary[] = [];
export const DEMO_SELLER_LEDGER: SellerLedgerEntry[] = [];
export const DEMO_SELLER_SETTLEMENT_ACCOUNT: SellerSettlementAccount | null = null;
export const DEMO_SELLER_SETTLEMENT_SUMMARY: SellerSettlementSummary = {
  sellerId: 'demo-seller',
  grossSalesPaise: 1450000,
  commissionPaise: 174000,
  refundDeductionsPaise: 0,
  sellerPayablePaise: 1276000,
  pendingTransfersPaise: 0,
  settledPaise: 0,
  failedTransfersPaise: 0,
  reversedTransfersPaise: 0,
  codCollectedPaise: 0,
  codRemittedPaise: 0,
  codOutstandingPaise: 190000,
};
export const DEMO_SELLER_TRANSFERS: SellerTransferItem[] = [];
export const DEMO_SELLER_SETTLEMENT_RECORDS: SellerSettlementPayoutRecord[] = [];

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
  emailVerified: true,
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
    occasion: ['Weddings & Celebrations', 'Festivals & Cultural Events'],
    material: 'Pat & Muga Silk',
    productionMethod: 'Handwoven',
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
    occasion: ['Festivals & Cultural Events', 'Everyday Traditional Wear'],
    material: 'Handspun Cotton & Eri',
    productionMethod: 'Handwoven',
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
    occasion: ['Gifts & Special Occasions'],
    material: 'Pure Cotton',
    productionMethod: 'Handwoven',
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

function mapProductStatus(approvalStatus: string, isPublished: boolean): SellerProductStatus {
  if (approvalStatus === 'approved' && isPublished) return 'published';
  if (approvalStatus === 'approved') return 'approved';
  if (approvalStatus === 'pending_review') return 'pending_review';
  if (approvalStatus === 'rejected') return 'rejected';
  if (approvalStatus === 'suspended') return 'suspended';
  if (approvalStatus === 'archived') return 'archived';
  return 'draft';
}

function mapFulfilmentToUi(status: string): SellerOrderStatus {
  if (status === 'accepted') return 'confirmed';
  if (status === 'ready_to_dispatch' || status === 'packed') return 'ready_for_dispatch';
  if (status === 'shipped' || status === 'dispatched') return 'dispatched';
  if (status === 'delivered') return 'delivered';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'processing') return 'processing';
  return 'new';
}

function normalizeProductionMethod(value: unknown): SellerProductionMethod {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'traditional loom') return 'Traditional Loom';
  if (normalized === 'artisan-crafted') return 'Artisan-Crafted';
  if (normalized === 'handmade') return 'Handmade';
  if (normalized === 'powerloom' || normalized === 'machine-made') return 'Powerloom';
  if (normalized === 'sourced') return 'Sourced';
  return 'Handwoven';
}

function normalizeSellerAccountStatus(value: unknown): SellerAccountStatus {
  const s = String(value || '');
  if (
    s === 'pending_email_verification' ||
    s === 'pending_approval' ||
    s === 'active' ||
    s === 'suspended' ||
    s === 'rejected'
  ) {
    return s;
  }
  return 'pending_email_verification';
}

function mapUiToFulfilment(status: SellerOrderStatus): string {
  if (status === 'confirmed') return 'accepted';
  if (status === 'ready_for_dispatch') return 'ready_to_dispatch';
  if (status === 'new') return 'pending';
  return status;
}

export const sellerService = {
  isLive(): boolean {
    return Boolean(isSupabaseConfigured && supabase);
  },

  async fetchWorkspace(userId: string): Promise<{
    sellerId: string | null;
    storeProfile: SellerStoreProfile | null;
    products: SellerProductDraft[];
    orders: SellerOrderRecord[];
    refunds: SellerRefundSummary[];
    ledgerEntries: SellerLedgerEntry[];
    notifications: SellerNotification[];
    settlementAccount: SellerSettlementAccount | null;
    settlementSummary: SellerSettlementSummary | null;
    transfers: SellerTransferItem[];
    settlementRecords: SellerSettlementPayoutRecord[];
    commissionRate: number;
    error?: string;
  }> {
    if (!this.isLive() || !supabase) {
      return {
        sellerId: 'demo-seller',
        storeProfile: DEMO_STORE_PROFILE,
        products: DEMO_SELLER_PRODUCTS,
        orders: DEMO_SELLER_ORDERS,
        refunds: DEMO_SELLER_REFUNDS,
        ledgerEntries: DEMO_SELLER_LEDGER,
        notifications: DEMO_NOTIFICATIONS,
        settlementAccount: DEMO_SELLER_SETTLEMENT_ACCOUNT,
        settlementSummary: DEMO_SELLER_SETTLEMENT_SUMMARY,
        transfers: DEMO_SELLER_TRANSFERS,
        settlementRecords: DEMO_SELLER_SETTLEMENT_RECORDS,
        commissionRate: 0.12,
      };
    }

    const { data: sp, error: spErr } = await supabase
      .from('seller_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (spErr) {
      return {
        sellerId: null,
        storeProfile: null,
        products: [],
        orders: [],
        refunds: [],
        ledgerEntries: [],
        notifications: [],
        settlementAccount: null,
        settlementSummary: null,
        transfers: [],
        settlementRecords: [],
        commissionRate: 0.12,
        error: spErr.message,
      };
    }

    if (!sp) {
      return {
        sellerId: null,
        storeProfile: null,
        products: [],
        orders: [],
        refunds: [],
        ledgerEntries: [],
        notifications: [],
        settlementAccount: null,
        settlementSummary: null,
        transfers: [],
        settlementRecords: [],
        commissionRate: 0.12,
        error: 'No seller profile found for this account.',
      };
    }

    const [
      { data: prodRows },
      { data: orderRows },
      { data: notifRows },
      { data: settingsRow },
      { data: refundRows },
      { data: ledgerRows },
      { data: settlementAccountRow },
      { data: summaryRows },
      { data: transferRows },
      { data: settlementRecRows },
    ] = await Promise.all([
      supabase
        .from('products')
        .select(`
          id, name, description, price, material, production_method, occasion,
          fulfilment_type, stock_quantity, dispatch_time, approval_status,
          is_published, rejection_reason, updated_at,
          communities ( name ),
          categories ( name ),
          product_images ( storage_path, sort_order )
        `)
        .eq('seller_id', sp.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('seller_orders')
        .select(`
          id, subtotal, fulfilment_status, created_at,
          orders ( order_number, payment_method, shipping_address ),
          order_items ( product_name, quantity ),
          shipments ( carrier, tracking_number )
        `)
        .eq('seller_id', sp.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('notifications')
        .select('id, type, title, message, is_read, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      supabase.from('marketplace_settings').select('commission_rate').eq('id', 1).maybeSingle(),
      supabase.rpc('get_seller_refund_summaries'),
      supabase
        .from('financial_ledger_entries')
        .select('id, entry_type, direction, amount_paise, description, reference_id, created_at')
        .eq('seller_id', sp.id)
        .order('created_at', { ascending: false })
        .limit(40),
      supabase
        .from('seller_settlement_accounts')
        .select(
          'id, seller_id, legal_business_name, business_type, contact_name, contact_email, contact_phone, pan_last4, gstin, beneficiary_name, bank_account_last4, bank_ifsc, settlement_destination_type, registered_address, kyc_storage_paths, kyc_status, route_onboarding_status, payouts_enabled, razorpay_linked_account_id, razorpay_product_id, razorpay_raw_activation_status, kyc_requirements, rejection_reason, seller_consent_accepted, agreement_accepted, agreement_version, last_synced_at, updated_at'
        )
        .eq('seller_id', sp.id)
        .maybeSingle(),
      supabase.rpc('get_seller_settlement_summary', { p_seller_id: sp.id }),
      supabase
        .from('seller_transfers')
        .select(
          'id, seller_order_id, order_id, seller_id, provider_transfer_id, amount_paise, reversed_paise, status, settlement_status, on_hold, hold_until, settlement_id, provider_settlement_utr, failure_reason, retry_count, created_at, settled_at, orders ( order_number )'
        )
        .eq('seller_id', sp.id)
        .order('created_at', { ascending: false })
        .limit(40),
      supabase
        .from('settlement_records')
        .select('id, seller_id, seller_transfer_id, provider_settlement_id, utr, amount_paise, status, settled_at, created_at')
        .eq('seller_id', sp.id)
        .order('created_at', { ascending: false })
        .limit(40),
    ]);

    const products: SellerProductDraft[] = (prodRows || []).map((row: Record<string, unknown>) => {
      const comm = row.communities as { name?: string } | null;
      const cat = row.categories as { name?: string } | null;
      const imgs = (row.product_images as { storage_path: string; sort_order: number }[] | null) || [];
      return {
        id: String(row.id),
        name: String(row.name),
        description: String(row.description || ''),
        community: comm?.name || 'Assamese',
        category: cat?.name || 'Mekhela Sador',
        occasion: Array.isArray(row.occasion) ? (row.occasion as string[]) : [],
        material: String(row.material || ''),
        productionMethod: normalizeProductionMethod(row.production_method),
        fulfilmentType: (row.fulfilment_type || 'ready-to-ship') as 'ready-to-ship' | 'made-to-order',
        price: Number(row.price || 0),
        stockQuantity: Number(row.stock_quantity || 0),
        sizes: 'Free Size',
        colours: 'Natural',
        dispatchEstimate: String(row.dispatch_time || '3-5 business days'),
        images: [...imgs]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((i) => resolveStorageImageUrl(i.storage_path, 'product-images'))
          .filter(Boolean),
        status: mapProductStatus(String(row.approval_status), Boolean(row.is_published)),
        rejectionReason: row.rejection_reason ? String(row.rejection_reason) : undefined,
        updatedAt: String(row.updated_at || new Date().toISOString()),
      };
    });

    const orders: SellerOrderRecord[] = (orderRows || []).map((row: Record<string, unknown>) => {
      const parent = (row.orders || {}) as {
        order_number?: string;
        payment_method?: string;
        shipping_address?: { city?: string; state?: string };
      };
      const items = (row.order_items as { product_name: string; quantity: number }[] | null) || [];
      const shipments = (row.shipments as { carrier?: string; tracking_number?: string }[] | null) || [];
      const firstItem = items[0];
      const itemLabel =
        items.length > 1
          ? `${firstItem?.product_name || 'Order Item'} (+${items.length - 1} more)`
          : firstItem?.product_name || 'Marketplace Item';
      const totalQty = items.reduce((sum, i) => sum + Number(i.quantity || 1), 0) || 1;

      return {
        id: String(row.id),
        orderNumber: parent.order_number || String(row.id).slice(0, 8),
        productName: itemLabel,
        quantity: totalQty,
        amount: Number(row.subtotal || 0),
        paymentMethod: parent.payment_method === 'cod' ? 'COD' : 'Online',
        status: mapFulfilmentToUi(String(row.fulfilment_status || 'pending')),
        deliveryCity: [parent.shipping_address?.city, parent.shipping_address?.state]
          .filter(Boolean)
          .join(', ') || 'India',
        courier: shipments[0]?.carrier || undefined,
        trackingNumber: shipments[0]?.tracking_number || undefined,
        createdAt: String(row.created_at || new Date().toISOString()),
      };
    });

    const notifications: SellerNotification[] = (notifRows || []).map((n: Record<string, unknown>) => ({
      id: String(n.id),
      type: (n.type || 'store_update') as SellerNotification['type'],
      title: String(n.title),
      message: String(n.message),
      createdAt: String(n.created_at),
      read: Boolean(n.is_read),
    }));

    const refunds: SellerRefundSummary[] = (refundRows || []).map((r: Record<string, unknown>) => ({
      refundId: String(r.refund_id),
      orderId: String(r.order_id),
      orderNumber: String(r.order_number || r.order_id),
      sellerOrderId: String(r.seller_order_id),
      refundChannel: r.refund_channel === 'cod_manual' ? 'cod_manual' : 'razorpay',
      refundType: String(r.refund_type || 'full'),
      grossRefundPaise: Number(r.gross_refund_paise || 0),
      commissionReversedPaise: Number(r.commission_reversed_paise || 0),
      sellerPayableReversedPaise: Number(r.seller_payable_reversed_paise || 0),
      courierDeductionPaise: Number(r.courier_deduction_paise || 0),
      status: (r.status || 'pending') as 'pending' | 'processed' | 'failed',
      requestStatus: (r.request_status || 'requested') as SellerRefundSummary['requestStatus'],
      reason: String(r.reason || ''),
      restockStatus: (r.restock_status || 'not_applicable') as SellerRefundSummary['restockStatus'],
      createdAt: String(r.created_at || ''),
      processedAt: r.processed_at ? String(r.processed_at) : null,
    }));

    const ledgerEntries: SellerLedgerEntry[] = (ledgerRows || []).map((l: Record<string, unknown>) => ({
      id: String(l.id),
      entryType: String(l.entry_type),
      direction: l.direction === 'debit' ? 'debit' : 'credit',
      amountPaise: Number(l.amount_paise || 0),
      description: String(l.description || ''),
      referenceId: l.reference_id ? String(l.reference_id) : null,
      createdAt: String(l.created_at || ''),
    }));

    const settlementAccount: SellerSettlementAccount | null = settlementAccountRow
      ? {
          id: String(settlementAccountRow.id),
          sellerId: String(settlementAccountRow.seller_id),
          legalBusinessName: String(settlementAccountRow.legal_business_name || ''),
          businessType: String(settlementAccountRow.business_type || 'individual'),
          contactName: String(settlementAccountRow.contact_name || ''),
          contactEmail: String(settlementAccountRow.contact_email || ''),
          contactPhone: String(settlementAccountRow.contact_phone || ''),
          panLast4: String(settlementAccountRow.pan_last4 || ''),
          gstin: settlementAccountRow.gstin ? String(settlementAccountRow.gstin) : null,
          beneficiaryName: String(settlementAccountRow.beneficiary_name || ''),
          bankAccountLast4: String(settlementAccountRow.bank_account_last4 || ''),
          bankIfsc: String(settlementAccountRow.bank_ifsc || ''),
          settlementDestinationType:
            settlementAccountRow.settlement_destination_type === 'upi_vpa'
              ? 'upi_vpa'
              : 'bank_account',
          registeredAddress:
            (settlementAccountRow.registered_address as SellerSettlementAccount['registeredAddress']) ||
            null,
          kycStoragePaths: Array.isArray(settlementAccountRow.kyc_storage_paths)
            ? (settlementAccountRow.kyc_storage_paths as string[])
            : [],
          kycStatus: (settlementAccountRow.kyc_status || 'not_started') as SellerSettlementAccount['kycStatus'],
          routeOnboardingStatus: (settlementAccountRow.route_onboarding_status ||
            'not_started') as SellerSettlementAccount['routeOnboardingStatus'],
          payoutsEnabled: Boolean(settlementAccountRow.payouts_enabled),
          razorpayLinkedAccountId: settlementAccountRow.razorpay_linked_account_id
            ? String(settlementAccountRow.razorpay_linked_account_id)
            : null,
          razorpayProductId: settlementAccountRow.razorpay_product_id
            ? String(settlementAccountRow.razorpay_product_id)
            : null,
          razorpayRawActivationStatus: settlementAccountRow.razorpay_raw_activation_status
            ? String(settlementAccountRow.razorpay_raw_activation_status)
            : null,
          kycRequirements: Array.isArray(settlementAccountRow.kyc_requirements)
            ? (settlementAccountRow.kyc_requirements as Array<Record<string, unknown>>)
            : [],
          rejectionReason: settlementAccountRow.rejection_reason
            ? String(settlementAccountRow.rejection_reason)
            : null,
          sellerConsentAccepted: Boolean(settlementAccountRow.seller_consent_accepted),
          agreementAccepted: Boolean(settlementAccountRow.agreement_accepted),
          agreementVersion: settlementAccountRow.agreement_version
            ? String(settlementAccountRow.agreement_version)
            : null,
          lastSyncedAt: settlementAccountRow.last_synced_at
            ? String(settlementAccountRow.last_synced_at)
            : null,
          updatedAt: String(settlementAccountRow.updated_at || ''),
        }
      : null;

    const rawSum = Array.isArray(summaryRows) ? summaryRows[0] : summaryRows;
    const settlementSummary: SellerSettlementSummary | null = rawSum
      ? {
          sellerId: String(rawSum.seller_id || sp.id),
          grossSalesPaise: Number(rawSum.gross_sales_paise || 0),
          commissionPaise: Number(rawSum.commission_paise || 0),
          refundDeductionsPaise: Number(rawSum.refund_deductions_paise || 0),
          sellerPayablePaise: Number(rawSum.seller_payable_paise || 0),
          pendingTransfersPaise: Number(rawSum.pending_transfers_paise || 0),
          settledPaise: Number(rawSum.settled_paise || 0),
          failedTransfersPaise: Number(rawSum.failed_transfers_paise || 0),
          reversedTransfersPaise: Number(rawSum.reversed_transfers_paise || 0),
          codCollectedPaise: Number(rawSum.cod_collected_paise || 0),
          codRemittedPaise: Number(rawSum.cod_remitted_paise || 0),
          codOutstandingPaise: Number(rawSum.cod_outstanding_paise || 0),
        }
      : null;

    const transfers: SellerTransferItem[] = (transferRows || []).map((t: Record<string, unknown>) => {
      const ordRel = t.orders as { order_number?: string } | null;
      return {
        id: String(t.id),
        sellerOrderId: String(t.seller_order_id),
        orderId: String(t.order_id),
        orderNumber: ordRel?.order_number || String(t.order_id).slice(0, 8),
        sellerId: String(t.seller_id),
        providerTransferId: t.provider_transfer_id ? String(t.provider_transfer_id) : null,
        amountPaise: Number(t.amount_paise || 0),
        reversedPaise: Number(t.reversed_paise || 0),
        status: (t.status || 'pending') as SellerTransferItem['status'],
        settlementStatus: (t.settlement_status || 'pending') as SellerTransferItem['settlementStatus'],
        onHold: Boolean(t.on_hold),
        holdUntil: t.hold_until ? String(t.hold_until) : null,
        settlementId: t.settlement_id ? String(t.settlement_id) : null,
        settlementUtr: t.provider_settlement_utr ? String(t.provider_settlement_utr) : null,
        failureReason: t.failure_reason ? String(t.failure_reason) : null,
        retryCount: Number(t.retry_count || 0),
        createdAt: String(t.created_at || ''),
        settledAt: t.settled_at ? String(t.settled_at) : null,
      };
    });

    const settlementRecords: SellerSettlementPayoutRecord[] = (settlementRecRows || []).map(
      (sr: Record<string, unknown>) => ({
        id: String(sr.id),
        sellerId: String(sr.seller_id),
        sellerTransferId: sr.seller_transfer_id ? String(sr.seller_transfer_id) : null,
        providerSettlementId: sr.provider_settlement_id ? String(sr.provider_settlement_id) : null,
        utr: sr.utr ? String(sr.utr) : null,
        amountPaise: Number(sr.amount_paise || 0),
        status: (sr.status || 'pending') as SellerSettlementPayoutRecord['status'],
        settledAt: sr.settled_at ? String(sr.settled_at) : null,
        createdAt: String(sr.created_at || ''),
      })
    );

    return {
      sellerId: String(sp.id),
      storeProfile: {
        storeName: String(sp.business_name),
        ownerName: String(sp.owner_name),
        email: String(sp.contact_email),
        phone: String(sp.contact_phone || ''),
        location: String(sp.location || ''),
        sellerType: String(sp.seller_type || 'Artisan'),
        categories: Array.isArray(sp.categories) ? sp.categories.join(', ') : '',
        description: String(sp.bio || ''),
        socialLink: String(sp.social_link || ''),
        emailVerified: Boolean(sp.email_verified),
        accountStatus: normalizeSellerAccountStatus(sp.account_status),
        payoutVerificationStatus:
          sp.payout_verification_status === 'verified'
            ? 'verified'
            : sp.payout_verification_status === 'pending'
              ? 'pending'
              : 'unverified',
      },
      products,
      orders,
      refunds,
      ledgerEntries,
      notifications,
      settlementAccount,
      settlementSummary,
      transfers,
      settlementRecords,
      commissionRate: settingsRow?.commission_rate ? Number(settingsRow.commission_rate) : 0.12,
    };
  },

  async updateStoreProfile(
    sellerId: string,
    profile: SellerStoreProfile
  ): Promise<{ error?: string }> {
    if (!this.isLive() || !supabase) return {};
    const { error } = await supabase
      .from('seller_profiles')
      .update({
        business_name: profile.storeName,
        owner_name: profile.ownerName,
        contact_phone: profile.phone,
        location: profile.location,
        bio: profile.description,
        social_link: profile.socialLink,
      })
      .eq('id', sellerId);
    return error ? { error: error.message } : {};
  },

  async createProduct(
    sellerId: string,
    payload: {
      name: string;
      description: string;
      communityName: string;
      categoryName?: string;
      occasion?: string[];
      material: string;
      productionMethod: SellerProductionMethod;
      fulfilmentType: 'ready-to-ship' | 'made-to-order';
      price: number;
      stockQuantity: number;
      dispatchEstimate: string;
    },
    submitForReview: boolean
  ): Promise<{ id?: string; error?: string }> {
    if (!this.isLive() || !supabase) return { id: `sp-${Date.now()}` };

    const [{ data: commRow }, { data: catRow }] = await Promise.all([
      supabase
        .from('communities')
        .select('id')
        .ilike('name', payload.communityName)
        .maybeSingle(),
      payload.categoryName
        ? supabase
            .from('categories')
            .select('id')
            .ilike('name', payload.categoryName)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const slug = `${payload.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}`;

    const { data, error } = await supabase
      .from('products')
      .insert({
        seller_id: sellerId,
        community_id: commRow?.id || null,
        category_id: catRow?.id || null,
        occasion: payload.occasion || [],
        slug,
        name: payload.name,
        description: payload.description || payload.name,
        price: payload.price,
        material: payload.material,
        production_method: normalizeProductionMethod(payload.productionMethod),
        fulfilment_type: payload.fulfilmentType,
        stock_quantity: payload.stockQuantity,
        dispatch_time: payload.dispatchEstimate,
        availability: payload.stockQuantity <= 0 ? 'Out of Stock' : 'In Stock',
        approval_status: submitForReview ? 'pending_review' : 'draft',
        is_published: false,
      })
      .select('id')
      .single();

    if (error) return { error: error.message };
    return { id: String(data.id) };
  },

  async updateStockQuantity(productId: string, newQty: number): Promise<{ error?: string }> {
    if (!this.isLive() || !supabase) return {};
    const { error } = await supabase
      .from('products')
      .update({
        stock_quantity: newQty,
        availability: newQty <= 0 ? 'Out of Stock' : 'In Stock',
      })
      .eq('id', productId);
    return error ? { error: error.message } : {};
  },

  async cancelSellerOrder(
    sellerOrderId: string,
    reason = 'Cancelled by seller'
  ): Promise<{ error?: string }> {
    if (!this.isLive() || !supabase) return {};
    const { error } = await supabase.rpc('cancel_seller_order', {
      p_seller_order_id: sellerOrderId,
      p_reason: reason,
    });
    return error ? { error: error.message } : {};
  },

  async updateOrderStatus(
    sellerOrderId: string,
    status: SellerOrderStatus,
    courier?: string,
    trackingNumber?: string
  ): Promise<{ error?: string }> {
    if (!this.isLive() || !supabase) return {};
    if (status === 'cancelled') {
      return this.cancelSellerOrder(sellerOrderId);
    }

    const { error } = await supabase
      .from('seller_orders')
      .update({ fulfilment_status: mapUiToFulfilment(status) })
      .eq('id', sellerOrderId);
    if (error) return { error: error.message };

    if (courier || trackingNumber) {
      await supabase.from('shipments').insert({
        seller_order_id: sellerOrderId,
        carrier: courier || null,
        tracking_number: trackingNumber || null,
        shipped_at: new Date().toISOString(),
      });
    }
    return {};
  },

  async inspectReturnedRestock(
    refundId: string,
    decision: 'restocked' | 'rejected_damaged',
    inspectionNotes?: string
  ): Promise<{ restockedUnits?: number; error?: string }> {
    if (!this.isLive() || !supabase) return { restockedUnits: decision === 'restocked' ? 1 : 0 };
    const { data, error } = await supabase.rpc('approve_returned_item_restock', {
      p_refund_id: refundId,
      p_return_id: null,
      p_decision: decision,
      p_inspection_notes: inspectionNotes || null,
    });
    if (error) return { error: error.message };
    return { restockedUnits: Number((data as { restocked_units?: number } | null)?.restocked_units || 0) };
  },

  async uploadSettlementKycDocument(
    userId: string,
    file: File
  ): Promise<{ path?: string; error?: string }> {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    const storagePath = `${userId}/kyc-${Date.now()}-${safeName}`;
    if (!this.isLive() || !supabase) {
      return { path: storagePath };
    }
    const { error } = await supabase.storage
      .from('seller-verification-docs')
      .upload(storagePath, file, { upsert: false });
    if (error) return { error: error.message };
    return { path: storagePath };
  },

  async submitSettlementOnboarding(
    input: SellerSettlementOnboardingInput
  ): Promise<{ accountId?: string; error?: string }> {
    if (!this.isLive() || !supabase) {
      return { accountId: `ssa-demo-${Date.now()}` };
    }
    const { data, error } = await supabase.rpc('submit_seller_settlement_onboarding', {
      p_legal_business_name: input.legalBusinessName,
      p_business_type: input.businessType,
      p_contact_name: input.contactName,
      p_contact_email: input.contactEmail,
      p_contact_phone: input.contactPhone,
      p_pan_last4: input.panLast4.trim().toUpperCase(),
      p_gstin: input.gstin?.trim().toUpperCase() || null,
      p_beneficiary_name: input.beneficiaryName,
      p_bank_account_last4: input.bankAccountLast4.trim(),
      p_bank_ifsc: input.bankIfsc.trim().toUpperCase(),
      p_settlement_destination_type: input.settlementDestinationType || 'bank_account',
      p_registered_address: input.registeredAddress,
      p_kyc_storage_paths: input.kycStoragePaths,
      p_seller_consent_accepted: input.sellerConsentAccepted,
      p_agreement_accepted: input.agreementAccepted,
      p_agreement_version: input.agreementVersion || 'nohaj-route-seller-v1',
    });
    if (error) return { error: error.message };
    return { accountId: String(data) };
  },
};
