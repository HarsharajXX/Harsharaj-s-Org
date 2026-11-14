/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hmacSha256Hex } from '../../supabase/functions/_shared/crypto.ts';
import { RazorpayApiError } from '../../supabase/functions/_shared/razorpayClient.ts';
import type {
  AuthenticatedCustomer,
  FinalizeRouteTransferResult,
  FinalizeTransferReversalResult,
  GatewayConfigRow,
  RazorpayLinkedAccountEntity,
  RazorpayOrderEntity,
  RazorpayPaymentEntity,
  RazorpayRefundEntity,
  RazorpayRouteApiClient,
  RazorpayRouteProductEntity,
  RazorpaySettlementEntity,
  RazorpayTransferEntity,
  RazorpayTransferReversalEntity,
  ReconciliationTransferCandidate,
  ReserveRouteTransferResult,
  ReserveTransferReversalResult,
  RouteEdgeRepository,
  SellerSettlementAccountRow,
} from '../../supabase/functions/_shared/types.ts';
import { handleCreateRouteLinkedAccount } from '../../supabase/functions/razorpay-route-create-linked-account/handler.ts';
import { handleUpdateRouteLinkedAccount } from '../../supabase/functions/razorpay-route-update-linked-account/handler.ts';
import { handleCreateRouteTransfer } from '../../supabase/functions/razorpay-route-create-transfer/handler.ts';
import { handleReverseRouteTransfer } from '../../supabase/functions/razorpay-route-reverse-transfer/handler.ts';
import { handleRazorpayRouteWebhook } from '../../supabase/functions/razorpay-route-webhook/handler.ts';
import { handleRouteSettlementReconciliation } from '../../supabase/functions/razorpay-route-reconciliation/handler.ts';
import { ADMIN_ROLE_PERMISSIONS, canAccessAdminTab } from '../utils/commerceRules.ts';

const repoRoot = process.cwd();
const KEY_ID = 'rzp_test_U087Ttl5tHUUQq';
const KEY_SECRET = 'mock_razorpay_key_secret_tests_only';
const WEBHOOK_SECRET = 'mock_razorpay_webhook_secret_tests_only';
const CRON_SECRET = 'mock_cron_secret_tests_only';

interface SimOrder {
  id: string;
  orderNumber: string;
  paymentMethod: 'online' | 'cod';
  paymentStatus: string;
  totalPaise: number;
}

interface SimPayment {
  id: string;
  orderId: string;
  providerPaymentId: string;
  capturedPaise: number;
}

interface SimSellerOrder {
  id: string;
  orderId: string;
  sellerId: string;
  subtotalPaise: number;
  commissionPaise: number;
  sellerPayablePaise: number;
  settledPaise: number;
  reversalPaise: number;
  fulfilmentStatus: string;
}

interface SimTransfer {
  id: string;
  sellerOrderId: string;
  orderId: string;
  paymentId: string;
  sellerId: string;
  settlementAccountId: string;
  idempotencyKey: string;
  providerTransferId: string | null;
  amountPaise: number;
  reversedPaise: number;
  status: 'pending' | 'created' | 'on_hold' | 'processed' | 'failed' | 'reversed' | 'partially_reversed';
  settlementStatus: 'pending' | 'scheduled' | 'on_hold' | 'settled' | 'failed' | 'reversed';
  onHold: boolean;
  holdUntil: string | null;
  settlementId: string | null;
  settlementUtr: string | null;
  retryCount: number;
}

interface SimReversal {
  id: string;
  sellerTransferId: string;
  sellerOrderId: string;
  orderId: string;
  refundId: string | null;
  sellerId: string;
  idempotencyKey: string;
  providerReversalId: string | null;
  amountPaise: number;
  status: 'pending' | 'processed' | 'failed';
  reason: string;
}

interface SimLedgerEntry {
  orderId: string;
  sellerOrderId: string;
  transferId: string;
  entryType: string;
  direction: 'debit' | 'credit';
  amountPaise: number;
  referenceId: string;
}

class InMemoryRouteMarketplaceHarness implements RouteEdgeRepository {
  public users: Record<string, { id: string; email: string; roles: string[] }> = {
    'jwt-super-admin': { id: 'adm-super', email: 'super@nohaj.com', roles: ['super_admin'] },
    'jwt-ops-admin': { id: 'adm-ops', email: 'ops@nohaj.com', roles: ['operations_admin'] },
    'jwt-content-admin': { id: 'adm-content', email: 'content@nohaj.com', roles: ['content_admin'] },
    'jwt-seller-1': { id: 'user-seller-1', email: 'seller1@nohaj.com', roles: ['seller'] },
    'jwt-seller-2': { id: 'user-seller-2', email: 'seller2@nohaj.com', roles: ['seller'] },
    'jwt-cust-1': { id: 'cust-1', email: 'customer@example.com', roles: ['customer'] },
  };

  public gatewayConfig: GatewayConfigRow = {
    active_provider: 'razorpay',
    online_payments_enabled: true,
    razorpay_mode: 'test',
    razorpay_route_enabled: true,
    route_approval_status: 'approved',
  };

  public settlementAccounts = new Map<string, SellerSettlementAccountRow>();
  public kycPaths = new Map<string, string[]>();
  public orders = new Map<string, SimOrder>();
  public payments = new Map<string, SimPayment>();
  public sellerOrders = new Map<string, SimSellerOrder>();
  public refundSellerReversed = new Map<string, number>();
  public transfers = new Map<string, SimTransfer>();
  public reversals = new Map<string, SimReversal>();
  public settlementRecords = new Map<string, { id: string; transferId: string; utr: string | null; amountPaise: number }>();
  public reconciliationRuns: Array<{ runType: string; status: string; checkedCount: number; discrepancyCount: number }> = [];
  public webhooks = new Map<string, { status: string; errorMessage?: string | null }>();
  public ledgerEntries: SimLedgerEntry[] = [];
  private seq = 1;

  submitOnboarding(params: {
    userId: string;
    sellerId: string;
    legalBusinessName: string;
    panLast4: string;
    bankAccountLast4: string;
    bankIfsc: string;
    kycPaths: string[];
    consent: boolean;
    agreement: boolean;
  }): SellerSettlementAccountRow {
    if (!params.consent || !params.agreement) {
      throw new Error('Seller consent and marketplace settlement agreement acceptance are required.');
    }
    for (const p of params.kycPaths) {
      if (p.split('/')[0] !== params.userId) {
        throw new Error('Invalid KYC document storage path ownership.');
      }
    }
    const existing = Array.from(this.settlementAccounts.values()).find((a) => a.seller_id === params.sellerId);
    const id = existing?.id || `ssa-${this.seq++}`;
    const row: SellerSettlementAccountRow = {
      id,
      seller_id: params.sellerId,
      legal_business_name: params.legalBusinessName,
      business_type: 'proprietorship',
      contact_name: 'Artisan Contact',
      contact_email: `${params.sellerId}@nohaj.com`,
      contact_phone: '+919864000001',
      pan_last4: params.panLast4,
      gstin: null,
      beneficiary_name: params.legalBusinessName,
      bank_account_last4: params.bankAccountLast4,
      bank_ifsc: params.bankIfsc,
      registered_address: { street1: 'Sualkuchi', city: 'Kamrup', state: 'Assam', postal_code: '781103', country: 'IN' },
      kyc_status: existing?.route_onboarding_status === 'active' ? existing.kyc_status : 'submitted',
      route_onboarding_status: existing?.route_onboarding_status === 'active' ? 'active' : 'submitted',
      payouts_enabled: existing?.route_onboarding_status === 'active' ? existing.payouts_enabled : false,
      razorpay_linked_account_id: existing?.razorpay_linked_account_id || null,
      razorpay_product_id: existing?.razorpay_product_id || null,
      razorpay_raw_activation_status: existing?.razorpay_raw_activation_status || null,
      seller_consent_accepted: true,
      agreement_accepted: true,
    };
    this.settlementAccounts.set(id, row);
    this.kycPaths.set(id, params.kycPaths);
    return row;
  }

  seedActiveSellerAccount(sellerId: string, linkedAccountId: string): SellerSettlementAccountRow {
    const id = `ssa-${this.seq++}`;
    const row: SellerSettlementAccountRow = {
      id,
      seller_id: sellerId,
      legal_business_name: `${sellerId} Weaves`,
      business_type: 'proprietorship',
      contact_name: 'Owner',
      contact_email: `${sellerId}@nohaj.com`,
      contact_phone: '+919864000001',
      pan_last4: '123F',
      beneficiary_name: `${sellerId} Weaves`,
      bank_account_last4: '4321',
      bank_ifsc: 'SBIN0000001',
      kyc_status: 'active',
      route_onboarding_status: 'active',
      payouts_enabled: true,
      razorpay_linked_account_id: linkedAccountId,
      razorpay_product_id: `prd_${sellerId}`,
      razorpay_raw_activation_status: 'activated',
      seller_consent_accepted: true,
      agreement_accepted: true,
    };
    this.settlementAccounts.set(id, row);
    return row;
  }

