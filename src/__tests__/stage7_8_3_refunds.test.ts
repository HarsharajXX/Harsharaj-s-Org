/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hmacSha256Hex } from '../../supabase/functions/_shared/crypto.ts';
import { RazorpayApiError } from '../../supabase/functions/_shared/razorpayClient.ts';
import type {
  AuthenticatedCustomer,
  FinalizeOnlineRefundResult,
  RazorpayOrderEntity,
  RazorpayPaymentEntity,
  RazorpayRefundApiClient,
  RazorpayRefundEntity,
  RefundEdgeRepository,
  RefundItemReservationInput,
  ReserveOnlineRefundResult,
} from '../../supabase/functions/_shared/types.ts';
import { handleCreateRazorpayRefund } from '../../supabase/functions/razorpay-create-refund/handler.ts';
import { handleRazorpayRefundWebhook } from '../../supabase/functions/razorpay-refund-webhook/handler.ts';
import {
  calculateProportionalRefundReversalPaise,
  type CodCancellationStage,
} from '../services/payments/paymentTypes.ts';
import { canAccessAdminTab } from '../utils/commerceRules.ts';
import { canRequestCustomerRefund, getRefundStatusLabel } from '../services/payments/paymentStatus.ts';

const repoRoot = process.cwd();
const KEY_ID = 'rzp_test_U087Ttl5tHUUQq';
const KEY_SECRET = 'mock_razorpay_key_secret_tests_only';
const WEBHOOK_SECRET = 'mock_razorpay_webhook_secret_tests_only';

interface SimOrderItem {
  id: string;
  orderId: string;
  sellerOrderId: string;
  productId: string;
  quantity: number;
  unitPricePaise: number;
  refundedQuantity: number;
  refundedPaise: number;
  restockedQuantity: number;
}

interface SimSellerOrder {
  id: string;
  orderId: string;
  sellerId: string;
  subtotalPaise: number;
  commissionRateSnapshot: number; // e.g. 0.12
  commissionAmountPaise: number;
  sellerPayablePaise: number;
  refundPaise: number;
  outstandingBalancePaise: number;
  fulfilmentStatus: string;
  codReconciliationStatus: string;
  inventoryRestored: boolean;
}

interface SimOrder {
  id: string;
  orderNumber: string;
  customerId: string;
  paymentMethod: 'online' | 'cod';
  paymentStatus: string;
  orderStatus: string;
  codLifecycleStatus: string;
  totalPaise: number;
  shippingPaise: number;
}

interface SimPayment {
  id: string;
  orderId: string;
  providerPaymentId: string | null;
  status: string;
  capturedPaise: number;
  refundedPaise: number;
}

interface SimRefundRecord {
  id: string;
  orderId: string;
  paymentId: string | null;
  sellerOrderId: string | null;
  refundChannel: 'razorpay' | 'cod_manual';
  refundType: string;
  amountPaise: number;
  shippingRefundPaise: number;
  courierDeductionPaise: number;
  status: 'pending' | 'processed' | 'failed';
  requestStatus: 'requested' | 'approved' | 'rejected' | 'processing' | 'completed' | 'failed';
  providerRefundId: string | null;
  manualReference: string | null;
  refundMethod: string | null;
  reason: string;
  idempotencyKey: string;
  restockRequired: boolean;
  restockStatus: 'not_applicable' | 'pending_inspection' | 'restocked' | 'rejected_damaged';
  sellerAdjustments: Array<{
    sellerOrderId: string;
    grossRefundPaise: number;
    commissionReversedPaise: number;
    sellerPayableReversedPaise: number;
    applied: boolean;
  }>;
  items: Array<{ orderItemId: string; quantity: number; lineAmountPaise: number }>;
}

interface SimCodRecord {
  sellerOrderId: string;
  orderId: string;
  codOrderValuePaise: number;
  collectedAmountPaise: number;
  refundedAmountPaise: number;
  courierDeductionPaise: number;
  collectionStatus: 'pending' | 'collected' | 'remitted' | 'cancelled' | 'failed_delivery';
  reconciliationStatus: string;
  cancellationStage?: string;
}

interface SimLedgerEntry {
  orderId: string;
  sellerOrderId?: string | null;
  refundId?: string | null;
  entryType: string;
  direction: 'debit' | 'credit';
  amountPaise: number;
  referenceId?: string | null;
}

class InMemoryRefundMarketplaceHarness implements RefundEdgeRepository {
  public users: Record<string, { id: string; email: string; roles: string[] }> = {
    'jwt-super-admin': { id: 'adm-super', email: 'super@nohaj.com', roles: ['super_admin'] },
    'jwt-ops-admin': { id: 'adm-ops', email: 'ops@nohaj.com', roles: ['operations_admin'] },
    'jwt-content-admin': { id: 'adm-content', email: 'content@nohaj.com', roles: ['content_admin'] },
    'jwt-seller-1': { id: 'user-seller-1', email: 'seller1@nohaj.com', roles: ['seller'] },
    'jwt-cust-1': { id: 'cust-1', email: 'customer@example.com', roles: ['customer'] },
  };

  public currentMarketplaceCommissionRate = 0.12; // Can change later without affecting historical snapshots
  public productStock = new Map<string, number>();
  public orders = new Map<string, SimOrder>();
  public sellerOrders = new Map<string, SimSellerOrder>();
  public orderItems = new Map<string, SimOrderItem>();
  public payments = new Map<string, SimPayment>();
  public refunds = new Map<string, SimRefundRecord>();
  public refundInternalNotes = new Map<string, string>();
  public codRecords = new Map<string, SimCodRecord>();
  public webhooks = new Map<string, { status: string; errorMessage?: string | null }>();
  public ledgerEntries: SimLedgerEntry[] = [];
  private seq = 1;

  seedOnlineOrder(params: {
    orderId: string;
    captured?: boolean;
    sellers?: Array<{ id: string; sellerId: string; items: Array<{ id: string; productId: string; qty: number; unitPricePaise: number }> }>;
    shippingPaise?: number;
  }) {
    const captured = params.captured ?? true;
    const shippingPaise = params.shippingPaise ?? 0;
    const sellerConfigs = params.sellers || [
      {
        id: `${params.orderId}-so-1`,
        sellerId: 'seller-1',
        items: [{ id: `${params.orderId}-item-1`, productId: 'prod-1', qty: 2, unitPricePaise: 150000 }],
      },
    ];

    let subtotalTotal = 0;
    for (const sc of sellerConfigs) {
      let soSub = 0;
      for (const it of sc.items) {
        if (!this.productStock.has(it.productId)) {
          this.productStock.set(it.productId, 10);
        }
        const line = it.qty * it.unitPricePaise;
        soSub += line;
        this.orderItems.set(it.id, {
          id: it.id,
          orderId: params.orderId,
          sellerOrderId: sc.id,
          productId: it.productId,
          quantity: it.qty,
          unitPricePaise: it.unitPricePaise,
          refundedQuantity: 0,
          refundedPaise: 0,
          restockedQuantity: 0,
        });
      }
      subtotalTotal += soSub;
      const comm = Math.round(soSub * 0.12);
      const payable = soSub - comm;
      this.sellerOrders.set(sc.id, {
        id: sc.id,
        orderId: params.orderId,
        sellerId: sc.sellerId,
        subtotalPaise: soSub,
        commissionRateSnapshot: 0.12,
        commissionAmountPaise: comm,
        sellerPayablePaise: payable,
        refundPaise: 0,
        outstandingBalancePaise: payable,
        fulfilmentStatus: captured ? 'confirmed' : 'pending_payment',
        codReconciliationStatus: 'not_applicable',
        inventoryRestored: false,
      });
    }

    const totalPaise = subtotalTotal + shippingPaise;
    this.orders.set(params.orderId, {
      id: params.orderId,
      orderNumber: `NHJ-${params.orderId.toUpperCase()}`,
      customerId: 'cust-1',
      paymentMethod: 'online',
      paymentStatus: captured ? 'captured' : 'failed',
      orderStatus: captured ? 'confirmed' : 'payment_failed',
      codLifecycleStatus: 'not_applicable',
      totalPaise,
      shippingPaise,
    });

    this.payments.set(`pay-${params.orderId}`, {
      id: `pay-${params.orderId}`,
      orderId: params.orderId,
      providerPaymentId: captured ? `pay_rp_${params.orderId}` : null,
      status: captured ? 'captured' : 'failed',
      capturedPaise: captured ? totalPaise : 0,
      refundedPaise: 0,
    });
  }

