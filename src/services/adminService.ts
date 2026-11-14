import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { UserRole } from './auth';
import { MEKHELA_IMAGE, DOKHONA_IMAGE } from '../data/mockData';
import type { SellerAccountStatus } from '../types';
import { resolveStorageImageUrl } from './database';
import { getPaymentProvider } from './payments/paymentProvider';
import type {
  CodCancellationStage,
  RefundItemRequest,
  RefundRequestStatus,
  RestockStatus,
} from './payments/paymentTypes';
import type {
  AdminReconciliationRun,
  AdminRouteGatewayState,
  AdminTransferReversalItem,
  SellerSettlementAccount,
  SellerSettlementPayoutRecord,
  SellerTransferItem,
} from './payments/settlementTypes';
import {
  ADMIN_ROLE_PERMISSIONS,
  AdminTab,
  canAccessAdminTab,
} from '../utils/commerceRules';

export { ADMIN_ROLE_PERMISSIONS, canAccessAdminTab };
export type { AdminTab };

export interface AdminSellerRecord {
  id: string;
  businessName: string;
  ownerName: string;
  location: string;
  emailVerified: boolean;
  accountStatus: SellerAccountStatus;
  payoutVerification: 'unverified' | 'pending' | 'verified';
  productCount: number;
  orderCount: number;
}

export interface AdminProductSubmission {
  id: string;
  name: string;
  sellerId: string;
  sellerName: string;
  sellerStatus?: SellerAccountStatus;
  community: string;
  category: string;
  occasion: string[];
  material: string;
  productionMethod: string;
  price: number;
  stock: number;
  image: string;
  isFeatured: boolean;
  status: 'draft' | 'pending_review' | 'approved' | 'published' | 'rejected' | 'suspended' | 'archived';
  feedback?: string;
}

export interface AdminOrderRecord {
  id: string;
  orderNumber: string;
  customerName: string;
  total: number;
  totalPaise: number;
  paymentMethod: 'Online' | 'COD';
  paymentStatus: string;
  orderStatus: string;
  sellerOrders: {
    id: string;
    sellerName: string;
    fulfilmentStatus: string;
    codReconciliationStatus?: string;
    subtotal: number;
    subtotalPaise: number;
  }[];
  createdAt: string;
}

export interface AdminRefundRecord {
  id: string;
  orderId: string;
  orderNumber: string;
  sellerOrderId?: string | null;
  refundChannel: 'razorpay' | 'cod_manual';
  refundType: string;
  amountPaise: number;
  shippingRefundPaise: number;
  status: 'pending' | 'processed' | 'failed';
  requestStatus: RefundRequestStatus;
  providerRefundId?: string | null;
  manualReference?: string | null;
  refundMethod?: string | null;
  reason: string;
  rejectionReason?: string | null;
  failureReason?: string | null;
  internalNotes?: string | null;
  restockRequired: boolean;
  restockStatus: RestockStatus;
  sellerAdjustments: {
    sellerOrderId: string;
    sellerName?: string;
    grossRefundPaise: number;
    commissionReversedPaise: number;
    sellerPayableReversedPaise: number;
  }[];
  createdAt: string;
  processedAt?: string | null;
}

export interface AdminCodRecord {
  id: string;
  orderId: string;
  orderNumber: string;
  sellerOrderId: string;
  sellerName: string;
  codOrderValuePaise: number;
  collectedAmountPaise: number;
  refundedAmountPaise: number;
  courierDeductionPaise: number;
  collectionStatus: string;
  reconciliationStatus: string;
  cancellationStage?: string | null;
}

export interface AdminLedgerEntry {
  id: string;
  orderId: string;
  sellerOrderId?: string | null;
  entryType: string;
  direction: 'debit' | 'credit';
  amountPaise: number;
  description: string;
  referenceId?: string | null;
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
    emailVerified: true,
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
    emailVerified: true,
    accountStatus: 'pending_approval',
    payoutVerification: 'pending',
    productCount: 1,
    orderCount: 0,
  },
];

export const DEMO_ADMIN_SUBMISSIONS: AdminProductSubmission[] = [
  {
    id: 'sub-1',
    name: 'Handwoven Bodo Dokhona',
    sellerId: 'sel-2',
    sellerName: 'Kokrajhar Heritage Weaves (Demo)',
    sellerStatus: 'pending_approval',
    community: 'Bodo',
    category: 'Dokhona',
    occasion: ['Festivals & Cultural Events'],
    material: 'Handspun Cotton & Eri',
    productionMethod: 'Handwoven',
    price: 6800,
    stock: 2,
    image: DOKHONA_IMAGE,
    isFeatured: false,
    status: 'pending_review',
  },
  {
    id: 'sub-2',
    name: 'Traditional Assamese Mekhela Sador',
    sellerId: 'sel-1',
    sellerName: 'Sualkuchi Loom Collective (Demo)',
    sellerStatus: 'active',
    community: 'Assamese',
    category: 'Mekhela Sador',
    occasion: ['Weddings & Celebrations'],
    material: 'Pat & Muga Silk',
    productionMethod: 'Handwoven',
    price: 14500,
    stock: 4,
    image: MEKHELA_IMAGE,
    isFeatured: true,
    status: 'published',
  },
];

export const DEMO_ADMIN_ORDERS: AdminOrderRecord[] = [
  {
    id: 'ord-1',
    orderNumber: 'NHJ-402819',
    customerName: 'Ananya Baruah (Demo)',
    total: 14500,
    totalPaise: 1450000,
    paymentMethod: 'Online',
    paymentStatus: 'paid',
    orderStatus: 'confirmed',
    sellerOrders: [
      {
        id: 'so-1',
        sellerName: 'Sualkuchi Loom Collective (Demo)',
        fulfilmentStatus: 'pending',
        codReconciliationStatus: 'not_applicable',
        subtotal: 14500,
        subtotalPaise: 1450000,
      },
    ],
    createdAt: '2026-02-18T09:30:00Z',
  },
  {
    id: 'ord-2',
    orderNumber: 'NHJ-402755',
    customerName: 'Rohan Kalita (Demo)',
    total: 1900,
    totalPaise: 190000,
    paymentMethod: 'COD',
    paymentStatus: 'cod_pending',
    orderStatus: 'pending',
    sellerOrders: [
      {
        id: 'so-2',
        sellerName: 'Sualkuchi Loom Collective (Demo)',
        fulfilmentStatus: 'processing',
        codReconciliationStatus: 'awaiting_collection',
        subtotal: 1900,
        subtotalPaise: 190000,
      },
    ],
    createdAt: '2026-02-17T14:15:00Z',
  },
];