  seedOrder(params: {
    orderId: string;
    paymentMethod?: 'online' | 'cod';
    paymentStatus?: string;
    providerPaymentId?: string;
    sellers: Array<{ sellerOrderId: string; sellerId: string; subtotalPaise: number }>;
  }) {
    const method = params.paymentMethod || 'online';
    const paymentStatus = params.paymentStatus || (method === 'online' ? 'captured' : 'cod_pending');
    const totalPaise = params.sellers.reduce((s, x) => s + x.subtotalPaise, 0);
    this.orders.set(params.orderId, {
      id: params.orderId,
      orderNumber: `NHJ-${params.orderId.toUpperCase()}`,
      paymentMethod: method,
      paymentStatus,
      totalPaise,
    });
    if (method === 'online' && paymentStatus === 'captured') {
      this.payments.set(params.orderId, {
        id: `payrow-${params.orderId}`,
        orderId: params.orderId,
        providerPaymentId: params.providerPaymentId || `pay_${params.orderId}`,
        capturedPaise: totalPaise,
      });
    }
    for (const s of params.sellers) {
      const commissionPaise = Math.round(s.subtotalPaise * 0.12);
      const sellerPayablePaise = s.subtotalPaise - commissionPaise;
      this.sellerOrders.set(s.sellerOrderId, {
        id: s.sellerOrderId,
        orderId: params.orderId,
        sellerId: s.sellerId,
        subtotalPaise: s.subtotalPaise,
        commissionPaise,
        sellerPayablePaise,
        settledPaise: 0,
        reversalPaise: 0,
        fulfilmentStatus: 'confirmed',
      });
    }
  }

  applyRefundAdjustment(sellerOrderId: string, payableReversedPaise: number) {
    this.refundSellerReversed.set(
      sellerOrderId,
      (this.refundSellerReversed.get(sellerOrderId) || 0) + payableReversedPaise
    );
  }

  getAvailableTransferablePaise(sellerOrderId: string): number {
    const so = this.sellerOrders.get(sellerOrderId);
    if (!so) return 0;
    const order = this.orders.get(so.orderId);
    if (!order || order.paymentMethod !== 'online') return 0;
    const pay = this.payments.get(order.id);
    if (!pay || pay.capturedPaise <= 0) return 0;
    const refunded = this.refundSellerReversed.get(sellerOrderId) || 0;
    const netPayable = Math.max(0, so.sellerPayablePaise - refunded);
    const committed = Array.from(this.transfers.values())
      .filter(
        (t) =>
          t.sellerOrderId === sellerOrderId &&
          ['pending', 'created', 'processed', 'on_hold', 'partially_reversed'].includes(t.status)
      )
      .reduce((sum, t) => sum + (t.amountPaise - t.reversedPaise), 0);
    return Math.max(0, netPayable - committed);
  }

  async authenticateCustomer(jwt: string): Promise<AuthenticatedCustomer | null> {
    const user = this.users[jwt];
    return user ? { id: user.id, email: user.email } : null;
  }

  async isOperationsAdmin(userId: string): Promise<boolean> {
    const found = Object.values(this.users).find((u) => u.id === userId);
    return Boolean(found?.roles.some((r) => r === 'super_admin' || r === 'operations_admin'));
  }

  async getGatewayConfig(): Promise<GatewayConfigRow> {
    return this.gatewayConfig;
  }

  async getSellerSettlementAccountById(accountId: string): Promise<SellerSettlementAccountRow | null> {
    return this.settlementAccounts.get(accountId) || null;
  }

  async getSellerSettlementAccountBySellerId(sellerId: string): Promise<SellerSettlementAccountRow | null> {
    return Array.from(this.settlementAccounts.values()).find((a) => a.seller_id === sellerId) || null;
  }

  async getSellerSettlementAccountByLinkedAccountId(
    linkedAccountId: string
  ): Promise<SellerSettlementAccountRow | null> {
    return (
      Array.from(this.settlementAccounts.values()).find(
        (a) => a.razorpay_linked_account_id === linkedAccountId
      ) || null
    );
  }

  async syncLinkedAccountFromRoute(params: {
    accountId?: string | null;
    linkedAccountId: string;
    productId?: string | null;
    stakeholderId?: string | null;
    rawActivationStatus: string;
    kycRequirements?: unknown[] | null;
    actorId?: string | null;
  }): Promise<SellerSettlementAccountRow> {
    const acct =
      (params.accountId ? this.settlementAccounts.get(params.accountId) : null) ||
      (await this.getSellerSettlementAccountByLinkedAccountId(params.linkedAccountId));
    if (!acct) throw new Error('Seller settlement account not found for Route sync.');
    const raw = params.rawActivationStatus.toLowerCase();
    const mapped =
      raw === 'activated' || raw === 'active'
        ? 'active'
        : raw === 'needs_clarification' || raw === 'action_required'
          ? 'action_required'
          : raw === 'suspended'
            ? 'suspended'
            : raw === 'rejected'
              ? 'rejected'
              : 'verification_pending';
    const updated: SellerSettlementAccountRow = {
      ...acct,
      razorpay_linked_account_id: params.linkedAccountId,
      razorpay_product_id: params.productId ?? acct.razorpay_product_id,
      razorpay_raw_activation_status: raw === 'active' ? 'activated' : raw,
      kyc_status: mapped,
      route_onboarding_status: mapped,
      payouts_enabled: mapped === 'active',
    };
    this.settlementAccounts.set(updated.id, updated);
    return updated;
  }