  seedCodSellerOrder(params: {
    orderId: string;
    sellerOrderId: string;
    productId: string;
    qty: number;
    unitPricePaise: number;
    fulfilmentStatus: string;
    collected?: boolean;
  }) {
    const subtotalPaise = params.qty * params.unitPricePaise;
    const comm = Math.round(subtotalPaise * 0.12);
    const payable = subtotalPaise - comm;
    if (!this.productStock.has(params.productId)) {
      this.productStock.set(params.productId, 10);
    }

    this.orders.set(params.orderId, {
      id: params.orderId,
      orderNumber: `NHJ-${params.orderId.toUpperCase()}`,
      customerId: 'cust-1',
      paymentMethod: 'cod',
      paymentStatus: params.collected ? 'cod_collected' : 'cod_pending',
      orderStatus: params.fulfilmentStatus,
      codLifecycleStatus: params.collected ? 'collected' : 'confirmed',
      totalPaise: subtotalPaise,
      shippingPaise: 0,
    });

    this.sellerOrders.set(params.sellerOrderId, {
      id: params.sellerOrderId,
      orderId: params.orderId,
      sellerId: 'seller-1',
      subtotalPaise,
      commissionRateSnapshot: 0.12,
      commissionAmountPaise: comm,
      sellerPayablePaise: payable,
      refundPaise: 0,
      outstandingBalancePaise: payable,
      fulfilmentStatus: params.fulfilmentStatus,
      codReconciliationStatus: params.collected ? 'collected' : 'awaiting_collection',
      inventoryRestored: false,
    });

    this.orderItems.set(`${params.orderId}-item-1`, {
      id: `${params.orderId}-item-1`,
      orderId: params.orderId,
      sellerOrderId: params.sellerOrderId,
      productId: params.productId,
      quantity: params.qty,
      unitPricePaise: params.unitPricePaise,
      refundedQuantity: 0,
      refundedPaise: 0,
      restockedQuantity: 0,
    });

    this.codRecords.set(params.sellerOrderId, {
      sellerOrderId: params.sellerOrderId,
      orderId: params.orderId,
      codOrderValuePaise: subtotalPaise,
      collectedAmountPaise: params.collected ? subtotalPaise : 0,
      refundedAmountPaise: 0,
      courierDeductionPaise: 0,
      collectionStatus: params.collected ? 'collected' : 'pending',
      reconciliationStatus: params.collected ? 'collected' : 'awaiting_collection',
    });
  }

  async authenticateCustomer(jwt: string): Promise<AuthenticatedCustomer | null> {
    const u = this.users[jwt];
    return u ? { id: u.id, email: u.email } : null;
  }

  async isOperationsAdmin(userId: string): Promise<boolean> {
    const user = Object.values(this.users).find((u) => u.id === userId);
    return Boolean(user && user.roles.some((r) => r === 'super_admin' || r === 'operations_admin'));
  }

  private assertAdmin(actorId: string) {
    const user = Object.values(this.users).find((u) => u.id === actorId);
    if (!user || !user.roles.some((r) => r === 'super_admin' || r === 'operations_admin')) {
      throw new Error('Forbidden: admin privilege required.');
    }
  }

  private activeAndProcessedAmount(orderId: string, excludeRefundId?: string): number {
    let sum = 0;
    for (const rf of this.refunds.values()) {
      if (rf.orderId === orderId && rf.id !== excludeRefundId) {
        if (rf.status === 'processed' || rf.status === 'pending') {
          sum += rf.amountPaise;
        }
      }
    }
    return sum;
  }

  private alreadyCommissionReversed(sellerOrderId: string): number {
    let sum = 0;
    for (const rf of this.refunds.values()) {
      if (rf.status !== 'failed' && rf.requestStatus !== 'rejected') {
        for (const adj of rf.sellerAdjustments) {
          if (adj.sellerOrderId === sellerOrderId && adj.applied) {
            sum += adj.commissionReversedPaise;
          }
        }
      }
    }
    return sum;
  }

  private alreadyPayableReversed(sellerOrderId: string): number {
    let sum = 0;
    for (const rf of this.refunds.values()) {
      if (rf.status !== 'failed' && rf.requestStatus !== 'rejected') {
        for (const adj of rf.sellerAdjustments) {
          if (adj.sellerOrderId === sellerOrderId && adj.applied) {
            sum += adj.sellerPayableReversedPaise;
          }
        }
      }
    }
    return sum;
  }