export const DEMO_ADMIN_REFUNDS: AdminRefundRecord[] = [];
export const DEMO_ADMIN_COD_RECORDS: AdminCodRecord[] = [];
export const DEMO_ADMIN_LEDGER_ENTRIES: AdminLedgerEntry[] = [];
export const DEMO_ROUTE_GATEWAY: AdminRouteGatewayState = {
  razorpayRouteEnabled: false,
  routeApprovalStatus: 'not_approved',
  onlinePaymentsEnabled: false,
  razorpayMode: 'test',
};
export const DEMO_ADMIN_SETTLEMENT_ACCOUNTS: SellerSettlementAccount[] = [];
export const DEMO_ADMIN_TRANSFERS: SellerTransferItem[] = [];
export const DEMO_ADMIN_TRANSFER_REVERSALS: AdminTransferReversalItem[] = [];
export const DEMO_ADMIN_SETTLEMENT_RECORDS: SellerSettlementPayoutRecord[] = [];
export const DEMO_ADMIN_RECONCILIATION_RUNS: AdminReconciliationRun[] = [];

export const adminService = {
  isLive(): boolean {
    return Boolean(isSupabaseConfigured && supabase);
  },

  async fetchAdminData(adminRole: UserRole = 'content_admin'): Promise<{
    sellers: AdminSellerRecord[];
    submissions: AdminProductSubmission[];
    orders: AdminOrderRecord[];
    refunds: AdminRefundRecord[];
    codRecords: AdminCodRecord[];
    ledgerEntries: AdminLedgerEntry[];
    settlementAccounts: SellerSettlementAccount[];
    transfers: SellerTransferItem[];
    transferReversals: AdminTransferReversalItem[];
    settlementRecords: SellerSettlementPayoutRecord[];
    reconciliationRuns: AdminReconciliationRun[];
    routeGateway: AdminRouteGatewayState;
    settings: MarketplaceSettings;
    auditLogs: AdminAuditLog[];
    customerCount: number;
    error?: string;
  }> {
    const defaultSettings: MarketplaceSettings = {
      commissionRate: 12,
      codEnabled: true,
      freeShippingThreshold: 5000,
      returnWindowDays: 7,
    };

    if (!this.isLive() || !supabase) {
      return {
        sellers: adminRole === 'content_admin' ? [] : DEMO_ADMIN_SELLERS,
        submissions: adminRole === 'operations_admin' ? [] : DEMO_ADMIN_SUBMISSIONS,
        orders: adminRole === 'content_admin' ? [] : DEMO_ADMIN_ORDERS,
        refunds: adminRole === 'content_admin' ? [] : DEMO_ADMIN_REFUNDS,
        codRecords: adminRole === 'content_admin' ? [] : DEMO_ADMIN_COD_RECORDS,
        ledgerEntries: adminRole === 'content_admin' ? [] : DEMO_ADMIN_LEDGER_ENTRIES,
        settlementAccounts: adminRole === 'content_admin' ? [] : DEMO_ADMIN_SETTLEMENT_ACCOUNTS,
        transfers: adminRole === 'content_admin' ? [] : DEMO_ADMIN_TRANSFERS,
        transferReversals: adminRole === 'content_admin' ? [] : DEMO_ADMIN_TRANSFER_REVERSALS,
        settlementRecords: adminRole === 'content_admin' ? [] : DEMO_ADMIN_SETTLEMENT_RECORDS,
        reconciliationRuns: adminRole === 'content_admin' ? [] : DEMO_ADMIN_RECONCILIATION_RUNS,
        routeGateway: DEMO_ROUTE_GATEWAY,
        settings: defaultSettings,
        auditLogs:
          adminRole === 'super_admin'
            ? [
                {
                  id: 'log-1',
                  actorRole: 'super_admin',
                  action: 'INITIALIZE_MARKETPLACE',
                  target: 'marketplace_settings',
                  details: 'Default commission set to 12% (Demo Mode)',
                  createdAt: new Date().toISOString(),
                },
              ]
            : [],
        customerCount: adminRole === 'content_admin' ? 0 : 2,
      };
    }

    const validSellerStatuses: SellerAccountStatus[] = [
      'pending_email_verification',
      'pending_approval',
      'active',
      'suspended',
      'rejected',
    ];

    // Content Admin: strictly scoped to product moderation & editorial duties.
    // Never queries seller_profiles, orders, seller_orders, profiles, payments, or audit_logs.
    if (adminRole === 'content_admin') {
      const [{ data: productRows, error: prodErr }, { data: sellerSummaries, error: summaryErr }] =
        await Promise.all([
          supabase
            .from('products')
            .select(`
              id, seller_id, name, material, production_method, occasion, is_featured,
              price, stock_quantity, approval_status, is_published, rejection_reason,
              communities ( name ),
              categories ( name ),
              product_images ( storage_path, sort_order )
            `)
            .order('created_at', { ascending: false }),
          supabase.rpc('get_moderation_seller_summary'),
        ]);

      if (prodErr || summaryErr) {
        return {
          sellers: [],
          submissions: [],
          orders: [],
          refunds: [],
          codRecords: [],
          ledgerEntries: [],
          settlementAccounts: [],
          transfers: [],
          transferReversals: [],
          settlementRecords: [],
          reconciliationRuns: [],
          routeGateway: DEMO_ROUTE_GATEWAY,
          settings: defaultSettings,
          auditLogs: [],
          customerCount: 0,
          error: prodErr?.message || summaryErr?.message,
        };
      }

      const sellerSummaryMap = new Map<
        string,
        { business_name: string; account_status: SellerAccountStatus }
      >();
      for (const s of (sellerSummaries || []) as {
        id: string;
        business_name: string;
        account_status: string;
      }[]) {
        const status = validSellerStatuses.includes(s.account_status as SellerAccountStatus)
          ? (s.account_status as SellerAccountStatus)
          : 'pending_approval';
        sellerSummaryMap.set(s.id, { business_name: s.business_name, account_status: status });
      }

      const submissions: AdminProductSubmission[] = (productRows || []).map(
        (p: Record<string, unknown>) => {
          const sellerId = String(p.seller_id || '');
          const summary = sellerSummaryMap.get(sellerId);
          const comm = p.communities as { name?: string } | null;
          const cat = p.categories as { name?: string } | null;
          const imgs = (p.product_images as { storage_path: string; sort_order: number }[] | null) || [];
          const sortedImgs = [...imgs].sort((a, b) => a.sort_order - b.sort_order);
          const approvalStatus = String(p.approval_status || 'pending_review');
          const isPublished = Boolean(p.is_published);

          return {
            id: String(p.id),
            name: String(p.name),
            sellerId,
            sellerName: summary?.business_name || 'Seller',
            sellerStatus: summary?.account_status,
            community: comm?.name || 'Northeast India',
            category: cat?.name || 'Handwoven',
            occasion: Array.isArray(p.occasion) ? (p.occasion as string[]) : [],
            material: String(p.material || ''),
            productionMethod: String(p.production_method || 'Handwoven'),
            price: Number(p.price || 0),
            stock: Number(p.stock_quantity || 0),
            image: resolveStorageImageUrl(sortedImgs[0]?.storage_path, 'product-images') || MEKHELA_IMAGE,
            isFeatured: Boolean(p.is_featured),
            status:
              approvalStatus === 'approved' && isPublished
                ? 'published'
                : (approvalStatus as AdminProductSubmission['status']),
            feedback: p.rejection_reason ? String(p.rejection_reason) : undefined,
          };
        }
      );

      return {
        sellers: [],
        submissions,
        orders: [],
        refunds: [],
        codRecords: [],
        ledgerEntries: [],
        settlementAccounts: [],
        transfers: [],
        transferReversals: [],
        settlementRecords: [],
        reconciliationRuns: [],
        routeGateway: DEMO_ROUTE_GATEWAY,
        settings: defaultSettings,
        auditLogs: [],
        customerCount: 0,
      };
    }

    const canViewAuditLogs = adminRole === 'super_admin';

    const [
      { data: sellerRows, error: sellerErr },
      { data: productRows },
      { data: orderRows, error: orderErr },
      { data: settingsRow },
      auditResult,
      { count: customerCount },
      { data: refundRows },
      { data: codRows },
      { data: ledgerRows },
      { data: gatewayRow },
      { data: settlementAcctRows },
      { data: transferRows },
      { data: reversalRows },
      { data: settlementRecRows },
      { data: reconRows },
    ] = await Promise.all([
      supabase
        .from('seller_profiles')
        .select('id, business_name, owner_name, location, email_verified, account_status, payout_verification_status')
        .order('created_at', { ascending: false }),
      supabase
        .from('products')
        .select(`
          id, seller_id, name, material, production_method, occasion, is_featured,
          price, stock_quantity, approval_status, is_published, rejection_reason,
          communities ( name ),
          categories ( name ),
          product_images ( storage_path, sort_order )
        `)
        .order('created_at', { ascending: false }),
      supabase
        .from('orders')
        .select(`
          id, order_number, shipping_address, total_amount, total_paise, payment_method,
          payment_status, order_status, created_at,
          seller_orders ( id, seller_id, subtotal, subtotal_paise, fulfilment_status, cod_reconciliation_status, seller_profiles ( business_name ) )
        `)
        .order('created_at', { ascending: false }),
      supabase.from('marketplace_settings').select('*').eq('id', 1).maybeSingle(),
      canViewAuditLogs
        ? supabase
            .from('audit_logs')
            .select('id, actor_id, action, target_table, details, created_at')
            .order('created_at', { ascending: false })
            .limit(50)
        : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase
        .from('refund_records')
        .select(`
          id, order_id, seller_order_id, refund_channel, refund_type,
          amount_paise, shipping_refund_paise, status, request_status,
          provider_refund_id, manual_reference, refund_method, reason,
          rejection_reason, failure_reason, restock_required, restock_status,
          created_at, processed_at,
          orders ( order_number ),
          refund_internal_notes ( internal_notes ),
          refund_seller_adjustments ( seller_order_id, gross_refund_paise, commission_reversed_paise, seller_payable_reversed_paise, seller_profiles ( business_name ) )
        `)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('cod_collection_records')
        .select(`
          id, order_id, seller_order_id, cod_order_value_paise,
          collected_amount_paise, refunded_amount_paise, courier_deduction_paise,
          collection_status, reconciliation_status, cod_cancellation_stage,
          orders ( order_number ),
          seller_profiles ( business_name )
        `)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('financial_ledger_entries')
        .select('id, order_id, seller_order_id, entry_type, direction, amount_paise, description, reference_id, created_at')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('payment_gateway_config')
        .select('online_payments_enabled, razorpay_mode, razorpay_route_enabled, route_approval_status')
        .eq('id', 1)
        .maybeSingle(),
      supabase
        .from('seller_settlement_accounts')
        .select(
          'id, seller_id, legal_business_name, business_type, contact_name, contact_email, contact_phone, pan_last4, gstin, beneficiary_name, bank_account_last4, bank_ifsc, settlement_destination_type, registered_address, kyc_storage_paths, kyc_status, route_onboarding_status, payouts_enabled, razorpay_linked_account_id, razorpay_product_id, razorpay_raw_activation_status, kyc_requirements, rejection_reason, seller_consent_accepted, agreement_accepted, agreement_version, last_synced_at, updated_at, seller_profiles ( business_name )'
        )
        .order('updated_at', { ascending: false })
        .limit(100),
      supabase
        .from('seller_transfers')
        .select(
          'id, seller_order_id, order_id, seller_id, provider_transfer_id, amount_paise, reversed_paise, status, settlement_status, on_hold, hold_until, settlement_id, provider_settlement_utr, failure_reason, retry_count, created_at, settled_at, orders ( order_number ), seller_profiles ( business_name )'
        )
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('seller_transfer_reversals')
        .select('id, seller_transfer_id, seller_order_id, order_id, refund_id, provider_reversal_id, amount_paise, status, reason, failure_reason, created_at, processed_at')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('settlement_records')
        .select('id, seller_id, seller_transfer_id, provider_settlement_id, utr, amount_paise, status, settled_at, created_at')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('reconciliation_runs')
        .select('id, run_type, status, checked_count, discrepancy_count, summary, created_at, completed_at')
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    if (sellerErr || orderErr) {
      return {
        sellers: [],
        submissions: [],
        orders: [],
        refunds: [],
        codRecords: [],
        ledgerEntries: [],
        settlementAccounts: [],
        transfers: [],
        transferReversals: [],
        settlementRecords: [],
        reconciliationRuns: [],
        routeGateway: DEMO_ROUTE_GATEWAY,
        settings: defaultSettings,
        auditLogs: [],
        customerCount: 0,
        error: sellerErr?.message || orderErr?.message,
      };
    }

    const sellerNameLookup = new Map<
      string,
      { business_name: string; account_status: SellerAccountStatus }
    >();
    for (const s of (sellerRows || []) as Record<string, unknown>[]) {
      const rawStatus = String(s.account_status || 'pending_email_verification');
      const accountStatus = validSellerStatuses.includes(rawStatus as SellerAccountStatus)
        ? (rawStatus as SellerAccountStatus)
        : 'pending_email_verification';
      sellerNameLookup.set(String(s.id), {
        business_name: String(s.business_name),
        account_status: accountStatus,
      });
    }

    const productCountBySeller = new Map<string, number>();
    for (const p of (productRows || []) as Record<string, unknown>[]) {
      const sid = String(p.seller_id || '');
      if (sid) productCountBySeller.set(sid, (productCountBySeller.get(sid) || 0) + 1);
    }

    const orderCountBySeller = new Map<string, number>();
    for (const o of (orderRows || []) as Record<string, unknown>[]) {
      const soList = (o.seller_orders as { seller_id?: string }[] | null) || [];
      for (const so of soList) {
        if (so.seller_id) {
          orderCountBySeller.set(so.seller_id, (orderCountBySeller.get(so.seller_id) || 0) + 1);
        }
      }
    }

    const sellers: AdminSellerRecord[] = (sellerRows || []).map((s: Record<string, unknown>) => {
      const id = String(s.id);
      const rawStatus = String(s.account_status || 'pending_email_verification');
      const accountStatus = validSellerStatuses.includes(rawStatus as SellerAccountStatus)
        ? (rawStatus as SellerAccountStatus)
        : 'pending_email_verification';

      return {
        id,
        businessName: String(s.business_name),
        ownerName: String(s.owner_name),
        location: String(s.location),
        emailVerified: Boolean(s.email_verified),
        accountStatus,
        payoutVerification:
          s.payout_verification_status === 'verified'
            ? 'verified'
            : s.payout_verification_status === 'pending'
              ? 'pending'
              : 'unverified',
        productCount: productCountBySeller.get(id) || 0,
        orderCount: orderCountBySeller.get(id) || 0,
      };
    });

    const submissions: AdminProductSubmission[] = (productRows || []).map(
      (p: Record<string, unknown>) => {
        const sellerId = String(p.seller_id || '');
        const sp = sellerNameLookup.get(sellerId);
        const comm = p.communities as { name?: string } | null;
        const cat = p.categories as { name?: string } | null;
        const imgs = (p.product_images as { storage_path: string; sort_order: number }[] | null) || [];
        const sortedImgs = [...imgs].sort((a, b) => a.sort_order - b.sort_order);
        const approvalStatus = String(p.approval_status || 'pending_review');
        const isPublished = Boolean(p.is_published);

        return {
          id: String(p.id),
          name: String(p.name),
          sellerId,
          sellerName: sp?.business_name || 'Seller',
          sellerStatus: sp?.account_status,
          community: comm?.name || 'Northeast India',
          category: cat?.name || 'Handwoven',
          occasion: Array.isArray(p.occasion) ? (p.occasion as string[]) : [],
          material: String(p.material || ''),
          productionMethod: String(p.production_method || 'Handwoven'),
          price: Number(p.price || 0),
          stock: Number(p.stock_quantity || 0),
          image: resolveStorageImageUrl(sortedImgs[0]?.storage_path, 'product-images') || MEKHELA_IMAGE,
          isFeatured: Boolean(p.is_featured),
          status:
            approvalStatus === 'approved' && isPublished
              ? 'published'
              : (approvalStatus as AdminProductSubmission['status']),
          feedback: p.rejection_reason ? String(p.rejection_reason) : undefined,
        };
      }
    );

    const orders: AdminOrderRecord[] = (orderRows || []).map((o: Record<string, unknown>) => {
      const addr = (o.shipping_address || {}) as { full_name?: string };
      const soList =
        (o.seller_orders as {
          id?: string;
          subtotal: number;
          subtotal_paise?: number;
          fulfilment_status: string;
          cod_reconciliation_status?: string;
          seller_profiles?: { business_name?: string } | null;
        }[] | null) || [];
      const totalInr = Number(o.total_amount || 0);
      return {
        id: String(o.id),
        orderNumber: String(o.order_number || o.id),
        customerName: addr.full_name || 'Customer',
        total: totalInr,
        totalPaise: typeof o.total_paise === 'number' ? o.total_paise : Math.round(totalInr * 100),
        paymentMethod: o.payment_method === 'cod' ? 'COD' : 'Online',
        paymentStatus: String(o.payment_status || 'pending'),
        orderStatus: String(o.order_status || 'pending'),
        sellerOrders: soList.map((so) => {
          const subInr = Number(so.subtotal || 0);
          return {
            id: String(so.id || ''),
            sellerName: so.seller_profiles?.business_name || 'Seller',
            fulfilmentStatus: so.fulfilment_status,
            codReconciliationStatus: so.cod_reconciliation_status,
            subtotal: subInr,
            subtotalPaise:
              typeof so.subtotal_paise === 'number' ? so.subtotal_paise : Math.round(subInr * 100),
          };
        }),
        createdAt: String(o.created_at),
      };
    });

    const refunds: AdminRefundRecord[] = (refundRows || []).map((r: Record<string, unknown>) => {
      const orderRel = r.orders as { order_number?: string } | null;
      const noteRel = r.refund_internal_notes as
        | { internal_notes?: string }
        | { internal_notes?: string }[]
        | null;
      const internalNotes = Array.isArray(noteRel)
        ? noteRel[0]?.internal_notes
        : noteRel?.internal_notes;
      const adjRows =
        (r.refund_seller_adjustments as {
          seller_order_id: string;
          gross_refund_paise: number;
          commission_reversed_paise: number;
          seller_payable_reversed_paise: number;
          seller_profiles?: { business_name?: string } | null;
        }[] | null) || [];

      return {
        id: String(r.id),
        orderId: String(r.order_id),
        orderNumber: orderRel?.order_number || String(r.order_id).slice(0, 8),
        sellerOrderId: r.seller_order_id ? String(r.seller_order_id) : null,
        refundChannel: r.refund_channel === 'cod_manual' ? 'cod_manual' : 'razorpay',
        refundType: String(r.refund_type || 'full'),
        amountPaise: Number(r.amount_paise || 0),
        shippingRefundPaise: Number(r.shipping_refund_paise || 0),
        status: (r.status || 'pending') as 'pending' | 'processed' | 'failed',
        requestStatus: (r.request_status || 'requested') as RefundRequestStatus,
        providerRefundId: r.provider_refund_id ? String(r.provider_refund_id) : null,
        manualReference: r.manual_reference ? String(r.manual_reference) : null,
        refundMethod: r.refund_method ? String(r.refund_method) : null,
        reason: String(r.reason || ''),
        rejectionReason: r.rejection_reason ? String(r.rejection_reason) : null,
        failureReason: r.failure_reason ? String(r.failure_reason) : null,
        internalNotes: internalNotes || null,
        restockRequired: Boolean(r.restock_required),
        restockStatus: (r.restock_status || 'not_applicable') as RestockStatus,
        sellerAdjustments: adjRows.map((a) => ({
          sellerOrderId: String(a.seller_order_id),
          sellerName: a.seller_profiles?.business_name || 'Seller',
          grossRefundPaise: Number(a.gross_refund_paise || 0),
          commissionReversedPaise: Number(a.commission_reversed_paise || 0),
          sellerPayableReversedPaise: Number(a.seller_payable_reversed_paise || 0),
        })),
        createdAt: String(r.created_at || ''),
        processedAt: r.processed_at ? String(r.processed_at) : null,
      };
    });

    const codRecords: AdminCodRecord[] = (codRows || []).map((c: Record<string, unknown>) => {
      const orderRel = c.orders as { order_number?: string } | null;
      const sellerRel = c.seller_profiles as { business_name?: string } | null;
      return {
        id: String(c.id),
        orderId: String(c.order_id),
        orderNumber: orderRel?.order_number || String(c.order_id).slice(0, 8),
        sellerOrderId: String(c.seller_order_id),
        sellerName: sellerRel?.business_name || 'Seller',
        codOrderValuePaise: Number(c.cod_order_value_paise || 0),
        collectedAmountPaise: Number(c.collected_amount_paise || 0),
        refundedAmountPaise: Number(c.refunded_amount_paise || 0),
        courierDeductionPaise: Number(c.courier_deduction_paise || 0),
        collectionStatus: String(c.collection_status || 'pending_confirmation'),
        reconciliationStatus: String(c.reconciliation_status || 'awaiting_collection'),
        cancellationStage: c.cod_cancellation_stage ? String(c.cod_cancellation_stage) : null,
      };
    });

    const ledgerEntries: AdminLedgerEntry[] = (ledgerRows || []).map((l: Record<string, unknown>) => ({
      id: String(l.id),
      orderId: String(l.order_id),
      sellerOrderId: l.seller_order_id ? String(l.seller_order_id) : null,
      entryType: String(l.entry_type),
      direction: l.direction === 'debit' ? 'debit' : 'credit',
      amountPaise: Number(l.amount_paise || 0),
      description: String(l.description || ''),
      referenceId: l.reference_id ? String(l.reference_id) : null,
      createdAt: String(l.created_at || ''),
    }));

    const auditLogs: AdminAuditLog[] = (auditResult?.data || []).map(
      (a: Record<string, unknown>) => ({
        id: String(a.id),
        actorRole: a.actor_id ? String(a.actor_id).slice(0, 8) : 'admin',
        action: String(a.action),
        target: String(a.target_table),
        details: a.details ? JSON.stringify(a.details) : '',
        createdAt: String(a.created_at),
      })
    );

    const routeGateway: AdminRouteGatewayState = gatewayRow
      ? {
          razorpayRouteEnabled: Boolean(gatewayRow.razorpay_route_enabled),
          routeApprovalStatus: (gatewayRow.route_approval_status ||
            'not_approved') as AdminRouteGatewayState['routeApprovalStatus'],
          onlinePaymentsEnabled: Boolean(gatewayRow.online_payments_enabled),
          razorpayMode: gatewayRow.razorpay_mode === 'live' ? 'live' : 'test',
        }
      : DEMO_ROUTE_GATEWAY;

    const settlementAccounts: SellerSettlementAccount[] = (settlementAcctRows || []).map(
      (s: Record<string, unknown>) => {
        const spRel = s.seller_profiles as { business_name?: string } | null;
        return {
          id: String(s.id),
          sellerId: String(s.seller_id),
          sellerName: spRel?.business_name || String(s.legal_business_name || 'Seller'),
          legalBusinessName: String(s.legal_business_name || ''),
          businessType: String(s.business_type || 'individual'),
          contactName: String(s.contact_name || ''),
          contactEmail: String(s.contact_email || ''),
          contactPhone: String(s.contact_phone || ''),
          panLast4: String(s.pan_last4 || ''),
          gstin: s.gstin ? String(s.gstin) : null,
          beneficiaryName: String(s.beneficiary_name || ''),
          bankAccountLast4: String(s.bank_account_last4 || ''),
          bankIfsc: String(s.bank_ifsc || ''),
          settlementDestinationType:
            s.settlement_destination_type === 'upi_vpa' ? 'upi_vpa' : 'bank_account',
          registeredAddress:
            (s.registered_address as SellerSettlementAccount['registeredAddress']) || null,
          kycStoragePaths: Array.isArray(s.kyc_storage_paths)
            ? (s.kyc_storage_paths as string[])
            : [],
          kycStatus: (s.kyc_status || 'not_started') as SellerSettlementAccount['kycStatus'],
          routeOnboardingStatus: (s.route_onboarding_status ||
            'not_started') as SellerSettlementAccount['routeOnboardingStatus'],
          payoutsEnabled: Boolean(s.payouts_enabled),
          razorpayLinkedAccountId: s.razorpay_linked_account_id
            ? String(s.razorpay_linked_account_id)
            : null,
          razorpayProductId: s.razorpay_product_id ? String(s.razorpay_product_id) : null,
          razorpayRawActivationStatus: s.razorpay_raw_activation_status
            ? String(s.razorpay_raw_activation_status)
            : null,
          kycRequirements: Array.isArray(s.kyc_requirements)
            ? (s.kyc_requirements as Array<Record<string, unknown>>)
            : [],
          rejectionReason: s.rejection_reason ? String(s.rejection_reason) : null,
          sellerConsentAccepted: Boolean(s.seller_consent_accepted),
          agreementAccepted: Boolean(s.agreement_accepted),
          agreementVersion: s.agreement_version ? String(s.agreement_version) : null,
          lastSyncedAt: s.last_synced_at ? String(s.last_synced_at) : null,
          updatedAt: String(s.updated_at || ''),
        };
      }
    );

    const transfers: SellerTransferItem[] = (transferRows || []).map((t: Record<string, unknown>) => {
      const ordRel = t.orders as { order_number?: string } | null;
      const sellerRel = t.seller_profiles as { business_name?: string } | null;
      return {
        id: String(t.id),
        sellerOrderId: String(t.seller_order_id),
        orderId: String(t.order_id),
        orderNumber: ordRel?.order_number || String(t.order_id).slice(0, 8),
        sellerId: String(t.seller_id),
        sellerName: sellerRel?.business_name || 'Seller',
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

    const transferReversals: AdminTransferReversalItem[] = (reversalRows || []).map(
      (r: Record<string, unknown>) => ({
        id: String(r.id),
        sellerTransferId: String(r.seller_transfer_id),
        sellerOrderId: String(r.seller_order_id),
        orderId: String(r.order_id),
        refundId: r.refund_id ? String(r.refund_id) : null,
        providerReversalId: r.provider_reversal_id ? String(r.provider_reversal_id) : null,
        amountPaise: Number(r.amount_paise || 0),
        status: (r.status || 'pending') as AdminTransferReversalItem['status'],
        reason: String(r.reason || ''),
        failureReason: r.failure_reason ? String(r.failure_reason) : null,
        createdAt: String(r.created_at || ''),
        processedAt: r.processed_at ? String(r.processed_at) : null,
      })
    );

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

    const reconciliationRuns: AdminReconciliationRun[] = (reconRows || []).map(
      (rr: Record<string, unknown>) => ({
        id: String(rr.id),
        runType: String(rr.run_type || 'razorpay_transfers'),
        status: String(rr.status || 'completed'),
        checkedCount: Number(rr.checked_count || 0),
        discrepancyCount: Number(rr.discrepancy_count || 0),
        summary: (rr.summary as Record<string, unknown>) || {},
        createdAt: String(rr.created_at || ''),
        completedAt: rr.completed_at ? String(rr.completed_at) : null,
      })
    );

    return {
      sellers,
      submissions,
      orders,
      refunds,
      codRecords,
      ledgerEntries,
      settlementAccounts,
      transfers,
      transferReversals,
      settlementRecords,
      reconciliationRuns,
      routeGateway,
      settings: settingsRow
        ? {
            commissionRate: Math.round(Number(settingsRow.commission_rate) * 100),
            codEnabled: Boolean(settingsRow.cod_enabled),
            freeShippingThreshold: Number(settingsRow.free_shipping_threshold || 5000),
            returnWindowDays: Number(settingsRow.return_window_days || 7),
          }
        : defaultSettings,
      auditLogs,
      customerCount: customerCount || 0,
    };
  },

  async updateSellerStatus(
    sellerId: string,
    accountStatus: SellerAccountStatus,
    actorId: string
  ): Promise<{ error?: string }> {
    if (!this.isLive() || !supabase) return {};
    const { error } = await supabase
      .from('seller_profiles')
      .update({ account_status: accountStatus })
      .eq('id', sellerId);
    if (error) return { error: error.message };

    await supabase.from('audit_logs').insert({
      actor_id: actorId,
      action: 'UPDATE_SELLER_STATUS',
      target_table: 'seller_profiles',
      target_id: sellerId,
      details: { account_status: accountStatus },
    });
    return {};
  },

  async updateSellerPayout(
    sellerId: string,
    payoutVerification: 'verified' | 'pending' | 'unverified',
    actorId: string
  ): Promise<{ error?: string }> {
    if (!this.isLive() || !supabase) return {};
    const { error } = await supabase
      .from('seller_profiles')
      .update({ payout_verification_status: payoutVerification })
      .eq('id', sellerId);
    if (error) return { error: error.message };

    await supabase.from('audit_logs').insert({
      actor_id: actorId,
      action: 'UPDATE_PAYOUT_VERIFICATION',
      target_table: 'seller_profiles',
      target_id: sellerId,
      details: { payout_verification_status: payoutVerification },
    });
    return {};
  },

  async moderateProduct(
    productId: string,
    status: AdminProductSubmission['status'],
    feedback: string | undefined,
    actorId: string,
    isFeatured?: boolean
  ): Promise<{ error?: string }> {
    if (!this.isLive() || !supabase) return {};
    const approvalStatus = status === 'published' ? 'approved' : status;
    const isPublished = status === 'published';

    const updatePayload: Record<string, unknown> = {
      approval_status: approvalStatus,
      is_published: isPublished,
      rejection_reason: feedback || null,
    };
    if (typeof isFeatured === 'boolean') {
      updatePayload.is_featured = isFeatured;
    }

    const { error } = await supabase
      .from('products')
      .update(updatePayload)
      .eq('id', productId);
    if (error) return { error: error.message };

    await supabase.from('audit_logs').insert({
      actor_id: actorId,
      action: 'MODERATE_PRODUCT',
      target_table: 'products',
      target_id: productId,
      details: { status, feedback: feedback || null, is_featured: isFeatured },
    });
    return {};
  },

  async setProductFeatured(
    productId: string,
    isFeatured: boolean,
    actorId: string
  ): Promise<{ error?: string }> {
    if (!this.isLive() || !supabase) return {};
    const { error } = await supabase
      .from('products')
      .update({ is_featured: isFeatured })
      .eq('id', productId);
    if (error) return { error: error.message };

    await supabase.from('audit_logs').insert({
      actor_id: actorId,
      action: 'TOGGLE_FEATURED_PRODUCT',
      target_table: 'products',
      target_id: productId,
      details: { is_featured: isFeatured },
    });
    return {};
  },

  async cancelCustomerOrder(
    orderId: string,
    reason = 'Cancelled by operations admin'
  ): Promise<{ error?: string }> {
    if (!this.isLive() || !supabase) return {};
    const { error } = await supabase.rpc('cancel_customer_order', {
      p_order_id: orderId,
      p_reason: reason,
    });
    return error ? { error: error.message } : {};
  },

  async cancelSellerOrder(
    sellerOrderId: string,
    reason = 'Cancelled by operations admin'
  ): Promise<{ error?: string }> {
    if (!this.isLive() || !supabase) return {};
    const { error } = await supabase.rpc('cancel_seller_order', {
      p_seller_order_id: sellerOrderId,
      p_reason: reason,
    });
    return error ? { error: error.message } : {};
  },

  async saveSettings(
    settings: MarketplaceSettings,
    actorId: string
  ): Promise<{ error?: string }> {
    if (!this.isLive() || !supabase) return {};
    const { error } = await supabase
      .from('marketplace_settings')
      .update({
        commission_rate: Number((settings.commissionRate / 100).toFixed(4)),
        cod_enabled: settings.codEnabled,
        free_shipping_threshold: settings.freeShippingThreshold,
        return_window_days: settings.returnWindowDays,
        updated_by: actorId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1);
    if (error) return { error: error.message };

    await supabase.from('audit_logs').insert({
      actor_id: actorId,
      action: 'UPDATE_MARKETPLACE_SETTINGS',
      target_table: 'marketplace_settings',
      details: settings,
    });
    return {};
  },

  async reviewRefundRequest(
    refundId: string,
    decision: 'approved' | 'rejected',
    rejectionReason?: string,
    internalNotes?: string
  ): Promise<{ error?: string }> {
    if (!this.isLive() || !supabase) return {};
    const { error } = await supabase.rpc('review_refund_request', {
      p_refund_id: refundId,
      p_decision: decision,
      p_rejection_reason: rejectionReason || null,
      p_internal_notes: internalNotes || null,
    });
    return error ? { error: error.message } : {};
  },

  async initiateOnlineRefund(params: {
    orderId: string;
    refundId?: string | null;
    sellerOrderId?: string | null;
    items?: RefundItemRequest[] | null;
    amountPaise?: number | null;
    shippingRefundPaise?: number;
    reason: string;
    internalNotes?: string | null;
    idempotencyKey?: string;
  }): Promise<{
    refundId?: string;
    providerRefundId?: string | null;
    status?: 'pending' | 'processed' | 'failed';
    error?: string;
  }> {
    if (!this.isLive() || !supabase) {
      return {
        refundId: params.refundId || `rfnd-demo-${Date.now()}`,
        providerRefundId: `rfnd_demo_${Date.now()}`,
        status: 'processed',
      };
    }
    try {
      const provider = getPaymentProvider('razorpay');
      const res = await provider.requestRefund({
        orderId: params.orderId,
        refundId: params.refundId ?? null,
        sellerOrderId: params.sellerOrderId ?? null,
        items: params.items ?? null,
        amountPaise: params.amountPaise ?? null,
        shippingRefundPaise: params.shippingRefundPaise ?? 0,
        reason: params.reason,
        internalNotes: params.internalNotes ?? null,
        idempotencyKey:
          params.idempotencyKey ||
          `adm-rfnd:${params.refundId || params.sellerOrderId || params.orderId}:${Date.now()}`,
      });
      return {
        refundId: res.refundId,
        providerRefundId: res.providerRefundId ?? null,
        status: res.status,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Unable to initiate Razorpay refund.' };
    }
  },

  async cancelCodOrderWithAccounting(params: {
    sellerOrderId: string;
    stage: Exclude<CodCancellationStage, 'manual_refund_after_collection'>;
    reason: string;
    courierDeductionPaise?: number;
    courierName?: string;
  }): Promise<{ error?: string }> {
    if (!this.isLive() || !supabase) return {};
    const { error } = await supabase.rpc('cancel_cod_seller_order_with_accounting', {
      p_seller_order_id: params.sellerOrderId,
      p_stage: params.stage,
      p_reason: params.reason,
      p_courier_deduction_paise: params.courierDeductionPaise ?? 0,
      p_courier_name: params.courierName ?? null,
    });
    return error ? { error: error.message } : {};
  },

  async recordManualCodRefund(params: {
    orderId: string;
    sellerOrderId: string;
    amountPaise: number;
    refundMethod: string;
    manualReference: string;
    refundDate?: string;
    reason: string;
    internalNotes?: string;
    courierDeductionPaise?: number;
  }): Promise<{ refundId?: string; error?: string }> {
    if (!this.isLive() || !supabase) {
      return { refundId: `cod-rfnd-demo-${Date.now()}` };
    }
    const { data, error } = await supabase.rpc('record_manual_cod_refund', {
      p_order_id: params.orderId,
      p_seller_order_id: params.sellerOrderId,
      p_amount_paise: params.amountPaise,
      p_refund_method: params.refundMethod,
      p_manual_reference: params.manualReference,
      p_refund_date: params.refundDate || new Date().toISOString(),
      p_reason: params.reason,
      p_idempotency_key: `cod-rfnd:${params.sellerOrderId}:${params.manualReference}`,
      p_internal_notes: params.internalNotes || null,
      p_courier_deduction_paise: params.courierDeductionPaise ?? 0,
    });
    if (error) return { error: error.message };
    return { refundId: String(data) };
  },

  async approveReturnRestock(
    refundId: string,
    decision: 'restocked' | 'rejected_damaged',
    inspectionNotes?: string
  ): Promise<{ error?: string }> {
    if (!this.isLive() || !supabase) return {};
    const { error } = await supabase.rpc('approve_returned_item_restock', {
      p_refund_id: refundId,
      p_return_id: null,
      p_decision: decision,
      p_inspection_notes: inspectionNotes || null,
    });
    return error ? { error: error.message } : {};
  },

  async reviewSellerOnboarding(
    accountId: string,
    decision: 'verification_pending' | 'action_required' | 'rejected' | 'suspended',
    notes?: string
  ): Promise<{ error?: string }> {
    if (!this.isLive() || !supabase) return {};
    const { error } = await supabase.rpc('review_seller_settlement_onboarding', {
      p_account_id: accountId,
      p_decision: decision,
      p_notes: notes || null,
    });
    return error ? { error: error.message } : {};
  },

  async createRouteLinkedAccount(params: {
    accountId?: string;
    sellerId?: string;
    pan?: string;
    bankAccountNumber?: string;
    bankIfsc?: string;
    beneficiaryName?: string;
  }): Promise<{ error?: string }> {
    if (!this.isLive() || !supabase) {
      return { error: 'Razorpay Route is disabled in demo mode.' };
    }
    const { data, error } = await supabase.functions.invoke('razorpay-route-create-linked-account', {
      body: params,
    });
    if (error) return { error: error.message };
    if ((data as { error?: string } | null)?.error) {
      return { error: (data as { error: string }).error };
    }
    return {};
  },

  async updateRouteLinkedAccount(params: {
    accountId?: string;
    sellerId?: string;
    bankAccountNumber?: string;
    bankIfsc?: string;
    beneficiaryName?: string;
    email?: string;
    phone?: string;
  }): Promise<{ error?: string }> {
    if (!this.isLive() || !supabase) {
      return { error: 'Razorpay Route is disabled in demo mode.' };
    }
    const { data, error } = await supabase.functions.invoke('razorpay-route-update-linked-account', {
      body: params,
    });
    if (error) return { error: error.message };
    if ((data as { error?: string } | null)?.error) {
      return { error: (data as { error: string }).error };
    }
    return {};
  },

  async createRouteTransfer(params: {
    sellerOrderId: string;
    amountPaise?: number;
    transferId?: string;
    onHold?: boolean;
    holdUntil?: string;
    idempotencyKey?: string;
  }): Promise<{ error?: string }> {
    if (!this.isLive() || !supabase) {
      return { error: 'Razorpay Route is disabled in demo mode.' };
    }
    const { data, error } = await supabase.functions.invoke('razorpay-route-create-transfer', {
      body: {
        ...params,
        idempotencyKey:
          params.idempotencyKey ||
          `adm-tr:${params.transferId || params.sellerOrderId}:${Date.now()}`,
      },
    });
    if (error) return { error: error.message };
    if ((data as { error?: string } | null)?.error) {
      return { error: (data as { error: string }).error };
    }
    return {};
  },

  async reverseRouteTransfer(params: {
    transferId: string;
    amountPaise?: number;
    refundId?: string;
    reason: string;
    idempotencyKey?: string;
  }): Promise<{ error?: string }> {
    if (!this.isLive() || !supabase) {
      return { error: 'Razorpay Route is disabled in demo mode.' };
    }
    const { data, error } = await supabase.functions.invoke('razorpay-route-reverse-transfer', {
      body: {
        ...params,
        idempotencyKey:
          params.idempotencyKey || `adm-rev:${params.transferId}:${Date.now()}`,
      },
    });
    if (error) return { error: error.message };
    if ((data as { error?: string } | null)?.error) {
      return { error: (data as { error: string }).error };
    }
    return {};
  },

  async runRouteReconciliation(limit = 50): Promise<{
    error?: string;
    checkedCount?: number;
    settledCount?: number;
  }> {
    if (!this.isLive() || !supabase) {
      return { error: 'Razorpay Route is disabled in demo mode.' };
    }
    const { data, error } = await supabase.functions.invoke('razorpay-route-reconciliation', {
      body: { limit },
    });
    if (error) return { error: error.message };
    const payload = data as { error?: string; checkedCount?: number; settledCount?: number } | null;
    if (payload?.error) return { error: payload.error };
    return {
      checkedCount: payload?.checkedCount ?? 0,
      settledCount: payload?.settledCount ?? 0,
    };
  },
};