  async reserveSellerRouteTransfer(params: {
    actorId: string;
    sellerOrderId: string;
    amountPaise?: number | null;
    transferId?: string | null;
    onHold?: boolean;
    holdUntil?: string | null;
    idempotencyKey: string;
  }): Promise<ReserveRouteTransferResult> {
    if (!(await this.isOperationsAdmin(params.actorId))) {
      throw new Error('Forbidden: only operations or super administrators may initiate seller transfers.');
    }
    if (!this.gatewayConfig.razorpay_route_enabled || this.gatewayConfig.route_approval_status !== 'approved') {
      throw new Error('Razorpay Route is disabled or not yet approved.');
    }
    const replay = Array.from(this.transfers.values()).find((t) => t.idempotencyKey === params.idempotencyKey);
    if (replay) {
      const pay = this.payments.get(replay.orderId)!;
      const acct = this.settlementAccounts.get(replay.settlementAccountId)!;
      return {
        transfer_id: replay.id,
        seller_order_id: replay.sellerOrderId,
        order_id: replay.orderId,
        payment_id: replay.paymentId,
        provider_payment_id: pay.providerPaymentId,
        seller_id: replay.sellerId,
        settlement_account_id: replay.settlementAccountId,
        linked_account_id: acct.razorpay_linked_account_id!,
        amount_paise: replay.amountPaise,
        currency: 'INR',
        on_hold: replay.onHold,
        hold_until: replay.holdUntil,
        already_initiated: true,
        provider_transfer_id: replay.providerTransferId,
        transfer_status: replay.status,
      };
    }

    const so = this.sellerOrders.get(params.sellerOrderId);
    if (!so) throw new Error('Seller order not found.');
    const order = this.orders.get(so.orderId)!;
    if (order.paymentMethod !== 'online') {
      throw new Error('COD seller orders cannot be routed through Razorpay Route transfers.');
    }
    const pay = this.payments.get(order.id);
    if (!pay || pay.capturedPaise <= 0) {
      throw new Error('Verified Razorpay captured payment is missing for this order.');
    }
    const acct = await this.getSellerSettlementAccountBySellerId(so.sellerId);
    if (!acct || acct.route_onboarding_status !== 'active' || !acct.payouts_enabled || !acct.razorpay_linked_account_id) {
      throw new Error('Seller Linked Account is not active or verified for Razorpay Route payouts.');
    }
    const available = this.getAvailableTransferablePaise(so.id);

    if (params.transferId) {
      const existing = this.transfers.get(params.transferId);
      if (!existing) throw new Error('Transfer record not found for retry.');
      if (existing.status !== 'failed') {
        return {
          transfer_id: existing.id,
          seller_order_id: existing.sellerOrderId,
          order_id: existing.orderId,
          payment_id: existing.paymentId,
          provider_payment_id: pay.providerPaymentId,
          seller_id: existing.sellerId,
          settlement_account_id: existing.settlementAccountId,
          linked_account_id: acct.razorpay_linked_account_id,
          amount_paise: existing.amountPaise,
          currency: 'INR',
          on_hold: existing.onHold,
          hold_until: existing.holdUntil,
          already_initiated: true,
          provider_transfer_id: existing.providerTransferId,
          transfer_status: existing.status,
        };
      }
      if (existing.amountPaise > available) {
        throw new Error('Retry transfer amount exceeds remaining seller payable balance.');
      }
      existing.status = 'pending';
      existing.settlementStatus = 'pending';
      existing.retryCount += 1;
      existing.idempotencyKey = params.idempotencyKey;
      return {
        transfer_id: existing.id,
        seller_order_id: existing.sellerOrderId,
        order_id: existing.orderId,
        payment_id: existing.paymentId,
        provider_payment_id: pay.providerPaymentId,
        seller_id: existing.sellerId,
        settlement_account_id: existing.settlementAccountId,
        linked_account_id: acct.razorpay_linked_account_id,
        amount_paise: existing.amountPaise,
        currency: 'INR',
        on_hold: existing.onHold,
        hold_until: existing.holdUntil,
        already_initiated: false,
        provider_transfer_id: null,
        transfer_status: 'pending',
      };
    }

    const targetAmount = params.amountPaise ?? available;
    if (targetAmount <= 0 || targetAmount > available) {
      throw new Error('Insufficient available seller payable balance for requested transfer amount.');
    }

    const id = `tr-${this.seq++}`;
    this.transfers.set(id, {
      id,
      sellerOrderId: so.id,
      orderId: order.id,
      paymentId: pay.id,
      sellerId: so.sellerId,
      settlementAccountId: acct.id,
      idempotencyKey: params.idempotencyKey,
      providerTransferId: null,
      amountPaise: targetAmount,
      reversedPaise: 0,
      status: 'pending',
      settlementStatus: 'pending',
      onHold: Boolean(params.onHold),
      holdUntil: params.holdUntil ?? null,
      settlementId: null,
      settlementUtr: null,
      retryCount: 0,
    });

    return {
      transfer_id: id,
      seller_order_id: so.id,
      order_id: order.id,
      payment_id: pay.id,
      provider_payment_id: pay.providerPaymentId,
      seller_id: so.sellerId,
      settlement_account_id: acct.id,
      linked_account_id: acct.razorpay_linked_account_id,
      amount_paise: targetAmount,
      currency: 'INR',
      on_hold: Boolean(params.onHold),
      hold_until: params.holdUntil ?? null,
      already_initiated: false,
      provider_transfer_id: null,
      transfer_status: 'pending',
    };
  }

  private postLedgerOnce(entry: SimLedgerEntry) {
    const dup = this.ledgerEntries.find((e) =>
      entry.entryType === 'transfer_reversal'
        ? e.transferId === entry.transferId && e.entryType === entry.entryType && e.referenceId === entry.referenceId
        : e.transferId === entry.transferId && e.entryType === entry.entryType
    );
    if (dup) return false;
    this.ledgerEntries.push(entry);
    return true;
  }