  async reserveOnlineRefund(params: {
    actorId: string;
    orderId: string;
    refundId?: string | null;
    sellerOrderId?: string | null;
    items?: RefundItemReservationInput[] | null;
    amountPaise?: number | null;
    shippingRefundPaise?: number;
    reason: string;
    idempotencyKey: string;
    internalNotes?: string | null;
  }): Promise<ReserveOnlineRefundResult> {
    this.assertAdmin(params.actorId);

    const existingIdem = Array.from(this.refunds.values()).find(
      (r) => r.idempotencyKey === params.idempotencyKey
    );
    const payment = Array.from(this.payments.values()).find((p) => p.orderId === params.orderId);

    if (existingIdem) {
      if (!payment?.providerPaymentId) {
        throw new Error('No Razorpay payment found.');
      }
      return {
        refund_id: existingIdem.id,
        order_id: existingIdem.orderId,
        provider_payment_id: payment.providerPaymentId,
        amount_paise: existingIdem.amountPaise,
        currency: 'INR',
        already_initiated: existingIdem.providerRefundId !== null || existingIdem.status === 'processed',
        provider_refund_id: existingIdem.providerRefundId,
        refund_status: existingIdem.status,
      };
    }

    const order = this.orders.get(params.orderId);
    if (!order) throw new Error('Order not found.');
    if (order.paymentMethod !== 'online') throw new Error('Online Razorpay refund only valid for online orders.');
    if (!payment || !['captured', 'partially_refunded', 'refund_pending'].includes(payment.status)) {
      throw new Error('Order payment is not captured or refundable.');
    }
    if (!payment.providerPaymentId) throw new Error('Missing Razorpay provider_payment_id.');

    if (params.refundId) {
      const preExisting = this.refunds.get(params.refundId);
      if (!preExisting) throw new Error('Refund record not found.');
      if (preExisting.providerRefundId || preExisting.status === 'processed') {
        return {
          refund_id: preExisting.id,
          order_id: preExisting.orderId,
          provider_payment_id: payment.providerPaymentId,
          amount_paise: preExisting.amountPaise,
          currency: 'INR',
          already_initiated: true,
          provider_refund_id: preExisting.providerRefundId,
          refund_status: preExisting.status,
        };
      }
      const reservedSum = this.activeAndProcessedAmount(order.id, preExisting.id);
      if (reservedSum + preExisting.amountPaise > payment.capturedPaise) {
        throw new Error('Refund exceeds captured payment amount.');
      }
      preExisting.status = 'pending';
      preExisting.requestStatus = 'processing';
      if (params.internalNotes) {
        this.refundInternalNotes.set(preExisting.id, params.internalNotes);
      }
      return {
        refund_id: preExisting.id,
        order_id: preExisting.orderId,
        provider_payment_id: payment.providerPaymentId,
        amount_paise: preExisting.amountPaise,
        currency: 'INR',
        already_initiated: false,
        provider_refund_id: null,
        refund_status: 'pending',
      };
    }

    const shippingRefundPaise = params.shippingRefundPaise ?? 0;
    const reservedSum = this.activeAndProcessedAmount(order.id);
    const remainingCap = Math.max(0, payment.capturedPaise - reservedSum);

    let productAmountPaise = 0;
    const itemAllocations: Array<{ orderItemId: string; quantity: number; lineAmountPaise: number }> = [];
    const sellerBuckets = new Map<string, number>();

    if (params.items && params.items.length > 0) {
      for (const entry of params.items) {
        const oi = this.orderItems.get(entry.order_item_id);
        if (!oi || oi.orderId !== order.id) throw new Error('Order item not found.');
        const remainingQty = oi.quantity - oi.refundedQuantity;
        if (entry.quantity > remainingQty) throw new Error('Item refund quantity exceeds remaining.');
        const line = oi.unitPricePaise * entry.quantity;
        productAmountPaise += line;
        itemAllocations.push({ orderItemId: oi.id, quantity: entry.quantity, lineAmountPaise: line });
        sellerBuckets.set(oi.sellerOrderId, (sellerBuckets.get(oi.sellerOrderId) || 0) + line);
      }
    } else if (params.sellerOrderId) {
      const so = this.sellerOrders.get(params.sellerOrderId);
      if (!so || so.orderId !== order.id) throw new Error('Seller order not found.');
      const soRem = Math.max(0, so.subtotalPaise - so.refundPaise);
      productAmountPaise = params.amountPaise ?? soRem;
      if (productAmountPaise > soRem) throw new Error('Refund amount exceeds remaining seller subtotal.');
      sellerBuckets.set(so.id, productAmountPaise);
    } else {
      const targetTotal = params.amountPaise ?? remainingCap;
      productAmountPaise = Math.max(0, targetTotal - shippingRefundPaise);
      const sos = Array.from(this.sellerOrders.values()).filter((s) => s.orderId === order.id);
      const totalRem = sos.reduce((sum, s) => sum + Math.max(0, s.subtotalPaise - s.refundPaise), 0);
      if (productAmountPaise > totalRem) {
        throw new Error('Refund exceeds captured payment / remaining product subtotal.');
      }
      let allocated = 0;
      sos.forEach((s, idx) => {
        const rem = Math.max(0, s.subtotalPaise - s.refundPaise);
        const share =
          idx === sos.length - 1
            ? productAmountPaise - allocated
            : Math.min(rem, Math.floor((productAmountPaise * rem) / Math.max(1, totalRem)));
        allocated += share;
        if (share > 0) sellerBuckets.set(s.id, share);
      });
    }

    const totalAmountPaise = productAmountPaise + shippingRefundPaise;
    if (totalAmountPaise <= 0 || totalAmountPaise > remainingCap) {
      throw new Error('Refund exceeds remaining captured payment balance.');
    }

    const sellerAdjustments = Array.from(sellerBuckets.entries()).map(([soId, grossPaise]) => {
      const so = this.sellerOrders.get(soId)!;
      const rev = calculateProportionalRefundReversalPaise({
        sellerSubtotalPaise: so.subtotalPaise,
        historicalCommissionPaise: so.commissionAmountPaise,
        historicalSellerPayablePaise: so.sellerPayablePaise,
        grossRefundPaise: grossPaise,
        alreadyRefundedPaise: so.refundPaise,
        alreadyCommissionReversedPaise: this.alreadyCommissionReversed(soId),
        alreadySellerPayableReversedPaise: this.alreadyPayableReversed(soId),
      });
      return {
        sellerOrderId: soId,
        grossRefundPaise: rev.grossRefundPaise,
        commissionReversedPaise: rev.commissionReversedPaise,
        sellerPayableReversedPaise: rev.sellerPayableReversedPaise,
        applied: false,
      };
    });

    const newId = `rfnd-${this.seq++}`;
    this.refunds.set(newId, {
      id: newId,
      orderId: order.id,
      paymentId: payment.id,
      sellerOrderId: params.sellerOrderId ?? null,
      refundChannel: 'razorpay',
      refundType: params.items?.length
        ? 'partial_item'
        : totalAmountPaise >= payment.capturedPaise
          ? 'full'
          : 'partial_amount',
      amountPaise: totalAmountPaise,
      shippingRefundPaise,
      courierDeductionPaise: 0,
      status: 'pending',
      requestStatus: 'processing',
      providerRefundId: null,
      manualReference: null,
      refundMethod: 'razorpay_original_source',
      reason: params.reason,
      idempotencyKey: params.idempotencyKey,
      restockRequired: false,
      restockStatus: 'not_applicable',
      sellerAdjustments,
      items: itemAllocations,
    });
    if (params.internalNotes) {
      this.refundInternalNotes.set(newId, params.internalNotes);
    }

    order.paymentStatus = 'refund_pending';
    payment.status = 'refund_pending';

    return {
      refund_id: newId,
      order_id: order.id,
      provider_payment_id: payment.providerPaymentId,
      amount_paise: totalAmountPaise,
      currency: 'INR',
      already_initiated: false,
      provider_refund_id: null,
      refund_status: 'pending',
    };
  }

  async finalizeOnlineRefundState(params: {
    refundId?: string | null;
    providerRefundId?: string | null;
    providerPaymentId?: string | null;
    nextStatus: 'pending' | 'processed' | 'failed';
    amountPaise?: number | null;
    failureReason?: string | null;
    actorId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<FinalizeOnlineRefundResult> {
    const rf =
      (params.refundId ? this.refunds.get(params.refundId) : undefined) ||
      (params.providerRefundId
        ? Array.from(this.refunds.values()).find((r) => r.providerRefundId === params.providerRefundId)
        : undefined);
    if (!rf) throw new Error('Refund record not found.');

    const order = this.orders.get(rf.orderId)!;
    const payment = this.payments.get(rf.paymentId!)!;

    if (rf.status === 'processed') {
      return {
        refund_id: rf.id,
        order_id: rf.orderId,
        refund_status: 'processed',
        order_payment_status: order.paymentStatus,
        already_processed: true,
        ignored_out_of_order: params.nextStatus !== 'processed',
      };
    }

    if (params.providerRefundId && !rf.providerRefundId) {
      rf.providerRefundId = params.providerRefundId;
    }

    if (params.nextStatus === 'pending') {
      return {
        refund_id: rf.id,
        order_id: rf.orderId,
        refund_status: 'pending',
        order_payment_status: order.paymentStatus,
        already_processed: false,
        ignored_out_of_order: false,
      };
    }

    if (params.nextStatus === 'failed') {
      rf.status = 'failed';
      rf.requestStatus = 'failed';
      payment.status = payment.refundedPaise > 0 ? 'partially_refunded' : 'captured';
      order.paymentStatus = payment.status === 'captured' ? 'paid' : payment.status;
      return {
        refund_id: rf.id,
        order_id: rf.orderId,
        refund_status: 'failed',
        order_payment_status: order.paymentStatus,
        already_processed: false,
        ignored_out_of_order: false,
      };
    }

    // Apply financial reversal + append-only ledger exact-once
    rf.status = 'processed';
    rf.requestStatus = 'completed';
    if (order.orderStatus === 'dispatched' || order.orderStatus === 'delivered') {
      rf.restockRequired = true;
      rf.restockStatus = 'pending_inspection';
    }

    payment.refundedPaise += rf.amountPaise;
    payment.status =
      payment.refundedPaise >= payment.capturedPaise ? 'refunded' : 'partially_refunded';
    order.paymentStatus = payment.status;
    if (payment.status === 'refunded') {
      order.orderStatus = 'cancelled';
    }

    this.ledgerEntries.push({
      orderId: rf.orderId,
      refundId: rf.id,
      entryType: 'gateway_refund',
      direction: 'debit',
      amountPaise: rf.amountPaise,
      referenceId: rf.providerRefundId,
    });

    for (const adj of rf.sellerAdjustments) {
      if (adj.applied) continue;
      adj.applied = true;
      const so = this.sellerOrders.get(adj.sellerOrderId)!;
      so.refundPaise += adj.grossRefundPaise;
      so.outstandingBalancePaise = Math.max(0, so.outstandingBalancePaise - adj.sellerPayableReversedPaise);

      this.ledgerEntries.push(
        {
          orderId: rf.orderId,
          sellerOrderId: adj.sellerOrderId,
          refundId: rf.id,
          entryType: 'commission_reversal',
          direction: 'debit',
          amountPaise: adj.commissionReversedPaise,
          referenceId: rf.providerRefundId,
        },
        {
          orderId: rf.orderId,
          sellerOrderId: adj.sellerOrderId,
          refundId: rf.id,
          entryType: 'seller_payable_reversal',
          direction: 'debit',
          amountPaise: adj.sellerPayableReversedPaise,
          referenceId: rf.providerRefundId,
        }
      );
    }

    for (const itemAlloc of rf.items) {
      const oi = this.orderItems.get(itemAlloc.orderItemId)!;
      oi.refundedQuantity += itemAlloc.quantity;
      oi.refundedPaise += itemAlloc.lineAmountPaise;
    }

    return {
      refund_id: rf.id,
      order_id: rf.orderId,
      refund_status: 'processed',
      order_payment_status: order.paymentStatus,
      already_processed: false,
      ignored_out_of_order: false,
    };
  }

  async getRefundRecordById(refundId: string) {
    const r = this.refunds.get(refundId);
    if (!r) return null;
    return {
      id: r.id,
      order_id: r.orderId,
      payment_id: r.paymentId,
      amount_paise: r.amountPaise,
      status: r.status,
      provider_refund_id: r.providerRefundId,
    };
  }

  async getRefundRecordByProviderRefundId(providerRefundId: string) {
    const r = Array.from(this.refunds.values()).find(
      (item) => item.providerRefundId === providerRefundId
    );
    if (!r) return null;
    return {
      id: r.id,
      order_id: r.orderId,
      payment_id: r.paymentId,
      amount_paise: r.amountPaise,
      status: r.status,
      provider_refund_id: r.providerRefundId,
    };
  }

  async beginWebhookEvent(params: {
    eventId: string;
    eventType: string;
    providerOrderId?: string | null;
    providerPaymentId?: string | null;
    signatureValid: boolean;
    safePayload: Record<string, unknown>;
  }) {
    const existing = this.webhooks.get(params.eventId);
    if (existing) {
      return { deduplicated: true, existingStatus: existing.status };
    }
    this.webhooks.set(params.eventId, { status: 'processing' });
    return { deduplicated: false };
  }

  async completeWebhookEvent(params: {
    eventId: string;
    status: 'processed' | 'ignored' | 'failed';
    errorMessage?: string | null;
  }) {
    this.webhooks.set(params.eventId, {
      status: params.status,
      errorMessage: params.errorMessage ?? null,
    });
  }

  // SQL RPC equivalents for COD, Returns Restock, and Cancellation
  cancelCodSellerOrderWithAccounting(params: {
    actorId: string;
    sellerOrderId: string;
    stage: Exclude<CodCancellationStage, 'manual_refund_after_collection'>;
    reason: string;
    courierDeductionPaise?: number;
  }) {
    this.assertAdmin(params.actorId);
    const so = this.sellerOrders.get(params.sellerOrderId);
    if (!so) throw new Error('Seller order not found.');
    const order = this.orders.get(so.orderId)!;
    if (order.paymentMethod !== 'cod') throw new Error('COD orders only.');
    const cod = this.codRecords.get(so.id)!;

    if (cod.collectedAmountPaise > 0) {
      throw new Error('Cash already collected on this COD order; record a manual COD refund instead.');
    }

    const isPreDispatch = ['new', 'confirmed', 'processing', 'ready_for_dispatch'].includes(
      so.fulfilmentStatus
    );

    if (so.fulfilmentStatus === 'cancelled') {
      return { idempotent: true };
    }

    so.fulfilmentStatus = 'cancelled';
    so.codReconciliationStatus = 'cancelled';
    so.outstandingBalancePaise = 0;
    cod.collectionStatus = params.stage === 'failed_delivery_rto' ? 'failed_delivery' : 'cancelled';
    cod.reconciliationStatus = 'cancelled';
    cod.cancellationStage = params.stage;
    cod.courierDeductionPaise = params.courierDeductionPaise ?? 0;

    // Only pre-dispatch cancellations auto-restore inventory exact-once;
    // shipped/dispatched/delivered/RTO items wait for explicit inspection restock.
    if (params.stage === 'before_collection' && isPreDispatch && !so.inventoryRestored) {
      so.inventoryRestored = true;
      for (const item of this.orderItems.values()) {
        if (item.sellerOrderId === so.id) {
          this.productStock.set(
            item.productId,
            (this.productStock.get(item.productId) || 0) + item.quantity
          );
          item.restockedQuantity = item.quantity;
        }
      }
    }

    this.ledgerEntries.push(
      {
        orderId: order.id,
        sellerOrderId: so.id,
        entryType: 'commission_reversal',
        direction: 'debit',
        amountPaise: so.commissionAmountPaise,
      },
      {
        orderId: order.id,
        sellerOrderId: so.id,
        entryType: 'seller_payable_reversal',
        direction: 'debit',
        amountPaise: so.sellerPayablePaise,
      }
    );
    if ((params.courierDeductionPaise ?? 0) > 0) {
      this.ledgerEntries.push({
        orderId: order.id,
        sellerOrderId: so.id,
        entryType: 'courier_adjustment',
        direction: 'debit',
        amountPaise: params.courierDeductionPaise!,
      });
    }

    return { idempotent: false };
  }

  recordManualCodRefund(params: {
    actorId: string;
    orderId: string;
    sellerOrderId: string;
    amountPaise: number;
    refundMethod: string;
    manualReference: string;
    reason: string;
    idempotencyKey: string;
    courierDeductionPaise?: number;
  }): string {
    this.assertAdmin(params.actorId);
    const existing = Array.from(this.refunds.values()).find(
      (r) => r.idempotencyKey === params.idempotencyKey
    );
    if (existing) return existing.id;

    const order = this.orders.get(params.orderId);
    const so = this.sellerOrders.get(params.sellerOrderId);
    const cod = this.codRecords.get(params.sellerOrderId);
    if (!order || !so || !cod || order.paymentMethod !== 'cod') {
      throw new Error('COD order not found.');
    }
    if (cod.collectedAmountPaise <= 0) {
      throw new Error('Cannot record COD refund before cash has been collected.');
    }
    if (cod.refundedAmountPaise + params.amountPaise > cod.collectedAmountPaise) {
      throw new Error('COD refund exceeds collected cash amount.');
    }

    const rev = calculateProportionalRefundReversalPaise({
      sellerSubtotalPaise: so.subtotalPaise,
      historicalCommissionPaise: so.commissionAmountPaise,
      historicalSellerPayablePaise: so.sellerPayablePaise,
      grossRefundPaise: Math.min(params.amountPaise, so.subtotalPaise - so.refundPaise),
      alreadyRefundedPaise: so.refundPaise,
      alreadyCommissionReversedPaise: this.alreadyCommissionReversed(so.id),
      alreadySellerPayableReversedPaise: this.alreadyPayableReversed(so.id),
    });

    const rfndId = `rfnd-cod-${this.seq++}`;
    this.refunds.set(rfndId, {
      id: rfndId,
      orderId: order.id,
      paymentId: null,
      sellerOrderId: so.id,
      refundChannel: 'cod_manual',
      refundType: 'cod_manual',
      amountPaise: params.amountPaise,
      shippingRefundPaise: 0,
      courierDeductionPaise: params.courierDeductionPaise ?? 0,
      status: 'processed',
      requestStatus: 'completed',
      providerRefundId: null,
      manualReference: params.manualReference,
      refundMethod: params.refundMethod,
      reason: params.reason,
      idempotencyKey: params.idempotencyKey,
      restockRequired: true,
      restockStatus: 'pending_inspection',
      sellerAdjustments: [
        {
          sellerOrderId: so.id,
          grossRefundPaise: rev.grossRefundPaise,
          commissionReversedPaise: rev.commissionReversedPaise,
          sellerPayableReversedPaise: rev.sellerPayableReversedPaise,
          applied: true,
        },
      ],
      items: [],
    });

    cod.refundedAmountPaise += params.amountPaise;
    cod.courierDeductionPaise += params.courierDeductionPaise ?? 0;
    so.refundPaise += rev.grossRefundPaise;
    so.outstandingBalancePaise = Math.max(0, so.outstandingBalancePaise - rev.sellerPayableReversedPaise);
    order.paymentStatus =
      cod.refundedAmountPaise >= cod.collectedAmountPaise ? 'refunded' : 'partially_refunded';

    this.ledgerEntries.push(
      {
        orderId: order.id,
        sellerOrderId: so.id,
        refundId: rfndId,
        entryType: 'cod_refund',
        direction: 'debit',
        amountPaise: params.amountPaise,
        referenceId: params.manualReference,
      },
      {
        orderId: order.id,
        sellerOrderId: so.id,
        refundId: rfndId,
        entryType: 'commission_reversal',
        direction: 'debit',
        amountPaise: rev.commissionReversedPaise,
        referenceId: params.manualReference,
      },
      {
        orderId: order.id,
        sellerOrderId: so.id,
        refundId: rfndId,
        entryType: 'seller_payable_reversal',
        direction: 'debit',
        amountPaise: rev.sellerPayableReversedPaise,
        referenceId: params.manualReference,
      }
    );

    if ((params.courierDeductionPaise ?? 0) > 0) {
      this.ledgerEntries.push({
        orderId: order.id,
        sellerOrderId: so.id,
        refundId: rfndId,
        entryType: 'courier_adjustment',
        direction: 'debit',
        amountPaise: params.courierDeductionPaise!,
        referenceId: params.manualReference,
      });
    }

    return rfndId;
  }

  approveReturnedItemRestock(params: {
    actorId: string;
    refundId: string;
    decision: 'restocked' | 'rejected_damaged';
  }): number {
    this.assertAdmin(params.actorId);
    const rf = this.refunds.get(params.refundId);
    if (!rf) throw new Error('Refund record not found.');
    if (rf.restockStatus === 'restocked' || rf.restockStatus === 'rejected_damaged') {
      return 0; // Exact-once guard
    }

    rf.restockStatus = params.decision;
    if (params.decision === 'rejected_damaged') {
      return 0;
    }

    let unitsRestocked = 0;
    const targetItems =
      rf.items.length > 0
        ? rf.items.map((ri) => ({ oi: this.orderItems.get(ri.orderItemId)!, qty: ri.quantity }))
        : Array.from(this.orderItems.values())
            .filter(
              (oi) =>
                oi.orderId === rf.orderId &&
                (!rf.sellerOrderId || oi.sellerOrderId === rf.sellerOrderId)
            )
            .map((oi) => ({ oi, qty: oi.quantity }));

    for (const entry of targetItems) {
      const remaining = Math.max(0, entry.oi.quantity - entry.oi.restockedQuantity);
      const delta = Math.min(entry.qty, remaining);
      if (delta > 0) {
        entry.oi.restockedQuantity += delta;
        this.productStock.set(
          entry.oi.productId,
          (this.productStock.get(entry.oi.productId) || 0) + delta
        );
        unitsRestocked += delta;
      }
    }
    return unitsRestocked;
  }
}

class MockRazorpayRefundClient implements RazorpayRefundApiClient {
  public createCalls: Array<{ paymentId: string; amountPaise: number; notes?: Record<string, string> }> = [];
  public fetchCalls: string[] = [];
  public nextCreateBehavior:
    | 'processed'
    | 'pending'
    | 'timeout'
    | 'client_4xx'
    | 'failed_entity' = 'pending';
  public refunds = new Map<string, RazorpayRefundEntity>();
  private seq = 1;

  async createOrder(): Promise<RazorpayOrderEntity> {
    throw new Error('Unused in refund tests');
  }
  async fetchPayment(): Promise<RazorpayPaymentEntity> {
    throw new Error('Unused in refund tests');
  }
  async fetchOrderPayments(): Promise<RazorpayPaymentEntity[]> {
    return [];
  }

  async createRefund(
    paymentId: string,
    params: { amountPaise: number; speed?: 'normal' | 'optimum'; receipt?: string; notes?: Record<string, string> }
  ): Promise<RazorpayRefundEntity> {
    this.createCalls.push({ paymentId, amountPaise: params.amountPaise, notes: params.notes });
    if (this.nextCreateBehavior === 'timeout') {
      throw new Error('Razorpay refund request timed out after 10s');
    }
    if (this.nextCreateBehavior === 'client_4xx') {
      throw new RazorpayApiError('Refund amount invalid or already refunded', 400, 'BAD_REQUEST_ERROR');
    }

    const id = `rfnd_rp_${this.seq++}`;
    const entity: RazorpayRefundEntity = {
      id,
      entity: 'refund',
      amount: params.amountPaise,
      currency: 'INR',
      payment_id: paymentId,
      receipt: params.receipt ?? null,
      status:
        this.nextCreateBehavior === 'processed'
          ? 'processed'
          : this.nextCreateBehavior === 'failed_entity'
            ? 'failed'
            : 'pending',
      error_description: this.nextCreateBehavior === 'failed_entity' ? 'Bank rejected refund' : null,
      notes: params.notes,
    };
    this.refunds.set(id, entity);
    return entity;
  }

  async fetchRefund(refundId: string): Promise<RazorpayRefundEntity> {
    this.fetchCalls.push(refundId);
    const existing = this.refunds.get(refundId);
    if (!existing) throw new RazorpayApiError('Refund not found', 404, 'BAD_REQUEST_ERROR');
    return existing;
  }
}

async function signWebhookBody(rawBody: string): Promise<string> {
  return hmacSha256Hex(WEBHOOK_SECRET, rawBody);
}

test('Case 1: Full online refund via Razorpay + refund.processed webhook updates status & ledger', async () => {
  const repo = new InMemoryRefundMarketplaceHarness();
  repo.seedOnlineOrder({ orderId: 'ord-1' }); // 2 * 150000 = 300000 paise (INR 3000)
  const rpClient = new MockRazorpayRefundClient();
  rpClient.nextCreateBehavior = 'pending';

  const res = await handleCreateRazorpayRefund(
    new Request('http://localhost/functions/v1/razorpay-create-refund', {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-ops-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: 'ord-1',
        reason: 'Customer requested cancellation before dispatch',
        idempotencyKey: 'full-refund-ord-1',
      }),
    }),
    { repo, razorpayClient: rpClient, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );

  assert.equal(res.status, 200);
  const created = await res.json();
  assert.equal(created.amountPaise, 300000);
  assert.equal(created.status, 'pending');
  assert.equal(rpClient.createCalls.length, 1);

  // Gateway later processes the refund asynchronously -> webhook fires refund.processed
  const rpEntity = rpClient.refunds.get(created.providerRefundId)!;
  rpEntity.status = 'processed';
  const rawBody = JSON.stringify({
    event: 'refund.processed',
    payload: { refund: { entity: rpEntity } },
  });

  const whRes = await handleRazorpayRefundWebhook(
    new Request('http://localhost/functions/v1/razorpay-refund-webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': await signWebhookBody(rawBody),
        'x-razorpay-event-id': 'evt_full_1',
      },
      body: rawBody,
    }),
    { repo, razorpayClient: rpClient, env: { razorpayWebhookSecret: WEBHOOK_SECRET } }
  );