  async finalizeSellerRouteTransfer(params: {
    transferId?: string | null;
    providerTransferId?: string | null;
    nextStatus: 'pending' | 'created' | 'on_hold' | 'processed' | 'settled' | 'failed';
    settlementId?: string | null;
    settlementUtr?: string | null;
    failureReason?: string | null;
    errorCode?: string | null;
    actorId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<FinalizeRouteTransferResult> {
    const tr =
      (params.transferId ? this.transfers.get(params.transferId) : null) ||
      Array.from(this.transfers.values()).find((t) => t.providerTransferId === params.providerTransferId);
    if (!tr) throw new Error('Seller transfer record not found.');

    if (params.providerTransferId && !tr.providerTransferId) {
      tr.providerTransferId = params.providerTransferId;
    }

    if (
      (tr.status === 'reversed' || tr.status === 'partially_reversed') &&
      ['pending', 'created', 'processed', 'failed'].includes(params.nextStatus)
    ) {
      return {
        transfer_id: tr.id,
        seller_order_id: tr.sellerOrderId,
        transfer_status: tr.status,
        settlement_status: tr.settlementStatus,
        ignored_out_of_order: true,
      };
    }

    if (tr.settlementStatus === 'settled' && ['pending', 'created', 'processed', 'on_hold', 'failed'].includes(params.nextStatus)) {
      return {
        transfer_id: tr.id,
        seller_order_id: tr.sellerOrderId,
        transfer_status: tr.status,
        settlement_status: tr.settlementStatus,
        ignored_out_of_order: true,
      };
    }

    if (params.nextStatus === 'failed') {
      tr.status = 'failed';
      tr.settlementStatus = 'failed';
    } else if (params.nextStatus === 'settled') {
      this.postLedgerOnce({
        orderId: tr.orderId,
        sellerOrderId: tr.sellerOrderId,
        transferId: tr.id,
        entryType: 'transfer_initiated',
        direction: 'debit',
        amountPaise: tr.amountPaise,
        referenceId: tr.providerTransferId || tr.id,
      });
      tr.status = 'processed';
      tr.onHold = false;
      tr.settlementStatus = 'settled';
      tr.settlementId = params.settlementId || tr.settlementId;
      tr.settlementUtr = params.settlementUtr || tr.settlementUtr;
      if (params.settlementId) {
        this.settlementRecords.set(params.settlementId, {
          id: params.settlementId,
          transferId: tr.id,
          utr: params.settlementUtr || null,
          amountPaise: tr.amountPaise,
        });
      }
      const inserted = this.postLedgerOnce({
        orderId: tr.orderId,
        sellerOrderId: tr.sellerOrderId,
        transferId: tr.id,
        entryType: 'transfer_settled',
        direction: 'debit',
        amountPaise: tr.amountPaise - tr.reversedPaise,
        referenceId: params.settlementId || tr.providerTransferId || tr.id,
      });
      if (inserted) {
        const so = this.sellerOrders.get(tr.sellerOrderId)!;
        so.settledPaise += tr.amountPaise - tr.reversedPaise;
      }
    } else if (params.nextStatus !== 'pending') {
      tr.status = params.nextStatus === 'on_hold' || (tr.onHold && params.nextStatus === 'created') ? 'on_hold' : params.nextStatus;
      tr.settlementStatus = tr.status === 'on_hold' ? 'on_hold' : params.nextStatus === 'processed' ? 'scheduled' : 'pending';
      this.postLedgerOnce({
        orderId: tr.orderId,
        sellerOrderId: tr.sellerOrderId,
        transferId: tr.id,
        entryType: 'transfer_initiated',
        direction: 'debit',
        amountPaise: tr.amountPaise,
        referenceId: tr.providerTransferId || tr.id,
      });
    }

    return {
      transfer_id: tr.id,
      seller_order_id: tr.sellerOrderId,
      transfer_status: tr.status,
      settlement_status: tr.settlementStatus,
      ignored_out_of_order: false,
    };
  }

  async reserveSellerTransferReversal(params: {
    actorId: string;
    transferId: string;
    amountPaise?: number | null;
    refundId?: string | null;
    reason: string;
    idempotencyKey: string;
  }): Promise<ReserveTransferReversalResult> {
    if (!(await this.isOperationsAdmin(params.actorId))) {
      throw new Error('Forbidden: only operations or super administrators may reverse Route transfers.');
    }
    const replay = Array.from(this.reversals.values()).find((r) => r.idempotencyKey === params.idempotencyKey);
    if (replay) {
      const tr = this.transfers.get(replay.sellerTransferId)!;
      return {
        reversal_id: replay.id,
        seller_transfer_id: replay.sellerTransferId,
        provider_transfer_id: tr.providerTransferId!,
        seller_order_id: replay.sellerOrderId,
        order_id: replay.orderId,
        amount_paise: replay.amountPaise,
        already_initiated: true,
        provider_reversal_id: replay.providerReversalId,
        reversal_status: replay.status,
      };
    }
    const tr = this.transfers.get(params.transferId);
    if (!tr || !tr.providerTransferId || !['created', 'processed', 'on_hold', 'partially_reversed'].includes(tr.status)) {
      throw new Error('Transfer is not in a reversible Razorpay state.');
    }
    const pendingSum = Array.from(this.reversals.values())
      .filter((r) => r.sellerTransferId === tr.id && r.status === 'pending')
      .reduce((s, r) => s + r.amountPaise, 0);
    const reversible = Math.max(0, tr.amountPaise - tr.reversedPaise - pendingSum);
    const targetAmount = params.amountPaise ?? reversible;
    if (targetAmount <= 0 || targetAmount > reversible) {
      throw new Error('Requested reversal exceeds eligible remaining transfer balance.');
    }

    const id = `rv-${this.seq++}`;
    this.reversals.set(id, {
      id,
      sellerTransferId: tr.id,
      sellerOrderId: tr.sellerOrderId,
      orderId: tr.orderId,
      refundId: params.refundId ?? null,
      sellerId: tr.sellerId,
      idempotencyKey: params.idempotencyKey,
      providerReversalId: null,
      amountPaise: targetAmount,
      status: 'pending',
      reason: params.reason,
    });

    return {
      reversal_id: id,
      seller_transfer_id: tr.id,
      provider_transfer_id: tr.providerTransferId,
      seller_order_id: tr.sellerOrderId,
      order_id: tr.orderId,
      amount_paise: targetAmount,
      already_initiated: false,
      provider_reversal_id: null,
      reversal_status: 'pending',
    };
  }

  async finalizeSellerTransferReversal(params: {
    reversalId?: string | null;
    providerReversalId?: string | null;
    providerTransferId?: string | null;
    nextStatus: 'processed' | 'failed';
    amountPaise?: number | null;
    failureReason?: string | null;
    actorId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<FinalizeTransferReversalResult> {
    let rev =
      (params.reversalId ? this.reversals.get(params.reversalId) : null) ||
      Array.from(this.reversals.values()).find((r) => r.providerReversalId === params.providerReversalId);
    if (!rev && params.providerTransferId && params.providerReversalId) {
      const tr = Array.from(this.transfers.values()).find((t) => t.providerTransferId === params.providerTransferId);
      if (tr) {
        const id = `rv-${this.seq++}`;
        rev = {
          id,
          sellerTransferId: tr.id,
          sellerOrderId: tr.sellerOrderId,
          orderId: tr.orderId,
          refundId: null,
          sellerId: tr.sellerId,
          idempotencyKey: `wh-rev:${params.providerReversalId}`,
          providerReversalId: params.providerReversalId,
          amountPaise: params.amountPaise || tr.amountPaise - tr.reversedPaise,
          status: 'pending',
          reason: 'Webhook reversal',
        };
        this.reversals.set(id, rev);
      }
    }
    if (!rev) throw new Error('Transfer reversal record not found.');
    const tr = this.transfers.get(rev.sellerTransferId)!;
    if (rev.status === 'processed') {
      return {
        reversal_id: rev.id,
        seller_transfer_id: rev.sellerTransferId,
        reversal_status: rev.status,
        transfer_status: tr.status,
        already_processed: true,
      };
    }

    if (params.nextStatus === 'failed') {
      rev.status = 'failed';
      return {
        reversal_id: rev.id,
        seller_transfer_id: rev.sellerTransferId,
        reversal_status: rev.status,
        transfer_status: tr.status,
        already_processed: false,
      };
    }

    rev.status = 'processed';
    rev.providerReversalId = params.providerReversalId || rev.providerReversalId;
    tr.reversedPaise = Math.min(tr.amountPaise, tr.reversedPaise + rev.amountPaise);
    tr.status = tr.reversedPaise >= tr.amountPaise ? 'reversed' : 'partially_reversed';
    if (tr.reversedPaise >= tr.amountPaise) {
      tr.settlementStatus = 'reversed';
    }
    const so = this.sellerOrders.get(tr.sellerOrderId)!;
    so.reversalPaise += rev.amountPaise;

    this.postLedgerOnce({
      orderId: tr.orderId,
      sellerOrderId: tr.sellerOrderId,
      transferId: tr.id,
      entryType: 'transfer_reversal',
      direction: 'credit',
      amountPaise: rev.amountPaise,
      referenceId: rev.providerReversalId || rev.id,
    });

    return {
      reversal_id: rev.id,
      seller_transfer_id: tr.id,
      reversal_status: rev.status,
      transfer_status: tr.status,
      already_processed: false,
    };
  }

  async listPendingTransfersForReconciliation(limit = 50): Promise<ReconciliationTransferCandidate[]> {
    return Array.from(this.transfers.values())
      .filter(
        (t) =>
          Boolean(t.providerTransferId) &&
          ['pending', 'created', 'on_hold', 'processed'].includes(t.status) &&
          t.settlementStatus !== 'settled'
      )
      .slice(0, limit)
      .map((t) => ({
        id: t.id,
        provider_transfer_id: t.providerTransferId!,
        seller_order_id: t.sellerOrderId,
        seller_id: t.sellerId,
        amount_paise: t.amountPaise,
        status: t.status,
        settlement_status: t.settlementStatus,
        settlement_id: t.settlementId,
      }));
  }

  async recordReconciliationRun(params: {
    runType: 'razorpay_transfers' | 'full';
    status: 'completed' | 'completed_with_discrepancies' | 'failed';
    checkedCount: number;
    discrepancyCount: number;
    summary: Record<string, unknown>;
    startedBy?: string | null;
  }): Promise<void> {
    this.reconciliationRuns.push({
      runType: params.runType,
      status: params.status,
      checkedCount: params.checkedCount,
      discrepancyCount: params.discrepancyCount,
    });
  }

  async beginWebhookEvent(params: {
    eventId: string;
    eventType: string;
    providerOrderId?: string | null;
    providerPaymentId?: string | null;
    signatureValid: boolean;
    safePayload: Record<string, unknown>;
  }): Promise<{ deduplicated: boolean; existingStatus?: string }> {
    const existing = this.webhooks.get(params.eventId);
    if (existing && (existing.status === 'processed' || existing.status === 'ignored' || existing.status === 'processing')) {
      return { deduplicated: true, existingStatus: existing.status };
    }
    this.webhooks.set(params.eventId, { status: 'processing' });
    return { deduplicated: false };
  }

  async completeWebhookEvent(params: {
    eventId: string;
    status: 'processed' | 'ignored' | 'failed';
    errorMessage?: string | null;
  }): Promise<void> {
    this.webhooks.set(params.eventId, { status: params.status, errorMessage: params.errorMessage });
  }
}

function createMockRouteClient() {
  const calls: string[] = [];
  const nextTransferResponses: Array<RazorpayTransferEntity[] | Error> = [];
  const transfersById = new Map<string, RazorpayTransferEntity>();
  const settlementsById = new Map<string, RazorpaySettlementEntity>();
  const accountsById = new Map<string, RazorpayLinkedAccountEntity>();
  const productsById = new Map<string, RazorpayRouteProductEntity>();
  let revSeq = 1;
  let trSeq = 1;
  let acctSeq = 1;

  const client: RazorpayRouteApiClient = {
    async createOrder(): Promise<RazorpayOrderEntity> {
      throw new Error('Unused');
    },
    async fetchPayment(): Promise<RazorpayPaymentEntity> {
      throw new Error('Unused');
    },
    async fetchOrderPayments(): Promise<RazorpayPaymentEntity[]> {
      return [];
    },
    async createRefund(): Promise<RazorpayRefundEntity> {
      throw new Error('Unused');
    },
    async fetchRefund(): Promise<RazorpayRefundEntity> {
      throw new Error('Unused');
    },
    async createLinkedAccount(params): Promise<RazorpayLinkedAccountEntity> {
      calls.push('createLinkedAccount');
      const id = `acc_rp_${acctSeq++}`;
      const entity: RazorpayLinkedAccountEntity = {
        id,
        type: 'route',
        status: 'created',
        email: params.email,
        phone: params.phone,
        legal_business_name: params.legalBusinessName,
        reference_id: params.referenceId,
      };
      accountsById.set(id, entity);
      return entity;
    },
    async updateLinkedAccount(accountId, params): Promise<RazorpayLinkedAccountEntity> {
      calls.push(`updateLinkedAccount:${accountId}`);
      const existing = accountsById.get(accountId) || {
        id: accountId,
        email: params.email || 'seller@nohaj.com',
        phone: params.phone || '+919864000001',
        legal_business_name: params.legalBusinessName || 'Seller',
        status: 'created',
      };
      const updated = { ...existing, ...params };
      accountsById.set(accountId, updated);
      return updated;
    },
    async fetchLinkedAccount(accountId): Promise<RazorpayLinkedAccountEntity> {
      calls.push(`fetchLinkedAccount:${accountId}`);
      return (
        accountsById.get(accountId) || {
          id: accountId,
          email: 'seller@nohaj.com',
          phone: '+919864000001',
          legal_business_name: 'Seller',
          status: 'activated',
        }
      );
    },
    async requestRouteProduct(accountId): Promise<RazorpayRouteProductEntity> {
      calls.push(`requestRouteProduct:${accountId}`);
      const prod: RazorpayRouteProductEntity = {
        id: `prd_${accountId}`,
        account_id: accountId,
        product_name: 'route',
        activation_status: 'under_review',
      };
      productsById.set(`${accountId}:${prod.id}`, prod);
      return prod;
    },
    async updateRouteProduct(accountId, productId): Promise<RazorpayRouteProductEntity> {
      calls.push(`updateRouteProduct:${accountId}:${productId}`);
      const prod = productsById.get(`${accountId}:${productId}`) || {
        id: productId,
        account_id: accountId,
        product_name: 'route',
        activation_status: 'under_review',
      };
      productsById.set(`${accountId}:${productId}`, prod);
      return prod;
    },
    async fetchRouteProduct(accountId, productId): Promise<RazorpayRouteProductEntity> {
      calls.push(`fetchRouteProduct:${accountId}:${productId}`);
      return (
        productsById.get(`${accountId}:${productId}`) || {
          id: productId,
          account_id: accountId,
          product_name: 'route',
          activation_status: 'activated',
        }
      );
    },
    async createPaymentTransfers(paymentId, transfers): Promise<RazorpayTransferEntity[]> {
      calls.push(`createPaymentTransfers:${paymentId}`);
      const scripted = nextTransferResponses.shift();
      if (scripted instanceof Error) throw scripted;
      if (scripted) {
        scripted.forEach((t) => transfersById.set(t.id, t));
        return scripted;
      }
      const created = transfers.map((tr) => {
        const entity: RazorpayTransferEntity = {
          id: `trf_rp_${trSeq++}`,
          entity: 'transfer',
          source: paymentId,
          recipient: tr.account,
          amount: tr.amountPaise,
          currency: 'INR',
          status: 'created',
          settlement_status: tr.onHold ? 'on_hold' : 'pending',
          on_hold: Boolean(tr.onHold),
          notes: tr.notes,
        };
        transfersById.set(entity.id, entity);
        return entity;
      });
      return created;
    },
    async fetchTransfer(transferId): Promise<RazorpayTransferEntity> {
      calls.push(`fetchTransfer:${transferId}`);
      return (
        transfersById.get(transferId) || {
          id: transferId,
          recipient: 'acc_unknown',
          amount: 0,
          currency: 'INR',
          status: 'processed',
          settlement_status: 'pending',
        }
      );
    },
    async reverseTransfer(transferId, params): Promise<RazorpayTransferReversalEntity> {
      calls.push(`reverseTransfer:${transferId}`);
      return {
        id: `rvl_rp_${revSeq++}`,
        entity: 'reversal',
        transfer_id: transferId,
        amount: params.amountPaise,
        currency: 'INR',
        status: 'processed',
        notes: params.notes,
      };
    },
    async fetchSettlement(settlementId): Promise<RazorpaySettlementEntity> {
      calls.push(`fetchSettlement:${settlementId}`);
      return (
        settlementsById.get(settlementId) || {
          id: settlementId,
          amount: 100000,
          status: 'settled',
          utr: `UTR_${settlementId}`,
        }
      );
    },
  };

  return { client, calls, nextTransferResponses, transfersById, settlementsById, productsById };
}

async function signedWebhookReq(payload: Record<string, unknown>, eventId?: string) {
  const rawBody = JSON.stringify(payload);
  const sig = await hmacSha256Hex(WEBHOOK_SECRET, rawBody);
  return new Request('https://edge.nohaj.test/razorpay-route-webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-razorpay-signature': sig,
      ...(eventId ? { 'x-razorpay-event-id': eventId } : {}),
    },
    body: rawBody,
  });
}

// ============================================================================
// 16 REQUIRED STAGE 7.8.4 SCENARIO TESTS
// ============================================================================

test('1. Seller onboarding submission enforces private KYC path, consent, and never self-activates', () => {
  const repo = new InMemoryRouteMarketplaceHarness();
  assert.throws(
    () =>
      repo.submitOnboarding({
        userId: 'user-seller-1',
        sellerId: 'seller-1',
        legalBusinessName: 'Sualkuchi Looms',
        panLast4: '234F',
        bankAccountLast4: '4321',
        bankIfsc: 'SBIN0000001',
        kycPaths: ['user-seller-2/stolen.pdf'],
        consent: true,
        agreement: true,
      }),
    /ownership/i
  );

  assert.throws(
    () =>
      repo.submitOnboarding({
        userId: 'user-seller-1',
        sellerId: 'seller-1',
        legalBusinessName: 'Sualkuchi Looms',
        panLast4: '234F',
        bankAccountLast4: '4321',
        bankIfsc: 'SBIN0000001',
        kycPaths: ['user-seller-1/kyc-1.pdf'],
        consent: false,
        agreement: true,
      }),
    /consent/i
  );

  const submitted = repo.submitOnboarding({
    userId: 'user-seller-1',
    sellerId: 'seller-1',
    legalBusinessName: 'Sualkuchi Looms',
    panLast4: '234F',
    bankAccountLast4: '4321',
    bankIfsc: 'SBIN0000001',
    kycPaths: ['user-seller-1/kyc-1.pdf'],
    consent: true,
    agreement: true,
  });
  assert.equal(submitted.route_onboarding_status, 'submitted');
  assert.equal(submitted.payouts_enabled, false);
  assert.equal(submitted.pan_last4, '234F');
  assert.equal(submitted.bank_account_last4, '4321');
});

test('2. Unverified or non-active seller cannot receive Razorpay Route transfers', async () => {
  const repo = new InMemoryRouteMarketplaceHarness();
  const mock = createMockRouteClient();
  repo.submitOnboarding({
    userId: 'user-seller-1',
    sellerId: 'seller-1',
    legalBusinessName: 'Sualkuchi Looms',
    panLast4: '234F',
    bankAccountLast4: '4321',
    bankIfsc: 'SBIN0000001',
    kycPaths: ['user-seller-1/kyc-1.pdf'],
    consent: true,
    agreement: true,
  });
  repo.seedOrder({
    orderId: 'ord-unverified',
    sellers: [{ sellerOrderId: 'so-unv', sellerId: 'seller-1', subtotalPaise: 500000 }],
  });

  const res = await handleCreateRouteTransfer(
    new Request('https://edge.nohaj.test/transfer', {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-ops-admin' },
      body: JSON.stringify({ sellerOrderId: 'so-unv', idempotencyKey: 'idem-unv-1' }),
    }),
    { repo, razorpayClient: mock.client, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET, razorpayRouteEnabled: true } }
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /not active or verified/i);
  assert.equal(mock.calls.length, 0);
});

test('3. RAZORPAY_ROUTE_ENABLED=false blocks Linked Account and transfer calls cleanly with 503', async () => {
  const repo = new InMemoryRouteMarketplaceHarness();
  const mock = createMockRouteClient();
  const acct = repo.submitOnboarding({
    userId: 'user-seller-1',
    sellerId: 'seller-1',
    legalBusinessName: 'Sualkuchi Looms',
    panLast4: '234F',
    bankAccountLast4: '4321',
    bankIfsc: 'SBIN0000001',
    kycPaths: ['user-seller-1/kyc-1.pdf'],
    consent: true,
    agreement: true,
  });

  const resAcct = await handleCreateRouteLinkedAccount(
    new Request('https://edge.nohaj.test/linked-acct', {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-super-admin' },
      body: JSON.stringify({ accountId: acct.id }),
    }),
    { repo, razorpayClient: mock.client, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET, razorpayRouteEnabled: false } }
  );
  assert.equal(resAcct.status, 503);

  const resTr = await handleCreateRouteTransfer(
    new Request('https://edge.nohaj.test/transfer', {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-ops-admin' },
      body: JSON.stringify({ sellerOrderId: 'so-1', idempotencyKey: 'idem-disabled-1' }),
    }),
    { repo, razorpayClient: mock.client, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET, razorpayRouteEnabled: false } }
  );
  assert.equal(resTr.status, 503);
  assert.equal(mock.calls.length, 0);
});