  assert.equal(whRes.status, 200);
  const whJson = await whRes.json();
  assert.equal(whJson.refundStatus, 'processed');
  assert.equal(whJson.orderPaymentStatus, 'refunded');
  assert.equal(repo.orders.get('ord-1')?.orderStatus, 'cancelled');
  assert.equal(repo.ledgerEntries.length, 3); // gateway_refund, commission_reversal, seller_payable_reversal
});

test('Case 2: Partial online item refund marks order partially_refunded & preserves remaining balance', async () => {
  const repo = new InMemoryRefundMarketplaceHarness();
  repo.seedOnlineOrder({ orderId: 'ord-2' }); // 2 items @ 150000 = 300000 paise
  const rpClient = new MockRazorpayRefundClient();
  rpClient.nextCreateBehavior = 'processed';

  const res = await handleCreateRazorpayRefund(
    new Request('http://localhost/functions/v1/razorpay-create-refund', {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-super-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: 'ord-2',
        items: [{ order_item_id: 'ord-2-item-1', quantity: 1 }],
        reason: 'Partial 1 of 2 items returned',
        idempotencyKey: 'partial-refund-ord-2',
      }),
    }),
    { repo, razorpayClient: rpClient, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.amountPaise, 150000);
  assert.equal(body.status, 'processed');
  assert.equal(body.orderPaymentStatus, 'partially_refunded');
  assert.equal(repo.payments.get('pay-ord-2')?.refundedPaise, 150000);
  assert.equal(repo.orderItems.get('ord-2-item-1')?.refundedQuantity, 1);
});

test('Case 3: Duplicate refund request with same idempotencyKey never double-calls Razorpay or double-posts ledger', async () => {
  const repo = new InMemoryRefundMarketplaceHarness();
  repo.seedOnlineOrder({ orderId: 'ord-3' });
  const rpClient = new MockRazorpayRefundClient();
  rpClient.nextCreateBehavior = 'processed';

  const makeReq = () =>
    new Request('http://localhost/functions/v1/razorpay-create-refund', {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-ops-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: 'ord-3',
        amountPaise: 100000,
        reason: 'Partial goodwill refund',
        idempotencyKey: 'idem-same-key-ord-3',
      }),
    });

  const first = await handleCreateRazorpayRefund(makeReq(), {
    repo,
    razorpayClient: rpClient,
    env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET },
  });
  const second = await handleCreateRazorpayRefund(makeReq(), {
    repo,
    razorpayClient: rpClient,
    env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET },
  });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const secondJson = await second.json();
  assert.equal(secondJson.idempotentReplay, true);
  assert.equal(rpClient.createCalls.length, 1);
  assert.equal(repo.ledgerEntries.length, 3);
});

test('Case 4: Refund exceeding captured payment amount is rejected safely', async () => {
  const repo = new InMemoryRefundMarketplaceHarness();
  repo.seedOnlineOrder({ orderId: 'ord-4' }); // 300000 paise
  const rpClient = new MockRazorpayRefundClient();

  const res = await handleCreateRazorpayRefund(
    new Request('http://localhost/functions/v1/razorpay-create-refund', {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-ops-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: 'ord-4',
        amountPaise: 300001,
        reason: 'Over-refund test',
        idempotencyKey: 'over-refund-ord-4',
      }),
    }),
    { repo, razorpayClient: rpClient, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );

  assert.equal(res.status, 400);
  assert.equal(rpClient.createCalls.length, 0);
});

test('Case 5: Refund attempted for uncaptured / failed payment is rejected', async () => {
  const repo = new InMemoryRefundMarketplaceHarness();
  repo.seedOnlineOrder({ orderId: 'ord-5', captured: false });
  const rpClient = new MockRazorpayRefundClient();

  const res = await handleCreateRazorpayRefund(
    new Request('http://localhost/functions/v1/razorpay-create-refund', {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-ops-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: 'ord-5',
        reason: 'Attempt refund on failed payment',
        idempotencyKey: 'failed-payment-ord-5',
      }),
    }),
    { repo, razorpayClient: rpClient, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );

  assert.equal(res.status, 400);
  assert.equal(rpClient.createCalls.length, 0);
});

test('Case 6: Razorpay API timeout leaves refund recoverable in pending state and reconciles via webhook note correlation', async () => {
  const repo = new InMemoryRefundMarketplaceHarness();
  repo.seedOnlineOrder({ orderId: 'ord-6' });
  const rpClient = new MockRazorpayRefundClient();
  rpClient.nextCreateBehavior = 'timeout';

  const res = await handleCreateRazorpayRefund(
    new Request('http://localhost/functions/v1/razorpay-create-refund', {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-ops-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: 'ord-6',
        reason: 'Timeout recovery test',
        idempotencyKey: 'timeout-ord-6',
      }),
    }),
    { repo, razorpayClient: rpClient, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );

  assert.equal(res.status, 504);
  const body = await res.json();
  assert.equal(body.status, 'pending');
  assert.equal(body.recoverable, true);
  assert.equal(repo.ledgerEntries.length, 0); // No premature reversal posted

  // Suppose Razorpay actually accepted it and fires webhook with notes.nohaj_refund_id
  const rpLateEntity: RazorpayRefundEntity = {
    id: 'rfnd_rp_late_recovery',
    amount: 300000,
    currency: 'INR',
    payment_id: 'pay_rp_ord-6',
    status: 'processed',
    notes: { nohaj_refund_id: body.refundId },
  };
  rpClient.refunds.set(rpLateEntity.id, rpLateEntity);
  const rawBody = JSON.stringify({
    event: 'refund.processed',
    payload: { refund: { entity: rpLateEntity } },
  });

  const whRes = await handleRazorpayRefundWebhook(
    new Request('http://localhost/functions/v1/razorpay-refund-webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': await signWebhookBody(rawBody),
        'x-razorpay-event-id': 'evt_timeout_recovery',
      },
      body: rawBody,
    }),
    { repo, razorpayClient: rpClient, env: { razorpayWebhookSecret: WEBHOOK_SECRET } }
  );

  assert.equal(whRes.status, 200);
  const whJson = await whRes.json();
  assert.equal(whJson.refundStatus, 'processed');
  assert.equal(repo.ledgerEntries.length, 3);
});

test('Case 7: Failed refund retry succeeds cleanly when admin retries', async () => {
  const repo = new InMemoryRefundMarketplaceHarness();
  repo.seedOnlineOrder({ orderId: 'ord-7' });
  const rpClient = new MockRazorpayRefundClient();
  rpClient.nextCreateBehavior = 'client_4xx';

  const failedRes = await handleCreateRazorpayRefund(
    new Request('http://localhost/functions/v1/razorpay-create-refund', {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-ops-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: 'ord-7',
        reason: 'First attempt fails at gateway',
        idempotencyKey: 'retry-fail-ord-7-1',
      }),
    }),
    { repo, razorpayClient: rpClient, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );

  assert.equal(failedRes.status, 400);
  const failedBody = await failedRes.json();
  assert.equal(failedBody.status, 'failed');

  // Admin retries same refundId after resolving gateway condition
  rpClient.nextCreateBehavior = 'processed';
  const retryRes = await handleCreateRazorpayRefund(
    new Request('http://localhost/functions/v1/razorpay-create-refund', {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-ops-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: 'ord-7',
        refundId: failedBody.refundId,
        reason: 'Admin retry',
        idempotencyKey: 'retry-fail-ord-7-2',
      }),
    }),
    { repo, razorpayClient: rpClient, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );

  assert.equal(retryRes.status, 200);
  const retryBody = await retryRes.json();
  assert.equal(retryBody.status, 'processed');
  assert.equal(repo.ledgerEntries.length, 3);
});

test('Case 8: Duplicate refund webhook event is deduplicated exact-once with zero duplicate ledger entries', async () => {
  const repo = new InMemoryRefundMarketplaceHarness();
  repo.seedOnlineOrder({ orderId: 'ord-8' });
  const rpClient = new MockRazorpayRefundClient();
  rpClient.nextCreateBehavior = 'pending';

  const createRes = await handleCreateRazorpayRefund(
    new Request('http://localhost/functions/v1/razorpay-create-refund', {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-ops-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: 'ord-8',
        reason: 'Webhook dedupe test',
        idempotencyKey: 'dedupe-wh-ord-8',
      }),
    }),
    { repo, razorpayClient: rpClient, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  const { providerRefundId } = await createRes.json();
  const rpEntity = rpClient.refunds.get(providerRefundId)!;
  rpEntity.status = 'processed';

  const rawBody = JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: rpEntity } } });
  const sig = await signWebhookBody(rawBody);
  const sendWebhook = () =>
    handleRazorpayRefundWebhook(
      new Request('http://localhost/functions/v1/razorpay-refund-webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': sig,
          'x-razorpay-event-id': 'evt_dup_8',
        },
        body: rawBody,
      }),
      { repo, razorpayClient: rpClient, env: { razorpayWebhookSecret: WEBHOOK_SECRET } }
    );

  const wh1 = await sendWebhook();
  const wh2 = await sendWebhook();

  assert.equal(wh1.status, 200);
  assert.equal(wh2.status, 200);
  assert.equal((await wh2.json()).deduplicated, true);
  assert.equal(repo.ledgerEntries.length, 3);
});