test('4. Missing Razorpay Route gateway approval blocks transfers even when server env flag is true', async () => {
  const repo = new InMemoryRouteMarketplaceHarness();
  repo.gatewayConfig.razorpay_route_enabled = false;
  repo.gatewayConfig.route_approval_status = 'not_approved';
  const mock = createMockRouteClient();
  repo.seedActiveSellerAccount('seller-1', 'acc_rp_1');
  repo.seedOrder({
    orderId: 'ord-no-approval',
    sellers: [{ sellerOrderId: 'so-noapp', sellerId: 'seller-1', subtotalPaise: 500000 }],
  });

  const res = await handleCreateRouteTransfer(
    new Request('https://edge.nohaj.test/transfer', {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-ops-admin' },
      body: JSON.stringify({ sellerOrderId: 'so-noapp', idempotencyKey: 'idem-noapp-1' }),
    }),
    { repo, razorpayClient: mock.client, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET, razorpayRouteEnabled: true } }
  );
  assert.equal(res.status, 503);
  assert.equal(mock.calls.length, 0);
});

test('5. Successful Route Linked Account activation & transfer -> processed -> settled lifecycle with exact-once ledger', async () => {
  const repo = new InMemoryRouteMarketplaceHarness();
  const mock = createMockRouteClient();
  const acct = repo.submitOnboarding({
    userId: 'user-seller-1',
    sellerId: 'seller-1',
    legalBusinessName: 'Sualkuchi Looms',
    panLast4: '234F',
    bankAccountLast4: '4321',
    bankIfsc: 'SBIN0000001',
    kycPaths: ['user-seller-1/kyc-1.pdf'],
    consent: true,
    agreement: true,
  });

  const linkRes = await handleCreateRouteLinkedAccount(
    new Request('https://edge.nohaj.test/linked-acct', {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-ops-admin' },
      body: JSON.stringify({ accountId: acct.id, pan: 'ABCDE1234F', bankAccountNumber: '998877665544' }),
    }),
    { repo, razorpayClient: mock.client, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET, razorpayRouteEnabled: true } }
  );
  assert.equal(linkRes.status, 200);
  const linkJson = await linkRes.json();
  assert.equal(linkJson.routeOnboardingStatus, 'verification_pending');

  // Product activated via Razorpay webhook
  mock.productsById.set(`${linkJson.linkedAccountId}:${linkJson.productId}`, {
    id: linkJson.productId,
    account_id: linkJson.linkedAccountId,
    product_name: 'route',
    activation_status: 'activated',
  });
  const actWh = await handleRazorpayRouteWebhook(
    await signedWebhookReq(
      {
        event: 'product.route.activated',
        payload: { product: { entity: { id: linkJson.productId, account_id: linkJson.linkedAccountId, activation_status: 'activated' } } },
      },
      'evt_prod_act_1'
    ),
    { repo, razorpayClient: mock.client, env: { razorpayWebhookSecret: WEBHOOK_SECRET, razorpayRouteEnabled: true } }
  );
  assert.equal(actWh.status, 200);
  const actBody = await actWh.json();
  assert.equal(actBody.routeOnboardingStatus, 'active');
  assert.equal(actBody.payoutsEnabled, true);

  // Order subtotal 1,000 INR -> 12% commission (12,000 paise) -> 88,000 paise payable
  repo.seedOrder({
    orderId: 'ord-ok-1',
    sellers: [{ sellerOrderId: 'so-ok-1', sellerId: 'seller-1', subtotalPaise: 100000 }],
  });

  const trRes = await handleCreateRouteTransfer(
    new Request('https://edge.nohaj.test/transfer', {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-ops-admin' },
      body: JSON.stringify({ sellerOrderId: 'so-ok-1', idempotencyKey: 'idem-ok-1' }),
    }),
    { repo, razorpayClient: mock.client, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET, razorpayRouteEnabled: true } }
  );
  assert.equal(trRes.status, 200);
  const trJson = await trRes.json();
  assert.equal(trJson.transfer.amountPaise, 88000);
  assert.equal(trJson.transfer.status, 'created');

  // Transfer settled webhook
  mock.transfersById.set(trJson.transfer.providerTransferId, {
    id: trJson.transfer.providerTransferId,
    recipient: linkJson.linkedAccountId,
    amount: 88000,
    currency: 'INR',
    status: 'processed',
    settlement_status: 'settled',
    recipient_settlement_id: 'setl_rp_99',
  });
  const setWh = await handleRazorpayRouteWebhook(
    await signedWebhookReq(
      {
        event: 'transfer.settled',
        payload: {
          transfer: {
            entity: {
              id: trJson.transfer.providerTransferId,
              recipient: linkJson.linkedAccountId,
              amount: 88000,
              status: 'processed',
              settlement_status: 'settled',
              recipient_settlement_id: 'setl_rp_99',
            },
          },
        },
      },
      'evt_tr_settle_1'
    ),
    { repo, razorpayClient: mock.client, env: { razorpayWebhookSecret: WEBHOOK_SECRET, razorpayRouteEnabled: true } }
  );
  assert.equal(setWh.status, 200);
  const setJson = await setWh.json();
  assert.equal(setJson.settlementStatus, 'settled');
  assert.equal(repo.sellerOrders.get('so-ok-1')!.settledPaise, 88000);
  assert.equal(repo.settlementRecords.get('setl_rp_99')?.utr, 'UTR_setl_rp_99');
  assert.equal(repo.ledgerEntries.filter((e) => e.entryType === 'transfer_initiated').length, 1);
  assert.equal(repo.ledgerEntries.filter((e) => e.entryType === 'transfer_settled').length, 1);
});

test('6. Duplicate Route transfer request with same idempotencyKey replays without calling Razorpay twice', async () => {
  const repo = new InMemoryRouteMarketplaceHarness();
  const mock = createMockRouteClient();
  repo.seedActiveSellerAccount('seller-1', 'acc_rp_dup');
  repo.seedOrder({
    orderId: 'ord-dup',
    sellers: [{ sellerOrderId: 'so-dup', sellerId: 'seller-1', subtotalPaise: 50000 }],
  });

  const env = { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET, razorpayRouteEnabled: true };
  const first = await handleCreateRouteTransfer(
    new Request('https://edge.nohaj.test/transfer', {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-ops-admin' },
      body: JSON.stringify({ sellerOrderId: 'so-dup', idempotencyKey: 'idem-dup-key' }),
    }),
    { repo, razorpayClient: mock.client, env }
  );
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.idempotentReplay, false);

  const second = await handleCreateRouteTransfer(
    new Request('https://edge.nohaj.test/transfer', {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-ops-admin' },
      body: JSON.stringify({ sellerOrderId: 'so-dup', idempotencyKey: 'idem-dup-key' }),
    }),
    { repo, razorpayClient: mock.client, env }
  );
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(secondBody.idempotentReplay, true);
  assert.equal(secondBody.transfer.transferId, firstBody.transfer.transferId);
  assert.equal(mock.calls.filter((c) => c.startsWith('createPaymentTransfers')).length, 1);
  assert.equal(repo.ledgerEntries.length, 1);
});

test('7. Insufficient seller payable balance rejects over-transfer', async () => {
  const repo = new InMemoryRouteMarketplaceHarness();
  const mock = createMockRouteClient();
  repo.seedActiveSellerAccount('seller-1', 'acc_rp_ins');
  repo.seedOrder({
    orderId: 'ord-ins',
    sellers: [{ sellerOrderId: 'so-ins', sellerId: 'seller-1', subtotalPaise: 100000 }], // payable = 88,000
  });

  const res = await handleCreateRouteTransfer(
    new Request('https://edge.nohaj.test/transfer', {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-ops-admin' },
      body: JSON.stringify({ sellerOrderId: 'so-ins', amountPaise: 90000, idempotencyKey: 'idem-ins-1' }),
    }),
    { repo, razorpayClient: mock.client, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET, razorpayRouteEnabled: true } }
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /insufficient available seller payable balance/i);
  assert.equal(mock.calls.length, 0);
});