test('Case 9: Invalid refund webhook signature returns 401 and ignores payload safely', async () => {
  const repo = new InMemoryRefundMarketplaceHarness();
  repo.seedOnlineOrder({ orderId: 'ord-9' });
  const rpClient = new MockRazorpayRefundClient();

  const rawBody = JSON.stringify({
    event: 'refund.processed',
    payload: { refund: { entity: { id: 'rfnd_forged', amount: 300000, status: 'processed' } } },
  });

  const whRes = await handleRazorpayRefundWebhook(
    new Request('http://localhost/functions/v1/razorpay-refund-webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': 'deadbeef0000forgedsignature',
        'x-razorpay-event-id': 'evt_forged_9',
      },
      body: rawBody,
    }),
    { repo, razorpayClient: rpClient, env: { razorpayWebhookSecret: WEBHOOK_SECRET } }
  );

  assert.equal(whRes.status, 401);
  assert.equal(repo.ledgerEntries.length, 0);
});

test('Case 10: Multi-vendor partial refund isolates seller reversals and prevents overlapping over-refund', async () => {
  const repo = new InMemoryRefundMarketplaceHarness();
  repo.seedOnlineOrder({
    orderId: 'ord-10',
    sellers: [
      {
        id: 'so-a',
        sellerId: 'seller-a',
        items: [{ id: 'it-a', productId: 'prod-a', qty: 1, unitPricePaise: 200000 }],
      },
      {
        id: 'so-b',
        sellerId: 'seller-b',
        items: [{ id: 'it-b', productId: 'prod-b', qty: 1, unitPricePaise: 100000 }],
      },
    ],
  });
  const rpClient = new MockRazorpayRefundClient();
  rpClient.nextCreateBehavior = 'processed';

  // Refund Seller A in full (200,000 paise)
  const resA = await handleCreateRazorpayRefund(
    new Request('http://localhost/functions/v1/razorpay-create-refund', {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-ops-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: 'ord-10',
        sellerOrderId: 'so-a',
        reason: 'Seller A out of stock',
        idempotencyKey: 'mv-refund-a',
      }),
    }),
    { repo, razorpayClient: rpClient, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  assert.equal(resA.status, 200);
  assert.equal(repo.sellerOrders.get('so-a')?.outstandingBalancePaise, 0);
  assert.equal(repo.sellerOrders.get('so-b')?.outstandingBalancePaise, 88000); // Untouched!

  // Second overlapping refund for Seller A must be blocked
  const resOverlap = await handleCreateRazorpayRefund(
    new Request('http://localhost/functions/v1/razorpay-create-refund', {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-ops-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: 'ord-10',
        sellerOrderId: 'so-a',
        amountPaise: 10000,
        reason: 'Duplicate overlap on Seller A',
        idempotencyKey: 'mv-refund-a-overlap',
      }),
    }),
    { repo, razorpayClient: rpClient, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  assert.equal(resOverlap.status, 400);
});

test('Case 11: Proportional 12% commission reversal uses historical snapshot & sums cleanly across partial refunds', () => {
  // Subtotal = 300,003 paise (odd number to test rounding stability), historical 12% = 36,000, payable = 264,003
  const step1 = calculateProportionalRefundReversalPaise({
    sellerSubtotalPaise: 300003,
    historicalCommissionPaise: 36000,
    historicalSellerPayablePaise: 264003,
    grossRefundPaise: 100001,
  });
  const step2 = calculateProportionalRefundReversalPaise({
    sellerSubtotalPaise: 300003,
    historicalCommissionPaise: 36000,
    historicalSellerPayablePaise: 264003,
    grossRefundPaise: 200002,
    alreadyRefundedPaise: step1.grossRefundPaise,
    alreadyCommissionReversedPaise: step1.commissionReversedPaise,
    alreadySellerPayableReversedPaise: step1.sellerPayableReversedPaise,
  });

  assert.equal(step1.commissionReversedPaise + step2.commissionReversedPaise, 36000);
  assert.equal(step1.sellerPayableReversedPaise + step2.sellerPayableReversedPaise, 264003);
  assert.equal(step1.commissionReversedPaise + step1.sellerPayableReversedPaise, step1.grossRefundPaise);
});

test('Case 12: COD cancellation before collection restores inventory, posts 0 cash refund, and reverses commission/payable', () => {
  const repo = new InMemoryRefundMarketplaceHarness();
  repo.productStock.set('prod-cod-1', 4);
  repo.seedCodSellerOrder({
    orderId: 'ord-cod-12',
    sellerOrderId: 'so-cod-12',
    productId: 'prod-cod-1',
    qty: 2,
    unitPricePaise: 100000,
    fulfilmentStatus: 'confirmed',
    collected: false,
  });

  const out = repo.cancelCodSellerOrderWithAccounting({
    actorId: 'adm-ops',
    sellerOrderId: 'so-cod-12',
    stage: 'before_collection',
    reason: 'Customer cancelled COD before dispatch',
  });

  assert.equal(out.idempotent, false);
  assert.equal(repo.productStock.get('prod-cod-1'), 6);
  assert.equal(repo.sellerOrders.get('so-cod-12')?.outstandingBalancePaise, 0);
  assert.equal(repo.refunds.size, 0);
  assert.equal(
    repo.ledgerEntries.some((l) => l.entryType === 'cod_refund'),
    false
  );
  assert.equal(
    repo.ledgerEntries.some((l) => l.entryType === 'commission_reversal' && l.amountPaise === 24000),
    true
  );
});

test('Case 13: COD cancellation after cash collection blocks pre-collection cancel & requires manual refund', () => {
  const repo = new InMemoryRefundMarketplaceHarness();
  repo.seedCodSellerOrder({
    orderId: 'ord-cod-13',
    sellerOrderId: 'so-cod-13',
    productId: 'prod-cod-13',
    qty: 1,
    unitPricePaise: 250000,
    fulfilmentStatus: 'delivered',
    collected: true,
  });

  assert.throws(
    () =>
      repo.cancelCodSellerOrderWithAccounting({
        actorId: 'adm-ops',
        sellerOrderId: 'so-cod-13',
        stage: 'after_dispatch',
        reason: 'Should require manual refund',
      }),
    /manual cod refund/i
  );
});

test('Case 14: Explicit manual COD refund records UTR reference, posts ledger reversals & never calls Razorpay', () => {
  const repo = new InMemoryRefundMarketplaceHarness();
  repo.seedCodSellerOrder({
    orderId: 'ord-cod-14',
    sellerOrderId: 'so-cod-14',
    productId: 'prod-cod-14',
    qty: 1,
    unitPricePaise: 200000,
    fulfilmentStatus: 'delivered',
    collected: true,
  });

  const rfndId = repo.recordManualCodRefund({
    actorId: 'adm-ops',
    orderId: 'ord-cod-14',
    sellerOrderId: 'so-cod-14',
    amountPaise: 200000,
    refundMethod: 'upi',
    manualReference: 'UTR9988776655',
    reason: 'Returned via courier after COD collection',
    idempotencyKey: 'cod-manual-14',
    courierDeductionPaise: 12000,
  });

  const rf = repo.refunds.get(rfndId)!;
  assert.equal(rf.refundChannel, 'cod_manual');
  assert.equal(rf.manualReference, 'UTR9988776655');
  assert.equal(rf.restockStatus, 'pending_inspection');
  assert.equal(repo.orders.get('ord-cod-14')?.paymentStatus, 'refunded');
  assert.equal(
    repo.ledgerEntries.some((l) => l.entryType === 'cod_refund' && l.amountPaise === 200000),
    true
  );
  assert.equal(
    repo.ledgerEntries.some((l) => l.entryType === 'courier_adjustment' && l.amountPaise === 12000),
    true
  );
});