test('8. Multiple seller allocations for one parent order route each seller share accurately', async () => {
  const repo = new InMemoryRouteMarketplaceHarness();
  const mock = createMockRouteClient();
  repo.seedActiveSellerAccount('seller-1', 'acc_rp_m1');
  repo.seedActiveSellerAccount('seller-2', 'acc_rp_m2');
  repo.seedOrder({
    orderId: 'ord-multi',
    providerPaymentId: 'pay_multi_99',
    sellers: [
      { sellerOrderId: 'so-m1', sellerId: 'seller-1', subtotalPaise: 100000 }, // 88,000
      { sellerOrderId: 'so-m2', sellerId: 'seller-2', subtotalPaise: 200000 }, // 176,000
    ],
  });

  const res = await handleCreateRouteTransfer(
    new Request('https://edge.nohaj.test/transfer', {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-ops-admin' },
      body: JSON.stringify({
        allocations: [
          { sellerOrderId: 'so-m1', idempotencyKey: 'idem-multi-1' },
          { sellerOrderId: 'so-m2', idempotencyKey: 'idem-multi-2', onHold: true },
        ],
      }),
    }),
    { repo, razorpayClient: mock.client, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET, razorpayRouteEnabled: true } }
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.transfers.length, 2);
  assert.equal(body.transfers[0].amountPaise, 88000);
  assert.equal(body.transfers[1].amountPaise, 176000);
  assert.equal(body.transfers[1].status, 'on_hold');
  assert.equal(mock.calls.filter((c) => c === 'createPaymentTransfers:pay_multi_99').length, 1);
});

test('9. Failed transfer can be retried cleanly without double allocation', async () => {
  const repo = new InMemoryRouteMarketplaceHarness();
  const mock = createMockRouteClient();
  repo.seedActiveSellerAccount('seller-1', 'acc_rp_retry');
  repo.seedOrder({
    orderId: 'ord-retry',
    sellers: [{ sellerOrderId: 'so-retry', sellerId: 'seller-1', subtotalPaise: 100000 }],
  });

  mock.nextTransferResponses.push(new RazorpayApiError('Bank holiday rejection', 400, 'BAD_REQUEST_ERROR'));
  const env = { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET, razorpayRouteEnabled: true };

  const failedRes = await handleCreateRouteTransfer(
    new Request('https://edge.nohaj.test/transfer', {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-ops-admin' },
      body: JSON.stringify({ sellerOrderId: 'so-retry', idempotencyKey: 'idem-retry-1' }),
    }),
    { repo, razorpayClient: mock.client, env }
  );
  assert.equal(failedRes.status, 400);
  const failedTransfer = Array.from(repo.transfers.values())[0];
  assert.equal(failedTransfer.status, 'failed');
  assert.equal(repo.getAvailableTransferablePaise('so-retry'), 88000);

  const retryRes = await handleCreateRouteTransfer(
    new Request('https://edge.nohaj.test/transfer', {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-ops-admin' },
      body: JSON.stringify({
        sellerOrderId: 'so-retry',
        transferId: failedTransfer.id,
        idempotencyKey: 'idem-retry-2',
      }),
    }),
    { repo, razorpayClient: mock.client, env }
  );
  assert.equal(retryRes.status, 200);
  const retryBody = await retryRes.json();
  assert.equal(retryBody.transfer.transferId, failedTransfer.id);
  assert.equal(retryBody.transfer.status, 'created');
  assert.equal(repo.transfers.get(failedTransfer.id)!.retryCount, 1);
  assert.equal(repo.getAvailableTransferablePaise('so-retry'), 0);
});

test('10. Transfer reversal reverses eligible balance, posts transfer_reversal ledger, and blocks over-reversal', async () => {
  const repo = new InMemoryRouteMarketplaceHarness();
  const mock = createMockRouteClient();
  repo.seedActiveSellerAccount('seller-1', 'acc_rp_rev');
  repo.seedOrder({
    orderId: 'ord-rev',
    sellers: [{ sellerOrderId: 'so-rev', sellerId: 'seller-1', subtotalPaise: 100000 }],
  });

  const env = { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET, razorpayRouteEnabled: true };
  const trRes = await handleCreateRouteTransfer(
    new Request('https://edge.nohaj.test/transfer', {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-ops-admin' },
      body: JSON.stringify({ sellerOrderId: 'so-rev', idempotencyKey: 'idem-rev-tr' }),
    }),
    { repo, razorpayClient: mock.client, env }
  );
  const trBody = await trRes.json();

  const revRes = await handleReverseRouteTransfer(
    new Request('https://edge.nohaj.test/reverse', {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-ops-admin' },
      body: JSON.stringify({
        transferId: trBody.transfer.transferId,
        reason: 'Full customer cancellation refund',
        idempotencyKey: 'idem-rev-1',
      }),
    }),
    { repo, razorpayClient: mock.client, env }
  );
  assert.equal(revRes.status, 200);
  const revBody = await revRes.json();
  assert.equal(revBody.transferStatus, 'reversed');
  assert.equal(revBody.amountPaise, 88000);
  assert.equal(repo.ledgerEntries.filter((e) => e.entryType === 'transfer_reversal').length, 1);

  const overRev = await handleReverseRouteTransfer(
    new Request('https://edge.nohaj.test/reverse', {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-ops-admin' },
      body: JSON.stringify({
        transferId: trBody.transfer.transferId,
        amountPaise: 1000,
        reason: 'Duplicate attempt',
        idempotencyKey: 'idem-rev-2',
      }),
    }),
    { repo, razorpayClient: mock.client, env }
  );
  assert.equal(overRev.status, 400);
});

test('11. Partial refund after transfer supports partial reversal while preserving historical ledger rows', async () => {
  const repo = new InMemoryRouteMarketplaceHarness();
  const mock = createMockRouteClient();
  repo.seedActiveSellerAccount('seller-1', 'acc_rp_part');
  repo.seedOrder({
    orderId: 'ord-part',
    sellers: [{ sellerOrderId: 'so-part', sellerId: 'seller-1', subtotalPaise: 200000 }], // payable = 176,000
  });
  const env = { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET, razorpayRouteEnabled: true };

  // Transfer half (88,000 paise)
  const trRes = await handleCreateRouteTransfer(
    new Request('https://edge.nohaj.test/transfer', {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-ops-admin' },
      body: JSON.stringify({ sellerOrderId: 'so-part', amountPaise: 88000, idempotencyKey: 'idem-part-tr' }),
    }),
    { repo, razorpayClient: mock.client, env }
  );
  const trBody = await trRes.json();
  const initialLedgerSnapshot = [...repo.ledgerEntries];

  // Partial refund reverses 44,000 of seller payable
  repo.applyRefundAdjustment('so-part', 44000);
  assert.equal(repo.getAvailableTransferablePaise('so-part'), 44000);

  // Reverse 44,000 from already executed transfer
  const partRev = await handleReverseRouteTransfer(
    new Request('https://edge.nohaj.test/reverse', {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-ops-admin' },
      body: JSON.stringify({
        transferId: trBody.transfer.transferId,
        amountPaise: 44000,
        refundId: 'rfnd-partial-1',
        reason: 'Partial item return adjustment',
        idempotencyKey: 'idem-part-rev',
      }),
    }),
    { repo, razorpayClient: mock.client, env }
  );
  assert.equal(partRev.status, 200);
  const partBody = await partRev.json();
  assert.equal(partBody.transferStatus, 'partially_reversed');
  // Original ledger row remains intact and append-only; new reversal credit row appended
  assert.deepEqual(repo.ledgerEntries[0], initialLedgerSnapshot[0]);
  assert.equal(repo.ledgerEntries.length, 2);
});

test('12. COD orders have zero transferable Route balance and are strictly rejected from Route transfers', async () => {
  const repo = new InMemoryRouteMarketplaceHarness();
  const mock = createMockRouteClient();
  repo.seedActiveSellerAccount('seller-1', 'acc_rp_cod');
  repo.seedOrder({
    orderId: 'ord-cod-1',
    paymentMethod: 'cod',
    paymentStatus: 'cod_collected',
    sellers: [{ sellerOrderId: 'so-cod-1', sellerId: 'seller-1', subtotalPaise: 120000 }],
  });

  assert.equal(repo.getAvailableTransferablePaise('so-cod-1'), 0);

  const res = await handleCreateRouteTransfer(
    new Request('https://edge.nohaj.test/transfer', {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-ops-admin' },
      body: JSON.stringify({ sellerOrderId: 'so-cod-1', idempotencyKey: 'idem-cod-1' }),
    }),
    { repo, razorpayClient: mock.client, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET, razorpayRouteEnabled: true } }
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /COD seller orders cannot be routed/i);
  assert.equal(mock.calls.length, 0);
});