test('Case 15: Duplicate or over-collected manual COD refund attempt is prevented', () => {
  const repo = new InMemoryRefundMarketplaceHarness();
  repo.seedCodSellerOrder({
    orderId: 'ord-cod-15',
    sellerOrderId: 'so-cod-15',
    productId: 'prod-cod-15',
    qty: 1,
    unitPricePaise: 100000,
    fulfilmentStatus: 'delivered',
    collected: true,
  });

  const id1 = repo.recordManualCodRefund({
    actorId: 'adm-ops',
    orderId: 'ord-cod-15',
    sellerOrderId: 'so-cod-15',
    amountPaise: 100000,
    refundMethod: 'bank_transfer',
    manualReference: 'NEFT1122',
    reason: 'Full COD refund',
    idempotencyKey: 'cod-dup-15',
  });
  // Idempotent replay returns same id without duplicate ledger
  const id2 = repo.recordManualCodRefund({
    actorId: 'adm-ops',
    orderId: 'ord-cod-15',
    sellerOrderId: 'so-cod-15',
    amountPaise: 100000,
    refundMethod: 'bank_transfer',
    manualReference: 'NEFT1122',
    reason: 'Full COD refund',
    idempotencyKey: 'cod-dup-15',
  });
  assert.equal(id1, id2);
  assert.equal(repo.ledgerEntries.length, 3);

  // Different idempotencyKey trying to refund more cash than collected must throw
  assert.throws(
    () =>
      repo.recordManualCodRefund({
        actorId: 'adm-ops',
        orderId: 'ord-cod-15',
        sellerOrderId: 'so-cod-15',
        amountPaise: 5000,
        refundMethod: 'upi',
        manualReference: 'UPI9999',
        reason: 'Over-refund attempt',
        idempotencyKey: 'cod-over-15',
      }),
    /exceeds collected/i
  );
});

test('Case 16: Inventory restoration happens exact-once even if cancellation is called multiple times', () => {
  const repo = new InMemoryRefundMarketplaceHarness();
  repo.productStock.set('prod-16', 2);
  repo.seedCodSellerOrder({
    orderId: 'ord-16',
    sellerOrderId: 'so-16',
    productId: 'prod-16',
    qty: 3,
    unitPricePaise: 100000,
    fulfilmentStatus: 'confirmed',
    collected: false,
  });

  repo.cancelCodSellerOrderWithAccounting({
    actorId: 'adm-ops',
    sellerOrderId: 'so-16',
    stage: 'before_collection',
    reason: 'First cancel',
  });
  repo.cancelCodSellerOrderWithAccounting({
    actorId: 'adm-ops',
    sellerOrderId: 'so-16',
    stage: 'before_collection',
    reason: 'Duplicate cancel',
  });

  assert.equal(repo.productStock.get('prod-16'), 5); // 2 + 3 once only
});

test('Case 17: Shipped / dispatched items NEVER auto-restore inventory on cancellation', () => {
  const repo = new InMemoryRefundMarketplaceHarness();
  repo.productStock.set('prod-17', 1);
  repo.seedCodSellerOrder({
    orderId: 'ord-17',
    sellerOrderId: 'so-17',
    productId: 'prod-17',
    qty: 2,
    unitPricePaise: 150000,
    fulfilmentStatus: 'dispatched',
    collected: false,
  });

  repo.cancelCodSellerOrderWithAccounting({
    actorId: 'adm-ops',
    sellerOrderId: 'so-17',
    stage: 'failed_delivery_rto',
    reason: 'Customer unreachable (RTO)',
    courierDeductionPaise: 15000,
  });

  assert.equal(repo.productStock.get('prod-17'), 1); // Did NOT auto-restore while in transit/RTO!
  assert.equal(repo.sellerOrders.get('so-17')?.inventoryRestored, false);
});

test('Case 18: Returned item restocking waits for explicit inspection approval (restocked exact-once vs rejected_damaged)', () => {
  const repo = new InMemoryRefundMarketplaceHarness();
  repo.productStock.set('prod-18', 1);
  repo.seedCodSellerOrder({
    orderId: 'ord-18',
    sellerOrderId: 'so-18',
    productId: 'prod-18',
    qty: 2,
    unitPricePaise: 120000,
    fulfilmentStatus: 'delivered',
    collected: true,
  });

  const rfId = repo.recordManualCodRefund({
    actorId: 'adm-ops',
    orderId: 'ord-18',
    sellerOrderId: 'so-18',
    amountPaise: 240000,
    refundMethod: 'upi',
    manualReference: 'UTR1818',
    reason: 'Returned textile',
    idempotencyKey: 'cod-18',
  });

  assert.equal(repo.productStock.get('prod-18'), 1); // Still 1 until inspected

  const units1 = repo.approveReturnedItemRestock({
    actorId: 'adm-ops',
    refundId: rfId,
    decision: 'restocked',
  });
  const units2 = repo.approveReturnedItemRestock({
    actorId: 'adm-ops',
    refundId: rfId,
    decision: 'restocked',
  });

  assert.equal(units1, 2);
  assert.equal(units2, 0);
  assert.equal(repo.productStock.get('prod-18'), 3);

  // Damaged return must NOT increment stock
  repo.seedCodSellerOrder({
    orderId: 'ord-18b',
    sellerOrderId: 'so-18b',
    productId: 'prod-18',
    qty: 1,
    unitPricePaise: 120000,
    fulfilmentStatus: 'delivered',
    collected: true,
  });
  const rfDmg = repo.recordManualCodRefund({
    actorId: 'adm-ops',
    orderId: 'ord-18b',
    sellerOrderId: 'so-18b',
    amountPaise: 120000,
    refundMethod: 'upi',
    manualReference: 'UTR18B',
    reason: 'Damaged in transit',
    idempotencyKey: 'cod-18b',
  });
  const dmgUnits = repo.approveReturnedItemRestock({
    actorId: 'adm-ops',
    refundId: rfDmg,
    decision: 'rejected_damaged',
  });
  assert.equal(dmgUnits, 0);
  assert.equal(repo.productStock.get('prod-18'), 3);
});

test('Case 19: Unauthorized seller or customer attempting refund initiation gets 403 Forbidden', async () => {
  const repo = new InMemoryRefundMarketplaceHarness();
  repo.seedOnlineOrder({ orderId: 'ord-19' });
  const rpClient = new MockRazorpayRefundClient();

  for (const jwt of ['jwt-seller-1', 'jwt-cust-1']) {
    const res = await handleCreateRazorpayRefund(
      new Request('http://localhost/functions/v1/razorpay-create-refund', {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: 'ord-19',
          reason: 'Unauthorized trigger attempt',
          idempotencyKey: `unauth-${jwt}`,
        }),
      }),
      { repo, razorpayClient: rpClient, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
    );
    assert.equal(res.status, 403);
  }
  assert.equal(rpClient.createCalls.length, 0);
});

test('Case 20: Content Admin strictly blocked from refund initiation, admin refunds tab, and financial tables', async () => {
  const repo = new InMemoryRefundMarketplaceHarness();
  repo.seedOnlineOrder({ orderId: 'ord-20' });
  const rpClient = new MockRazorpayRefundClient();

  assert.equal(canAccessAdminTab('content_admin', 'refunds'), false);
  assert.equal(canAccessAdminTab('operations_admin', 'refunds'), true);
  assert.equal(canAccessAdminTab('super_admin', 'refunds'), true);

  const edgeRes = await handleCreateRazorpayRefund(
    new Request('http://localhost/functions/v1/razorpay-create-refund', {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-content-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: 'ord-20',
        reason: 'Content admin unauthorized refund',
        idempotencyKey: 'content-admin-block-20',
      }),
    }),
    { repo, razorpayClient: rpClient, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  assert.equal(edgeRes.status, 403);
  assert.equal(rpClient.createCalls.length, 0);

  // Verify SQL migration 010 enforces operations_admin (never content_admin) & zero Route logic
  const mig010 = fs.readFileSync(
    path.join(repoRoot, 'supabase/migrations/010_refund_and_cancellation_accounting.sql'),
    'utf8'
  );
  assert.match(mig010, /refund_internal_notes/);
  assert.match(mig010, /is_operations_admin\(auth\.uid\(\)\)/);
  assert.match(mig010, /approve_returned_item_restock/);
  assert.match(mig010, /cancel_cod_seller_order_with_accounting/);
  assert.match(mig010, /record_manual_cod_refund/);

  // Helper sanity check for customer eligibility & status labels
  assert.equal(
    canRequestCustomerRefund({ paymentMethod: 'online', paymentStatus: 'captured', orderStatus: 'confirmed' }),
    true
  );
  assert.equal(
    canRequestCustomerRefund({ paymentMethod: 'cod', paymentStatus: 'cod_pending', orderStatus: 'confirmed' }),
    false
  );
  assert.equal(getRefundStatusLabel('pending', 'requested'), 'Requested (Pending Review)');
});