test('13. Unauthorized seller and customer receive 403/401 across all Route admin endpoints', async () => {
  const repo = new InMemoryRouteMarketplaceHarness();
  const mock = createMockRouteClient();
  const env = { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET, razorpayRouteEnabled: true };

  for (const jwt of ['jwt-seller-1', 'jwt-cust-1']) {
    const r1 = await handleCreateRouteLinkedAccount(
      new Request('https://edge.nohaj.test/la', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ accountId: 'ssa-1' }),
      }),
      { repo, razorpayClient: mock.client, env }
    );
    assert.equal(r1.status, 403);

    const r2 = await handleUpdateRouteLinkedAccount(
      new Request('https://edge.nohaj.test/lu', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ accountId: 'ssa-1' }),
      }),
      { repo, razorpayClient: mock.client, env }
    );
    assert.equal(r2.status, 403);

    const r3 = await handleCreateRouteTransfer(
      new Request('https://edge.nohaj.test/tr', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ sellerOrderId: 'so-1', idempotencyKey: 'idem-x-1' }),
      }),
      { repo, razorpayClient: mock.client, env }
    );
    assert.equal(r3.status, 403);

    const r4 = await handleReverseRouteTransfer(
      new Request('https://edge.nohaj.test/rv', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ transferId: 'tr-1', idempotencyKey: 'idem-x-2' }),
      }),
      { repo, razorpayClient: mock.client, env }
    );
    assert.equal(r4.status, 403);

    const r5 = await handleRouteSettlementReconciliation(
      new Request('https://edge.nohaj.test/rec', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}` },
      }),
      { repo, razorpayClient: mock.client, env }
    );
    assert.equal(r5.status, 403);
  }
});

test('14. Content Admin is strictly excluded from Route endpoints, UI settlement tab, and SQL RLS', async () => {
  const repo = new InMemoryRouteMarketplaceHarness();
  const mock = createMockRouteClient();
  const env = { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET, razorpayRouteEnabled: true };

  assert.equal(canAccessAdminTab('content_admin', 'settlements'), false);
  assert.equal(canAccessAdminTab('operations_admin', 'settlements'), true);
  assert.equal(canAccessAdminTab('super_admin', 'settlements'), true);
  assert.deepEqual(ADMIN_ROLE_PERMISSIONS.content_admin, ['overview', 'moderation', 'communities', 'content']);

  const r1 = await handleCreateRouteTransfer(
    new Request('https://edge.nohaj.test/tr', {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-content-admin' },
      body: JSON.stringify({ sellerOrderId: 'so-1', idempotencyKey: 'idem-ca-1' }),
    }),
    { repo, razorpayClient: mock.client, env }
  );
  assert.equal(r1.status, 403);

  const sql011 = fs.readFileSync(
    path.join(repoRoot, 'supabase/migrations/011_razorpay_route_and_settlements.sql'),
    'utf8'
  );
  assert.match(sql011, /is_operations_admin\(v_uid\)/);
  const sql011NoComments = sql011.replace(/--.*$/gm, '');
  assert.ok(!sql011NoComments.includes('content_admin'));
});

test('15. Route webhook rejects invalid HMAC signature, deduplicates repeated deliveries, and ignores stale updates', async () => {
  const repo = new InMemoryRouteMarketplaceHarness();
  const mock = createMockRouteClient();
  repo.seedActiveSellerAccount('seller-1', 'acc_rp_wh');
  repo.seedOrder({
    orderId: 'ord-wh',
    sellers: [{ sellerOrderId: 'so-wh', sellerId: 'seller-1', subtotalPaise: 100000 }],
  });

  const badSig = await handleRazorpayRouteWebhook(
    new Request('https://edge.nohaj.test/razorpay-route-webhook', {
      method: 'POST',
      headers: { 'x-razorpay-signature': 'invalid_sig', 'x-razorpay-event-id': 'evt_bad_1' },
      body: JSON.stringify({ event: 'transfer.processed' }),
    }),
    { repo, razorpayClient: mock.client, env: { razorpayWebhookSecret: WEBHOOK_SECRET, razorpayRouteEnabled: true } }
  );
  assert.equal(badSig.status, 401);

  const env = { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET, razorpayRouteEnabled: true };
  const trRes = await handleCreateRouteTransfer(
    new Request('https://edge.nohaj.test/tr', {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-ops-admin' },
      body: JSON.stringify({ sellerOrderId: 'so-wh', idempotencyKey: 'idem-wh-1' }),
    }),
    { repo, razorpayClient: mock.client, env }
  );
  const trBody = await trRes.json();
  const rpTrId = trBody.transfer.providerTransferId;

  mock.transfersById.set(rpTrId, {
    id: rpTrId,
    recipient: 'acc_rp_wh',
    amount: 88000,
    currency: 'INR',
    status: 'processed',
    settlement_status: 'settled',
    recipient_settlement_id: 'setl_wh_1',
  });

  const whPayload = {
    event: 'transfer.settled',
    payload: { transfer: { entity: { id: rpTrId, recipient: 'acc_rp_wh', amount: 88000, status: 'processed', settlement_status: 'settled', recipient_settlement_id: 'setl_wh_1' } } },
  };
  const firstWh = await handleRazorpayRouteWebhook(
    await signedWebhookReq(whPayload, 'evt_dup_wh_1'),
    { repo, razorpayClient: mock.client, env: { razorpayWebhookSecret: WEBHOOK_SECRET, razorpayRouteEnabled: true } }
  );
  assert.equal(firstWh.status, 200);
  const firstJson = await firstWh.json();
  assert.equal(firstJson.settlementStatus, 'settled');

  // Exact replay with same x-razorpay-event-id
  const replayWh = await handleRazorpayRouteWebhook(
    await signedWebhookReq(whPayload, 'evt_dup_wh_1'),
    { repo, razorpayClient: mock.client, env: { razorpayWebhookSecret: WEBHOOK_SECRET, razorpayRouteEnabled: true } }
  );
  assert.equal(replayWh.status, 200);
  const replayJson = await replayWh.json();
  assert.equal(replayJson.deduplicated, true);

  // Stale out-of-order regression (transfer.processed after transfer.settled) ignored
  mock.transfersById.set(rpTrId, {
    id: rpTrId,
    recipient: 'acc_rp_wh',
    amount: 88000,
    currency: 'INR',
    status: 'processed',
    settlement_status: 'pending',
  });
  const staleWh = await handleRazorpayRouteWebhook(
    await signedWebhookReq(
      { event: 'transfer.processed', payload: { transfer: { entity: { id: rpTrId, status: 'processed' } } } },
      'evt_stale_wh_2'
    ),
    { repo, razorpayClient: mock.client, env: { razorpayWebhookSecret: WEBHOOK_SECRET, razorpayRouteEnabled: true } }
  );
  assert.equal(staleWh.status, 200);
  const staleJson = await staleWh.json();
  assert.equal(staleJson.ignoredOutOfOrder, true);
});

test('16. Route reconciliation resolves pending/processed transfers to settled with UTR and logs run', async () => {
  const repo = new InMemoryRouteMarketplaceHarness();
  const mock = createMockRouteClient();
  repo.seedActiveSellerAccount('seller-1', 'acc_rp_rec');
  repo.seedOrder({
    orderId: 'ord-rec',
    sellers: [{ sellerOrderId: 'so-rec', sellerId: 'seller-1', subtotalPaise: 100000 }],
  });
  const env = {
    razorpayKeyId: KEY_ID,
    razorpayKeySecret: KEY_SECRET,
    razorpayRouteEnabled: true,
    cronSecret: CRON_SECRET,
  };

  const trRes = await handleCreateRouteTransfer(
    new Request('https://edge.nohaj.test/tr', {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-ops-admin' },
      body: JSON.stringify({ sellerOrderId: 'so-rec', idempotencyKey: 'idem-rec-1' }),
    }),
    { repo, razorpayClient: mock.client, env }
  );
  const trBody = await trRes.json();
  const rpTrId = trBody.transfer.providerTransferId;

  // Razorpay settles transfer asynchronously
  mock.transfersById.set(rpTrId, {
    id: rpTrId,
    recipient: 'acc_rp_rec',
    amount: 88000,
    currency: 'INR',
    status: 'processed',
    settlement_status: 'settled',
    recipient_settlement_id: 'setl_rec_77',
  });

  const recRes = await handleRouteSettlementReconciliation(
    new Request('https://edge.nohaj.test/reconcile', {
      method: 'POST',
      headers: { 'x-cron-secret': CRON_SECRET },
    }),
    { repo, razorpayClient: mock.client, env }
  );
  assert.equal(recRes.status, 200);
  const recJson = await recRes.json();
  assert.equal(recJson.ok, true);
  assert.equal(recJson.checkedCount, 1);
  assert.equal(recJson.settledCount, 1);
  assert.equal(repo.transfers.get(trBody.transfer.transferId)!.settlementUtr, 'UTR_setl_rec_77');
  assert.equal(repo.reconciliationRuns.length, 1);
});
