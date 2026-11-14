/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hmacSha256Hex } from '../../supabase/functions/_shared/crypto.ts';
import type {
  AuthenticatedCustomer,
  CaptureFinalizationResult,
  CheckoutItemInput,
  ExpiredOrderCandidate,
  GatewayConfigRow,
  LateCaptureResult,
  OrderPaymentSnapshot,
  PaymentAttemptRow,
  PaymentEdgeRepository,
  PaymentStateUpdateResult,
  RazorpayApiClient,
  RazorpayOrderEntity,
  RazorpayPaymentEntity,
  RegisteredAttemptResult,
  ReservationResult,
  ShippingAddressInput,
} from '../../supabase/functions/_shared/types.ts';
import { handleCreateRazorpayOrder } from '../../supabase/functions/razorpay-create-order/handler.ts';
import { handleVerifyRazorpayPayment } from '../../supabase/functions/razorpay-verify-payment/handler.ts';
import { handleRazorpayWebhook } from '../../supabase/functions/razorpay-webhook/handler.ts';
import { handleExpireOnlineOrders } from '../../supabase/functions/razorpay-expire-orders/handler.ts';

const repoRoot = process.cwd();
const KEY_ID = 'rzp_test_U087Ttl5tHUUQq';
const KEY_SECRET = 'mock_razorpay_key_secret_for_tests_only';
const WEBHOOK_SECRET = 'mock_razorpay_webhook_secret_for_tests_only';
const CRON_SECRET = 'mock_cron_secret_for_tests_only';
const SERVICE_ROLE_KEY = 'mock_service_role_key_for_tests_only';

interface MockProduct {
  id: string;
  name: string;
  sellerId: string;
  sellerActive: boolean;
  approved: boolean;
  published: boolean;
  pricePaise: number;
  stock: number;
  variants?: Record<string, { stock: number; priceOverridePaise?: number }>;
}

interface MockOrderRecord extends OrderPaymentSnapshot {
  shippingAddress: ShippingAddressInput;
  subtotalPaise: number;
  shippingPaise: number;
  idempotencyKey: string;
  createdAtMs: number;
  sellerOrders: Array<{
    id: string;
    sellerId: string;
    subtotalPaise: number;
    commissionPaise: number;
    sellerPayablePaise: number;
    fulfilmentStatus: string;
  }>;
  items: Array<{
    productId: string;
    variantId: string | null;
    quantity: number;
    unitPricePaise: number;
    inventoryRestored: boolean;
  }>;
}

class InMemoryPaymentHarness implements PaymentEdgeRepository {
  public gatewayConfig: GatewayConfigRow = {
    active_provider: 'razorpay',
    online_payments_enabled: true,
    razorpay_mode: 'test',
    razorpay_route_enabled: false,
  };

  public users: Record<string, AuthenticatedCustomer> = {
    'jwt-cust-a': { id: 'cust-a', email: 'ananya@example.com' },
    'jwt-cust-b': { id: 'cust-b', email: 'bhaskar@example.com' },
  };

  public products: Record<string, MockProduct> = {
    'prod-1': {
      id: 'prod-1',
      name: 'Muga Silk Mekhela Sador',
      sellerId: 'seller-1',
      sellerActive: true,
      approved: true,
      published: true,
      pricePaise: 320000, // INR 3,200
      stock: 5,
    },
    'prod-2': {
      id: 'prod-2',
      name: 'Bodo Handwoven Dokhona',
      sellerId: 'seller-2',
      sellerActive: true,
      approved: true,
      published: true,
      pricePaise: 240000, // INR 2,400
      stock: 3,
      variants: {
        'var-red': { stock: 2, priceOverridePaise: 250000 }, // INR 2,500
      },
    },
    'prod-unapproved': {
      id: 'prod-unapproved',
      name: 'Unpublished Draft Piece',
      sellerId: 'seller-1',
      sellerActive: true,
      approved: false,
      published: false,
      pricePaise: 150000,
      stock: 5,
    },
    'prod-suspended': {
      id: 'prod-suspended',
      name: 'Suspended Seller Piece',
      sellerId: 'seller-suspended',
      sellerActive: false,
      approved: true,
      published: true,
      pricePaise: 150000,
      stock: 5,
    },
  };

  public orders = new Map<string, MockOrderRecord>();
  public payments = new Map<
    string,
    {
      id: string;
      orderId: string;
      customerId: string;
      providerOrderId: string | null;
      providerPaymentId: string | null;
      amountPaise: number;
      capturedPaise: number;
      status: string;
      signatureVerified: boolean;
      apiVerified: boolean;
    }
  >();
  public attempts = new Map<string, PaymentAttemptRow>();
  public webhooks = new Map<string, { status: string; receivedAtMs: number; error?: string | null }>();
  public ledgerEntries: Array<{
    orderId: string;
    sellerOrderId?: string;
    sellerId?: string;
    entryType: string;
    direction: 'debit' | 'credit';
    amountPaise: number;
  }> = [];

  public forceBeginWebhookError = false;
  public forceFinalizeTransientError = false;
  private orderSeq = 1;
  private expiryInFlight = false;

  async authenticateCustomer(jwt: string): Promise<AuthenticatedCustomer | null> {
    return this.users[jwt] || null;
  }

  async getGatewayConfig(): Promise<GatewayConfigRow> {
    return { ...this.gatewayConfig };
  }

  async reserveOnlineOrderInventory(params: {
    customerId: string;
    shippingAddress: ShippingAddressInput;
    items: CheckoutItemInput[];
    idempotencyKey: string;
  }): Promise<ReservationResult> {
    for (const existing of this.orders.values()) {
      if (
        existing.customer_id === params.customerId &&
        existing.idempotencyKey === params.idempotencyKey
      ) {
        if (existing.order_status === 'expired' || existing.order_status === 'cancelled') {
          throw new Error('This checkout reservation has expired or been cancelled.');
        }
        return {
          order_id: existing.id,
          order_number: existing.order_number,
          total_paise: existing.total_paise,
          currency: 'INR',
          reservation_expires_at: existing.reservation_expires_at!,
          reused_existing: true,
        };
      }
    }

    const lines: MockOrderRecord['items'] = [];
    const sellerSubtotals = new Map<string, number>();

    for (const item of params.items) {
      const prod = this.products[item.product_id];
      if (!prod || !prod.approved || !prod.published) {
        throw new Error('Product is not approved or published.');
      }
      if (!prod.sellerActive) {
        throw new Error(`Seller for ${prod.name} is currently unavailable.`);
      }

      let unitPricePaise = prod.pricePaise;
      if (prod.variants) {
        if (!item.variant_id || !prod.variants[item.variant_id]) {
          throw new Error(`Invalid variant for product ${prod.name}.`);
        }
        const v = prod.variants[item.variant_id];
        if (v.stock < item.quantity) {
          throw new Error(`Insufficient variant stock for ${prod.name}.`);
        }
        v.stock -= item.quantity;
        unitPricePaise = v.priceOverridePaise ?? prod.pricePaise;
      } else {
        if (item.variant_id) {
          throw new Error(`Invalid variant for product ${prod.name}.`);
        }
        if (prod.stock < item.quantity) {
          throw new Error(`Insufficient stock for ${prod.name}.`);
        }
        prod.stock -= item.quantity;
      }

      const lineTotal = unitPricePaise * item.quantity;
      sellerSubtotals.set(prod.sellerId, (sellerSubtotals.get(prod.sellerId) || 0) + lineTotal);
      lines.push({
        productId: prod.id,
        variantId: item.variant_id ?? null,
        quantity: item.quantity,
        unitPricePaise,
        inventoryRestored: false,
      });
    }

    const subtotalPaise = Array.from(sellerSubtotals.values()).reduce((a, b) => a + b, 0);
    const shippingPaise = subtotalPaise >= 500000 ? 0 : 25000;
    const totalPaise = subtotalPaise + shippingPaise;
    const orderId = `ord-${this.orderSeq}`;
    const orderNumber = `NHJ-10000${this.orderSeq}`;
    this.orderSeq += 1;

    const expiresAt = new Date(Date.now() + 20 * 60_000).toISOString();
    const sellerOrders = Array.from(sellerSubtotals.entries()).map(([sellerId, sSub], idx) => {
      const commissionPaise = Math.round((sSub * 1200) / 10000);
      return {
        id: `${orderId}-so-${idx + 1}`,
        sellerId,
        subtotalPaise: sSub,
        commissionPaise,
        sellerPayablePaise: sSub - commissionPaise,
        fulfilmentStatus: 'pending',
      };
    });

    this.orders.set(orderId, {
      id: orderId,
      order_number: orderNumber,
      customer_id: params.customerId,
      total_paise: totalPaise,
      currency: 'INR',
      payment_method: 'online',
      payment_status: 'created',
      order_status: 'pending_payment',
      reservation_expires_at: expiresAt,
      reservation_released_at: null,
      shippingAddress: params.shippingAddress,
      subtotalPaise,
      shippingPaise,
      idempotencyKey: params.idempotencyKey,
      createdAtMs: Date.now(),
      sellerOrders,
      items: lines,
    });

    return {
      order_id: orderId,
      order_number: orderNumber,
      total_paise: totalPaise,
      currency: 'INR',
      reservation_expires_at: expiresAt,
      reused_existing: false,
    };
  }

  async getOrderPaymentSnapshot(orderId: string): Promise<OrderPaymentSnapshot | null> {
    const o = this.orders.get(orderId);
    return o ? { ...o } : null;
  }

  async listOrderAttempts(orderId: string): Promise<PaymentAttemptRow[]> {
    return Array.from(this.attempts.values())
      .filter((a) => a.order_id === orderId)
      .sort((a, b) => b.attempt_number - a.attempt_number);
  }

  async getAttemptByProviderOrderId(providerOrderId: string): Promise<{
    order: OrderPaymentSnapshot;
    attempt: PaymentAttemptRow;
  } | null> {
    const attempt = Array.from(this.attempts.values()).find(
      (a) => a.provider_order_id === providerOrderId
    );
    if (!attempt) return null;
    const order = this.orders.get(attempt.order_id);
    if (!order) return null;
    return { order: { ...order }, attempt: { ...attempt } };
  }

  async registerPaymentAttempt(params: {
    orderId: string;
    customerId: string;
    providerOrderId: string;
    amountPaise: number;
    currency: 'INR';
    idempotencyKey: string;
    expiresAt: string;
  }): Promise<RegisteredAttemptResult> {
    let payment = this.payments.get(params.orderId);
    if (!payment) {
      payment = {
        id: `pay-${params.orderId}`,
        orderId: params.orderId,
        customerId: params.customerId,
        providerOrderId: params.providerOrderId,
        providerPaymentId: null,
        amountPaise: params.amountPaise,
        capturedPaise: 0,
        status: 'created',
        signatureVerified: false,
        apiVerified: false,
      };
      this.payments.set(params.orderId, payment);
    } else {
      payment.providerOrderId = params.providerOrderId;
      if (payment.status !== 'captured') payment.status = 'created';
    }

    const existing = await this.listOrderAttempts(params.orderId);
    const attemptNumber = (existing[0]?.attempt_number || 0) + 1;
    const attemptId = `att-${params.orderId}-${attemptNumber}`;

    this.attempts.set(attemptId, {
      id: attemptId,
      payment_id: payment.id,
      order_id: params.orderId,
      attempt_number: attemptNumber,
      provider_order_id: params.providerOrderId,
      provider_payment_id: null,
      amount_paise: params.amountPaise,
      currency: params.currency,
      status: 'created',
      signature_verified: false,
      api_verified: false,
    });

    return { payment_id: payment.id, attempt_id: attemptId, attempt_number: attemptNumber };
  }

  async recordCreateOrderFailure(params: {
    orderId: string;
    customerId: string;
    amountPaise: number;
    idempotencyKey: string;
  }): Promise<void> {
    let payment = this.payments.get(params.orderId);
    if (!payment) {
      payment = {
        id: `pay-${params.orderId}`,
        orderId: params.orderId,
        customerId: params.customerId,
        providerOrderId: null,
        providerPaymentId: null,
        amountPaise: params.amountPaise,
        capturedPaise: 0,
        status: 'failed',
        signatureVerified: false,
        apiVerified: false,
      };
      this.payments.set(params.orderId, payment);
    }
    const existing = await this.listOrderAttempts(params.orderId);
    const attemptNumber = (existing[0]?.attempt_number || 0) + 1;
    const attemptId = `att-${params.orderId}-${attemptNumber}`;
    this.attempts.set(attemptId, {
      id: attemptId,
      payment_id: payment.id,
      order_id: params.orderId,
      attempt_number: attemptNumber,
      provider_order_id: null,
      provider_payment_id: null,
      amount_paise: params.amountPaise,
      currency: 'INR',
      status: 'failed',
      signature_verified: false,
      api_verified: false,
    });
  }

  async finalizePaymentCapture(params: {
    orderId: string;
    providerOrderId: string;
    providerPaymentId: string;
    amountPaise: number;
    currency: string;
    signatureVerified: boolean;
    apiVerified: boolean;
  }): Promise<CaptureFinalizationResult> {
    if (this.forceFinalizeTransientError) {
      throw new Error('Simulated temporary PostgreSQL connection drop');
    }
    const order = this.orders.get(params.orderId);
    if (!order) throw new Error('Order not found');
    if (order.currency !== params.currency || order.total_paise !== params.amountPaise) {
      throw new Error('Amount or currency mismatch.');
    }

    const payment = this.payments.get(order.id)!;
    if (order.payment_status === 'paid') {
      if (payment.providerPaymentId && payment.providerPaymentId !== params.providerPaymentId) {
        throw new Error('Duplicate payment conflict.');
      }
      payment.signatureVerified = payment.signatureVerified || params.signatureVerified;
      payment.apiVerified = payment.apiVerified || params.apiVerified;
      return {
        order_id: order.id,
        payment_status: order.payment_status,
        order_status: order.order_status,
        already_captured: true,
      };
    }

    if (order.reservation_released_at !== null || ['expired', 'cancelled'].includes(order.order_status)) {
      throw new Error('Cannot confirm capture on expired/released reservation.');
    }

    const attempt = Array.from(this.attempts.values()).find(
      (a) => a.order_id === order.id && a.provider_order_id === params.providerOrderId
    );
    if (!attempt) throw new Error('Matching attempt not found.');

    attempt.status = 'captured';
    attempt.provider_payment_id = params.providerPaymentId;
    attempt.signature_verified = attempt.signature_verified || params.signatureVerified;
    attempt.api_verified = attempt.api_verified || params.apiVerified;

    payment.status = 'captured';
    payment.providerOrderId = params.providerOrderId;
    payment.providerPaymentId = params.providerPaymentId;
    payment.capturedPaise = params.amountPaise;
    payment.signatureVerified = payment.signatureVerified || params.signatureVerified;
    payment.apiVerified = payment.apiVerified || params.apiVerified;

    order.payment_status = 'paid';
    order.order_status = 'confirmed';
    order.reservation_expires_at = null;

    this.postCaptureLedgerOnce(order);

    return {
      order_id: order.id,
      payment_status: order.payment_status,
      order_status: order.order_status,
      already_captured: false,
    };
  }

  private postCaptureLedgerOnce(order: MockOrderRecord): void {
    const hasCapture = this.ledgerEntries.some(
      (e) => e.orderId === order.id && e.entryType === 'payment_captured'
    );
    if (hasCapture) return;

    this.ledgerEntries.push({
      orderId: order.id,
      entryType: 'payment_captured',
      direction: 'credit',
      amountPaise: order.total_paise,
    });
    if (order.shippingPaise > 0) {
      this.ledgerEntries.push({
        orderId: order.id,
        entryType: 'shipping_allocation',
        direction: 'credit',
        amountPaise: order.shippingPaise,
      });
    }
    for (const so of order.sellerOrders) {
      this.ledgerEntries.push(
        {
          orderId: order.id,
          sellerOrderId: so.id,
          sellerId: so.sellerId,
          entryType: 'order_charge',
          direction: 'debit',
          amountPaise: so.subtotalPaise,
        },
        {
          orderId: order.id,
          sellerOrderId: so.id,
          sellerId: so.sellerId,
          entryType: 'commission_accrual',
          direction: 'credit',
          amountPaise: so.commissionPaise,
        },
        {
          orderId: order.id,
          sellerOrderId: so.id,
          sellerId: so.sellerId,
          entryType: 'seller_payable_credit',
          direction: 'credit',
          amountPaise: so.sellerPayablePaise,
        }
      );
    }
  }

  async recordPaymentState(params: {
    orderId: string;
    providerOrderId: string;
    providerPaymentId?: string | null;
    nextStatus: 'authorized' | 'failed';
    signatureVerified: boolean;
    apiVerified: boolean;
  }): Promise<PaymentStateUpdateResult> {
    const order = this.orders.get(params.orderId)!;
    const attempt = Array.from(this.attempts.values()).find(
      (a) => a.order_id === order.id && a.provider_order_id === params.providerOrderId
    )!;
    const payment = this.payments.get(order.id)!;

    if (attempt.status === 'captured' || ['paid', 'captured'].includes(order.payment_status)) {
      return {
        order_id: order.id,
        payment_status: order.payment_status,
        order_status: order.order_status,
        ignored_out_of_order: true,
      };
    }

    attempt.status = params.nextStatus;
    if (params.providerPaymentId) attempt.provider_payment_id = params.providerPaymentId;

    if (payment.providerOrderId === params.providerOrderId && payment.status !== 'captured') {
      payment.status = params.nextStatus;
      order.payment_status = params.nextStatus;
      if (params.nextStatus === 'authorized') {
        const capMs = order.createdAtMs + 45 * 60_000;
        const currentExpMs = order.reservation_expires_at ? Date.parse(order.reservation_expires_at) : Date.now();
        const extendedMs = Math.min(capMs, Math.max(currentExpMs, Date.now() + 15 * 60_000));
        order.reservation_expires_at = new Date(extendedMs).toISOString();
      }
    }

    return {
      order_id: order.id,
      payment_status: order.payment_status,
      order_status: order.order_status,
      ignored_out_of_order: false,
    };
  }

  async beginWebhookEvent(params: { eventId: string }): Promise<{
    deduplicated: boolean;
    existingStatus?: string;
  }> {
    if (this.forceBeginWebhookError) {
      throw new Error('Simulated temporary PostgreSQL failure in beginWebhookEvent');
    }
    const existing = this.webhooks.get(params.eventId);
    if (existing) {
      if (existing.status === 'processed' || existing.status === 'ignored') {
        return { deduplicated: true, existingStatus: existing.status };
      }
      if (existing.status === 'processing' && Date.now() - existing.receivedAtMs < 60_000) {
        return { deduplicated: true, existingStatus: existing.status };
      }
    }
    this.webhooks.set(params.eventId, { status: 'processing', receivedAtMs: Date.now() });
    return { deduplicated: false };
  }

  async completeWebhookEvent(params: {
    eventId: string;
    status: 'processed' | 'ignored' | 'failed';
    errorMessage?: string | null;
  }): Promise<void> {
    const prev = this.webhooks.get(params.eventId);
    this.webhooks.set(params.eventId, {
      status: params.status,
      receivedAtMs: prev?.receivedAtMs ?? Date.now(),
      error: params.errorMessage,
    });
  }

  async listExpiredPendingOrders(limit = 50): Promise<ExpiredOrderCandidate[]> {
    const nowMs = Date.now();
    const results: ExpiredOrderCandidate[] = [];
    for (const order of this.orders.values()) {
      if (
        order.payment_method === 'online' &&
        order.order_status === 'pending_payment' &&
        ['created', 'pending', 'failed', 'authorized'].includes(order.payment_status) &&
        order.reservation_released_at === null &&
        order.reservation_expires_at &&
        Date.parse(order.reservation_expires_at) <= nowMs
      ) {
        const attempts = await this.listOrderAttempts(order.id);
        results.push({ order: { ...order }, attempts });
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  async recordLateCaptureAfterExpiry(params: {
    orderId: string;
    providerOrderId: string;
    providerPaymentId: string;
    amountPaise: number;
    currency: string;
    signatureVerified: boolean;
    apiVerified: boolean;
  }): Promise<LateCaptureResult> {
    const order = this.orders.get(params.orderId);
    if (!order) throw new Error('Order not found');
    if (order.currency !== params.currency || order.total_paise !== params.amountPaise) {
      throw new Error('Late capture amount/currency mismatch.');
    }

    const attempt = Array.from(this.attempts.values()).find(
      (a) => a.order_id === order.id && a.provider_order_id === params.providerOrderId
    );
    if (attempt) {
      attempt.status = 'captured';
      attempt.provider_payment_id = params.providerPaymentId;
      attempt.signature_verified = attempt.signature_verified || params.signatureVerified;
      attempt.api_verified = attempt.api_verified || params.apiVerified;
    }

    const payment = this.payments.get(order.id);
    if (payment) {
      payment.providerOrderId = params.providerOrderId;
      payment.providerPaymentId = params.providerPaymentId;
      payment.capturedPaise = params.amountPaise;
      payment.status = 'refund_pending';
      payment.signatureVerified = payment.signatureVerified || params.signatureVerified;
      payment.apiVerified = payment.apiVerified || params.apiVerified;
    }

    order.payment_status = 'refund_pending';
    return {
      order_id: order.id,
      payment_status: order.payment_status,
      order_status: order.order_status,
      requires_refund: true,
    };
  }

  async releaseExpiredOnlineOrderInventory(orderId?: string | null): Promise<number> {
    // Models FOR UPDATE OF o SKIP LOCKED concurrency guarantee
    if (this.expiryInFlight) {
      return 0;
    }
    this.expiryInFlight = true;
    try {
      let released = 0;
      const nowMs = Date.now();
      for (const order of this.orders.values()) {
        if (orderId && order.id !== orderId) continue;
        if (
          order.payment_method === 'online' &&
          order.order_status === 'pending_payment' &&
          ['created', 'pending', 'failed', 'authorized'].includes(order.payment_status) &&
          order.reservation_released_at === null &&
          (orderId || (order.reservation_expires_at && Date.parse(order.reservation_expires_at) <= nowMs))
        ) {
          for (const line of order.items) {
            if (line.inventoryRestored) continue;
            const prod = this.products[line.productId];
            if (line.variantId && prod.variants?.[line.variantId]) {
              prod.variants[line.variantId].stock += line.quantity;
            } else {
              prod.stock += line.quantity;
            }
            line.inventoryRestored = true;
          }
          order.reservation_released_at = new Date().toISOString();
          order.order_status = 'expired';
          order.payment_status = 'expired';
          released += 1;
        }
      }
      return released;
    } finally {
      this.expiryInFlight = false;
    }
  }
}

class MockRazorpayClient implements RazorpayApiClient {
  public createCalls = 0;
  public shouldFailCreate = false;
  public shouldFailFetch = false;
  public paymentsById = new Map<string, RazorpayPaymentEntity>();

  async createOrder(params: {
    amountPaise: number;
    currency: 'INR';
    receipt: string;
  }): Promise<RazorpayOrderEntity> {
    this.createCalls += 1;
    if (this.shouldFailCreate) {
      throw new Error('Simulated Razorpay gateway 503 outage');
    }
    return {
      id: `order_rp_${this.createCalls}`,
      amount: params.amountPaise,
      currency: params.currency,
      receipt: params.receipt,
      status: 'created',
    };
  }

  async fetchPayment(paymentId: string): Promise<RazorpayPaymentEntity> {
    if (this.shouldFailFetch) {
      throw new Error('Simulated Razorpay fetch outage');
    }
    const p = this.paymentsById.get(paymentId);
    if (!p) throw new Error(`Mock payment ${paymentId} not found`);
    return { ...p };
  }

  async fetchOrderPayments(providerOrderId: string): Promise<RazorpayPaymentEntity[]> {
    if (this.shouldFailFetch) {
      throw new Error('Simulated Razorpay fetch outage');
    }
    return Array.from(this.paymentsById.values())
      .filter((p) => p.order_id === providerOrderId)
      .map((p) => ({ ...p }));
  }
}

const VALID_SHIPPING = {
  full_name: 'Ananya Bora',
  email: 'ananya@example.com',
  phone: '9876543210',
  line1: 'Zoo Road Tiniali',
  city: 'Guwahati, Assam',
  postal_code: '781001',
};

function makeCreateReq(body: unknown, jwt?: string): Request {
  return new Request('https://edge.local/razorpay-create-order', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function makeVerifyReq(body: unknown, jwt?: string): Request {
  return new Request('https://edge.local/razorpay-verify-payment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function makeWebhookReq(
  payload: unknown,
  options: { eventId: string; signature?: string; secret?: string }
): Promise<Request> {
  const rawBody = JSON.stringify(payload);
  const sig =
    options.signature ??
    (await hmacSha256Hex(options.secret ?? WEBHOOK_SECRET, rawBody));
  return new Request('https://edge.local/razorpay-webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': sig,
      'x-razorpay-event-id': options.eventId,
    },
    body: rawBody,
  });
}

test('1-4. Create order validates JWT, resists price/customer tampering, and returns paise total + public key only', async () => {
  const repo = new InMemoryPaymentHarness();
  const rp = new MockRazorpayClient();

  // Test 3: Unauthenticated
  const unauthRes = await handleCreateRazorpayOrder(
    makeCreateReq({ shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-1', quantity: 1 }], idempotencyKey: 'idem-001' }),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  assert.equal(unauthRes.status, 401);

  // Test 2: Invalid JWT
  const invalidJwtRes = await handleCreateRazorpayOrder(
    makeCreateReq(
      { shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-1', quantity: 1 }], idempotencyKey: 'idem-001' },
      'tampered-jwt'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  assert.equal(invalidJwtRes.status, 401);

  // Test 1 & 4: Price + customer tampering ignored -> prod-1 (320000) + shipping (25000) = 345000 paise
  const okRes = await handleCreateRazorpayOrder(
    makeCreateReq(
      {
        shippingAddress: VALID_SHIPPING,
        items: [{ product_id: 'prod-1', quantity: 1, price: 1 }],
        idempotencyKey: 'idem-001',
        customerId: 'cust-b',
        totalPaise: 100,
        commission: 0,
      },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  assert.equal(okRes.status, 200);
  const data = (await okRes.json()) as Record<string, unknown>;
  assert.equal(data.amountPaise, 345000);
  assert.equal(data.currency, 'INR');
  assert.equal(data.publicKeyId, KEY_ID);
  assert.equal(data.providerOrderId, 'order_rp_1');
  assert.equal(repo.orders.get(String(data.orderId))?.customer_id, 'cust-a');
  assert.equal(repo.products['prod-1'].stock, 4);
  assert.doesNotMatch(JSON.stringify(data), new RegExp(KEY_SECRET));
});

test('5-6. Rejects unpublished, suspended-seller, invalid-variant, and out-of-stock items', async () => {
  const repo = new InMemoryPaymentHarness();
  const rp = new MockRazorpayClient();

  const unapproved = await handleCreateRazorpayOrder(
    makeCreateReq(
      { shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-unapproved', quantity: 1 }], idempotencyKey: 'idem-bad-1' },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  assert.equal(unapproved.status, 400);

  const suspended = await handleCreateRazorpayOrder(
    makeCreateReq(
      { shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-suspended', quantity: 1 }], idempotencyKey: 'idem-bad-2' },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  assert.equal(suspended.status, 400);

  const missingVar = await handleCreateRazorpayOrder(
    makeCreateReq(
      { shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-2', quantity: 1 }], idempotencyKey: 'idem-bad-3' },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  assert.equal(missingVar.status, 400);

  const noStock = await handleCreateRazorpayOrder(
    makeCreateReq(
      {
        shippingAddress: VALID_SHIPPING,
        items: [{ product_id: 'prod-2', variant_id: 'var-red', quantity: 9 }],
        idempotencyKey: 'idem-bad-4',
      },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  assert.equal(noStock.status, 400);
  assert.equal(repo.orders.size, 0);
  assert.equal(rp.createCalls, 0);
});

test('7-8. Duplicate checkout reuses existing order/Razorpay order; API failure keeps reservation retryable', async () => {
  const repo = new InMemoryPaymentHarness();
  const rp = new MockRazorpayClient();

  // Test 7: Duplicate request
  const first = await handleCreateRazorpayOrder(
    makeCreateReq(
      { shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-1', quantity: 1 }], idempotencyKey: 'idem-dup-1' },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  const firstData = (await first.json()) as { orderId: string; providerOrderId: string };

  const second = await handleCreateRazorpayOrder(
    makeCreateReq(
      { shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-1', quantity: 1 }], idempotencyKey: 'idem-dup-1' },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  const secondData = (await second.json()) as { orderId: string; providerOrderId: string; reusedExisting: boolean };
  assert.equal(second.status, 200);
  assert.equal(secondData.orderId, firstData.orderId);
  assert.equal(secondData.providerOrderId, firstData.providerOrderId);
  assert.equal(secondData.reusedExisting, true);
  assert.equal(rp.createCalls, 1);
  assert.equal(repo.products['prod-1'].stock, 4);

  // Test 8: Razorpay API outage cleanly records failed attempt & lets customer retry
  rp.shouldFailCreate = true;
  const failRes = await handleCreateRazorpayOrder(
    makeCreateReq(
      { shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-1', quantity: 1 }], idempotencyKey: 'idem-outage' },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  assert.equal(failRes.status, 502);
  const failData = (await failRes.json()) as { orderId: string; retryable: boolean };
  assert.equal(failData.retryable, true);
  assert.equal(repo.products['prod-1'].stock, 3); // held for retry

  rp.shouldFailCreate = false;
  const retryRes = await handleCreateRazorpayOrder(
    makeCreateReq(
      {
        shippingAddress: VALID_SHIPPING,
        items: [{ product_id: 'prod-1', quantity: 1 }],
        idempotencyKey: 'idem-outage',
        retryAttempt: true,
      },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  assert.equal(retryRes.status, 200);
  assert.equal(repo.products['prod-1'].stock, 3); // no extra stock deduction
});

test('9-13 & 25. Verification enforces ownership, HMAC, Razorpay order ID, amount, currency, and capture status', async () => {
  const repo = new InMemoryPaymentHarness();
  const rp = new MockRazorpayClient();

  const createRes = await handleCreateRazorpayOrder(
    makeCreateReq(
      { shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-1', quantity: 1 }], idempotencyKey: 'idem-ver-1' },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  const { orderId, providerOrderId, amountPaise } = (await createRes.json()) as {
    orderId: string;
    providerOrderId: string;
    amountPaise: number;
  };
  const paymentId = 'pay_ver_1';
  const validSig = await hmacSha256Hex(KEY_SECRET, `${providerOrderId}|${paymentId}`);

  // Test 25: Customer B tries to verify Customer A's order
  const crossCust = await handleVerifyRazorpayPayment(
    makeVerifyReq(
      { orderId, providerOrderId, providerPaymentId: paymentId, providerSignature: validSig },
      'jwt-cust-b'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeySecret: KEY_SECRET } }
  );
  assert.equal(crossCust.status, 403);

  // Test 9: Invalid checkout signature
  const badSig = await handleVerifyRazorpayPayment(
    makeVerifyReq(
      { orderId, providerOrderId, providerPaymentId: paymentId, providerSignature: '0'.repeat(64) },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeySecret: KEY_SECRET } }
  );
  assert.equal(badSig.status, 400);
  assert.equal(repo.orders.get(orderId)?.payment_status, 'created');

  // Test 10: Wrong Razorpay Order ID
  const wrongOrder = await handleVerifyRazorpayPayment(
    makeVerifyReq(
      {
        orderId,
        providerOrderId: 'order_wrong_999',
        providerPaymentId: paymentId,
        providerSignature: await hmacSha256Hex(KEY_SECRET, `order_wrong_999|${paymentId}`),
      },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeySecret: KEY_SECRET } }
  );
  assert.equal(wrongOrder.status, 400);

  // Test 11: Amount mismatch from Razorpay API
  rp.paymentsById.set(paymentId, {
    id: paymentId,
    order_id: providerOrderId,
    amount: amountPaise - 1000,
    currency: 'INR',
    status: 'captured',
  });
  const badAmount = await handleVerifyRazorpayPayment(
    makeVerifyReq(
      { orderId, providerOrderId, providerPaymentId: paymentId, providerSignature: validSig },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeySecret: KEY_SECRET } }
  );
  assert.equal(badAmount.status, 400);

  // Test 12: Currency mismatch
  rp.paymentsById.set(paymentId, {
    id: paymentId,
    order_id: providerOrderId,
    amount: amountPaise,
    currency: 'USD',
    status: 'captured',
  });
  const badCurr = await handleVerifyRazorpayPayment(
    makeVerifyReq(
      { orderId, providerOrderId, providerPaymentId: paymentId, providerSignature: validSig },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeySecret: KEY_SECRET } }
  );
  assert.equal(badCurr.status, 400);

  // Test 13: Browser callback succeeds, Razorpay API says 'authorized' (not captured)
  rp.paymentsById.set(paymentId, {
    id: paymentId,
    order_id: providerOrderId,
    amount: amountPaise,
    currency: 'INR',
    status: 'authorized',
  });
  const authOnly = await handleVerifyRazorpayPayment(
    makeVerifyReq(
      { orderId, providerOrderId, providerPaymentId: paymentId, providerSignature: validSig },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeySecret: KEY_SECRET } }
  );
  assert.equal(authOnly.status, 200);
  const authData = (await authOnly.json()) as { verified: boolean; paymentStatus: string; orderStatus: string };
  assert.equal(authData.verified, false);
  assert.equal(authData.paymentStatus, 'authorized');
  assert.equal(repo.orders.get(orderId)?.order_status, 'pending_payment');
  assert.equal(repo.ledgerEntries.length, 0);

  // Captured confirmation succeeds
  rp.paymentsById.set(paymentId, {
    id: paymentId,
    order_id: providerOrderId,
    amount: amountPaise,
    currency: 'INR',
    status: 'captured',
    method: 'upi',
  });
  const capRes = await handleVerifyRazorpayPayment(
    makeVerifyReq(
      { orderId, providerOrderId, providerPaymentId: paymentId, providerSignature: validSig },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeySecret: KEY_SECRET } }
  );
  assert.equal(capRes.status, 200);
  const capData = (await capRes.json()) as { verified: boolean; paymentStatus: string; orderStatus: string };
  assert.equal(capData.verified, true);
  assert.equal(capData.paymentStatus, 'captured');
  assert.equal(capData.orderStatus, 'confirmed');
  assert.equal(repo.orders.get(orderId)?.payment_status, 'paid');
});

test('14-18. Webhooks authenticate raw body, deduplicate events, block out-of-order downgrades, and reconcile both orders', async () => {
  const repo = new InMemoryPaymentHarness();
  const rp = new MockRazorpayClient();

  // Scenario A (Test 15, 17, 14, 16): Webhook arrives BEFORE browser callback
  const crA = await handleCreateRazorpayOrder(
    makeCreateReq(
      { shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-1', quantity: 1 }], idempotencyKey: 'idem-wh-a' },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  const orderA = (await crA.json()) as { orderId: string; providerOrderId: string; amountPaise: number };
  const payA = 'pay_wh_a';
  rp.paymentsById.set(payA, {
    id: payA,
    order_id: orderA.providerOrderId,
    amount: orderA.amountPaise,
    currency: 'INR',
    status: 'captured',
  });

  // Test 15: Invalid webhook signature rejected 401
  const badWh = await handleRazorpayWebhook(
    await makeWebhookReq(
      { event: 'payment.captured', payload: { payment: { entity: { id: payA, order_id: orderA.providerOrderId } } } },
      { eventId: 'evt_bad', signature: 'deadbeef' }
    ),
    { repo, razorpayClient: rp, env: { razorpayWebhookSecret: WEBHOOK_SECRET } }
  );
  assert.equal(badWh.status, 401);
  assert.equal(repo.orders.get(orderA.orderId)?.payment_status, 'created');

  // Test 17: payment.captured webhook arrives before callback
  const capPayload = {
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: payA,
          order_id: orderA.providerOrderId,
          amount: orderA.amountPaise,
          currency: 'INR',
          status: 'captured',
        },
      },
    },
  };
  const wh1 = await handleRazorpayWebhook(
    await makeWebhookReq(capPayload, { eventId: 'evt_cap_a' }),
    { repo, razorpayClient: rp, env: { razorpayWebhookSecret: WEBHOOK_SECRET } }
  );
  assert.equal(wh1.status, 200);
  assert.equal(repo.orders.get(orderA.orderId)?.payment_status, 'paid');
  const ledgerAfterWh1 = repo.ledgerEntries.filter((e) => e.orderId === orderA.orderId).length;
  assert.equal(ledgerAfterWh1, 5); // payment_captured + shipping_allocation + 3 seller split entries

  // Test 14: Duplicate webhook event deduplicated
  const whDup = await handleRazorpayWebhook(
    await makeWebhookReq(capPayload, { eventId: 'evt_cap_a' }),
    { repo, razorpayClient: rp, env: { razorpayWebhookSecret: WEBHOOK_SECRET } }
  );
  const whDupData = (await whDup.json()) as { deduplicated: boolean };
  assert.equal(whDupData.deduplicated, true);
  assert.equal(repo.ledgerEntries.filter((e) => e.orderId === orderA.orderId).length, ledgerAfterWh1);

  // Test 16: Out-of-order payment.authorized or payment.failed arriving AFTER capture never downgrades order
  const outOfOrder = await handleRazorpayWebhook(
    await makeWebhookReq(
      {
        event: 'payment.authorized',
        payload: {
          payment: {
            entity: {
              id: payA,
              order_id: orderA.providerOrderId,
              amount: orderA.amountPaise,
              currency: 'INR',
              status: 'authorized',
            },
          },
        },
      },
      { eventId: 'evt_late_auth_a' }
    ),
    { repo, razorpayClient: rp, env: { razorpayWebhookSecret: WEBHOOK_SECRET } }
  );
  const ooData = (await outOfOrder.json()) as { ignoredOutOfOrder: boolean };
  assert.equal(ooData.ignoredOutOfOrder, true);
  assert.equal(repo.orders.get(orderA.orderId)?.payment_status, 'paid');

  // Late browser verify callback succeeds idempotently without duplicating ledger
  const lateVerify = await handleVerifyRazorpayPayment(
    makeVerifyReq(
      {
        orderId: orderA.orderId,
        providerOrderId: orderA.providerOrderId,
        providerPaymentId: payA,
        providerSignature: await hmacSha256Hex(KEY_SECRET, `${orderA.providerOrderId}|${payA}`),
      },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeySecret: KEY_SECRET } }
  );
  assert.equal(lateVerify.status, 200);
  assert.equal(repo.ledgerEntries.filter((e) => e.orderId === orderA.orderId).length, ledgerAfterWh1);

  // Scenario B (Test 18): Browser callback arrives BEFORE order.paid / payment.captured webhook
  const crB = await handleCreateRazorpayOrder(
    makeCreateReq(
      { shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-1', quantity: 1 }], idempotencyKey: 'idem-wh-b' },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  const orderB = (await crB.json()) as { orderId: string; providerOrderId: string; amountPaise: number };
  const payB = 'pay_wh_b';
  rp.paymentsById.set(payB, {
    id: payB,
    order_id: orderB.providerOrderId,
    amount: orderB.amountPaise,
    currency: 'INR',
    status: 'captured',
  });

  const cbB = await handleVerifyRazorpayPayment(
    makeVerifyReq(
      {
        orderId: orderB.orderId,
        providerOrderId: orderB.providerOrderId,
        providerPaymentId: payB,
        providerSignature: await hmacSha256Hex(KEY_SECRET, `${orderB.providerOrderId}|${payB}`),
      },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeySecret: KEY_SECRET } }
  );
  assert.equal(cbB.status, 200);
  const ledgerAfterCbB = repo.ledgerEntries.filter((e) => e.orderId === orderB.orderId).length;

  const whB = await handleRazorpayWebhook(
    await makeWebhookReq(
      {
        event: 'order.paid',
        payload: {
          order: { entity: { id: orderB.providerOrderId, amount_paid: orderB.amountPaise, currency: 'INR' } },
          payment: { entity: { id: payB, order_id: orderB.providerOrderId, amount: orderB.amountPaise, currency: 'INR', status: 'captured' } },
        },
      },
      { eventId: 'evt_order_paid_b' }
    ),
    { repo, razorpayClient: rp, env: { razorpayWebhookSecret: WEBHOOK_SECRET } }
  );
  const whBData = (await whB.json()) as { alreadyCaptured: boolean };
  assert.equal(whB.status, 200);
  assert.equal(whBData.alreadyCaptured, true);
  assert.equal(repo.ledgerEntries.filter((e) => e.orderId === orderB.orderId).length, ledgerAfterCbB);
});

test('19. Failed payment retry creates a new attempt on existing reservation and confirms cleanly', async () => {
  const repo = new InMemoryPaymentHarness();
  const rp = new MockRazorpayClient();

  const cr1 = await handleCreateRazorpayOrder(
    makeCreateReq(
      { shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-1', quantity: 1 }], idempotencyKey: 'idem-retry-1' },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  const o1 = (await cr1.json()) as { orderId: string; providerOrderId: string; amountPaise: number };
  assert.equal(repo.products['prod-1'].stock, 4);

  // Gateway webhook reports attempt 1 failed
  await handleRazorpayWebhook(
    await makeWebhookReq(
      {
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: 'pay_fail_1',
              order_id: o1.providerOrderId,
              amount: o1.amountPaise,
              currency: 'INR',
              status: 'failed',
              error_code: 'BAD_REQUEST_ERROR',
              error_description: 'UPI collect timed out',
            },
          },
        },
      },
      { eventId: 'evt_fail_1' }
    ),
    { repo, razorpayClient: rp, env: { razorpayWebhookSecret: WEBHOOK_SECRET } }
  );
  assert.equal(repo.orders.get(o1.orderId)?.payment_status, 'failed');

  // Retry with retryAttempt: true -> reuses same reserved order, creates attempt #2
  const cr2 = await handleCreateRazorpayOrder(
    makeCreateReq(
      {
        shippingAddress: VALID_SHIPPING,
        items: [{ product_id: 'prod-1', quantity: 1 }],
        idempotencyKey: 'idem-retry-1',
        retryAttempt: true,
      },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  assert.equal(cr2.status, 200);
  const o2 = (await cr2.json()) as { orderId: string; providerOrderId: string; amountPaise: number };
  assert.equal(o2.orderId, o1.orderId);
  assert.notEqual(o2.providerOrderId, o1.providerOrderId);
  assert.equal(repo.products['prod-1'].stock, 4); // stock never double deducted

  const pay2 = 'pay_retry_ok';
  rp.paymentsById.set(pay2, {
    id: pay2,
    order_id: o2.providerOrderId,
    amount: o2.amountPaise,
    currency: 'INR',
    status: 'captured',
  });
  const ver2 = await handleVerifyRazorpayPayment(
    makeVerifyReq(
      {
        orderId: o2.orderId,
        providerOrderId: o2.providerOrderId,
        providerPaymentId: pay2,
        providerSignature: await hmacSha256Hex(KEY_SECRET, `${o2.providerOrderId}|${pay2}`),
      },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeySecret: KEY_SECRET } }
  );
  assert.equal(ver2.status, 200);
  assert.equal(repo.orders.get(o1.orderId)?.payment_status, 'paid');
});

test('20-22. Expiry worker is protected, handles concurrency exact-once, and never releases captured payments', async () => {
  const repo = new InMemoryPaymentHarness();
  const rp = new MockRazorpayClient();

  // Order 1: expired pending_payment (1 unit of prod-1)
  const res1 = await handleCreateRazorpayOrder(
    makeCreateReq(
      { shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-1', quantity: 1 }], idempotencyKey: 'idem-exp-1' },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  const ord1 = (await res1.json()) as { orderId: string };
  repo.orders.get(ord1.orderId)!.reservation_expires_at = new Date(Date.now() - 60_000).toISOString();

  // Order 2: captured payment (1 unit of prod-1) with past timestamp edge check
  const res2 = await handleCreateRazorpayOrder(
    makeCreateReq(
      { shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-1', quantity: 1 }], idempotencyKey: 'idem-cap-keep' },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  const ord2 = (await res2.json()) as { orderId: string; providerOrderId: string; amountPaise: number };
  rp.paymentsById.set('pay_keep', {
    id: 'pay_keep',
    order_id: ord2.providerOrderId,
    amount: ord2.amountPaise,
    currency: 'INR',
    status: 'captured',
  });
  await handleVerifyRazorpayPayment(
    makeVerifyReq(
      {
        orderId: ord2.orderId,
        providerOrderId: ord2.providerOrderId,
        providerPaymentId: 'pay_keep',
        providerSignature: await hmacSha256Hex(KEY_SECRET, `${ord2.providerOrderId}|pay_keep`),
      },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeySecret: KEY_SECRET } }
  );
  assert.equal(repo.products['prod-1'].stock, 3); // started at 5 -> reserved 2 = 3 left

  // Public unauthenticated caller blocked
  const unauthExp = await handleExpireOnlineOrders(
    new Request('https://edge.local/razorpay-expire-orders', { method: 'POST' }),
    { repo, env: { cronSecret: CRON_SECRET, serviceRoleKey: SERVICE_ROLE_KEY } }
  );
  assert.equal(unauthExp.status, 401);

  // Test 21: Two concurrent expiry workers run simultaneously -> exact-once stock restoration (only ord1)
  const [expA, expB] = await Promise.all([
    handleExpireOnlineOrders(
      new Request('https://edge.local/razorpay-expire-orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${CRON_SECRET}` },
      }),
      { repo, env: { cronSecret: CRON_SECRET, serviceRoleKey: SERVICE_ROLE_KEY } }
    ),
    handleExpireOnlineOrders(
      new Request('https://edge.local/razorpay-expire-orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${CRON_SECRET}` },
      }),
      { repo, env: { cronSecret: CRON_SECRET, serviceRoleKey: SERVICE_ROLE_KEY } }
    ),
  ]);
  const expAData = (await expA.json()) as { releasedCount: number };
  const expBData = (await expB.json()) as { releasedCount: number };
  assert.equal(expAData.releasedCount + expBData.releasedCount, 1);

  // Test 20 & 22: prod-1 stock restored from 3 -> 4 (ord1 released, ord2 captured NEVER released)
  assert.equal(repo.products['prod-1'].stock, 4);
  assert.equal(repo.orders.get(ord1.orderId)?.order_status, 'expired');
  assert.equal(repo.orders.get(ord2.orderId)?.order_status, 'confirmed');
  assert.equal(repo.orders.get(ord2.orderId)?.payment_status, 'paid');
});

test('24. Multi-vendor parent order splits accurately per seller with 12% subtotal commission and non-commissioned shipping', async () => {
  const repo = new InMemoryPaymentHarness();
  const rp = new MockRazorpayClient();

  // Seller 1: prod-1 = 320000 paise; Seller 2: prod-2 (var-red) = 250000 paise -> subtotal 570000 (>= 500000 threshold -> shipping 0)
  // Let's also test under threshold via prod-2 only or multi-vendor order total integrity:
  const cr = await handleCreateRazorpayOrder(
    makeCreateReq(
      {
        shippingAddress: VALID_SHIPPING,
        items: [
          { product_id: 'prod-1', quantity: 1 },
          { product_id: 'prod-2', variant_id: 'var-red', quantity: 1 },
        ],
        idempotencyKey: 'idem-mv-1',
      },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  const mv = (await cr.json()) as { orderId: string; providerOrderId: string; amountPaise: number };
  assert.equal(mv.amountPaise, 570000);

  rp.paymentsById.set('pay_mv_1', {
    id: 'pay_mv_1',
    order_id: mv.providerOrderId,
    amount: 570000,
    currency: 'INR',
    status: 'captured',
  });
  await handleVerifyRazorpayPayment(
    makeVerifyReq(
      {
        orderId: mv.orderId,
        providerOrderId: mv.providerOrderId,
        providerPaymentId: 'pay_mv_1',
        providerSignature: await hmacSha256Hex(KEY_SECRET, `${mv.providerOrderId}|pay_mv_1`),
      },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeySecret: KEY_SECRET } }
  );

  const ord = repo.orders.get(mv.orderId)!;
  assert.equal(ord.sellerOrders.length, 2);
  const s1 = ord.sellerOrders.find((s) => s.sellerId === 'seller-1')!;
  const s2 = ord.sellerOrders.find((s) => s.sellerId === 'seller-2')!;
  assert.equal(s1.commissionPaise, 38400); // 12% of 320000
  assert.equal(s1.sellerPayablePaise, 281600);
  assert.equal(s2.commissionPaise, 30000); // 12% of 250000
  assert.equal(s2.sellerPayablePaise, 220000);
  assert.equal(s1.subtotalPaise + s2.subtotalPaise, mv.amountPaise);
});

test('23 & 26. COD flow preserved intact, migration 009 hardened, Route disabled, and zero secrets in frontend src/', () => {
  const migration009 = fs.readFileSync(
    path.join(repoRoot, 'supabase/migrations/009_razorpay_checkout_verification.sql'),
    'utf8'
  );
  const migration008 = fs.readFileSync(
    path.join(repoRoot, 'supabase/migrations/008_payment_and_settlement_foundation.sql'),
    'utf8'
  );
  const databaseSource = fs.readFileSync(path.join(repoRoot, 'src/services/database.ts'), 'utf8');
  const checkoutSource = fs.readFileSync(path.join(repoRoot, 'src/pages/CheckoutPage.tsx'), 'utf8');

  // Test 23: COD checkout path intact in DB RPC & CheckoutPage & databaseService
  assert.match(migration008, /create or replace function public\.create_multi_vendor_order\(/);
  assert.match(migration008, /'cod', 'cod_pending', 'confirmed', 'confirmed'/);
  assert.match(databaseSource, /if \(params\.paymentMethod === 'online'\)/);
  assert.match(databaseSource, /supabase\.rpc\('create_multi_vendor_order'/);
  assert.match(checkoutSource, /Online Payment — Razorpay/);
  assert.match(checkoutSource, /Cash on Delivery \(COD\)/);
  assert.match(checkoutSource, /placeLiveOrder/);
  assert.match(checkoutSource, /placeDemoOrder/);

  // CheckoutPage must never confirm payment before server verifyPayment returns verified: true && captured
  assert.match(checkoutSource, /verifyResult\.verified && verifyResult\.paymentStatus === 'captured'/);

  // Migration 009 structural security & Route disabled
  assert.match(migration009, /^begin;/m);
  assert.match(migration009, /commit;\s*$/);
  assert.match(migration009, /razorpay_route_enabled = false/);
  assert.match(migration009, /grant execute on function public\.finalize_online_payment_capture[\s\S]*to service_role/);
  assert.match(migration009, /grant execute on function public\.record_online_payment_state[\s\S]*to service_role/);
  assert.doesNotMatch(migration009, /\bis_admin\s*\(|\bis_content_admin\s*\(/);

  // Zero private credentials anywhere in frontend src/
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [full] : [];
    });

  for (const file of walk(path.join(repoRoot, 'src'))) {
    if (file.includes('__tests__')) continue;
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(
      text,
      /RAZORPAY_KEY_SECRET|RAZORPAY_WEBHOOK_SECRET|SUPABASE_SERVICE_ROLE_KEY|CRON_SECRET/,
      `Frontend file must not reference server secrets: ${file}`
    );
  }
});

test('27. Finding 1 — 009 disables online payments by default, GET readiness verifies secrets+DB flag, and CheckoutPage defaults to COD', async () => {
  const migration009 = fs.readFileSync(
    path.join(repoRoot, 'supabase/migrations/009_razorpay_checkout_verification.sql'),
    'utf8'
  );
  const checkoutSource = fs.readFileSync(path.join(repoRoot, 'src/pages/CheckoutPage.tsx'), 'utf8');
  const providerSource = fs.readFileSync(path.join(repoRoot, 'src/services/payments/razorpayProvider.ts'), 'utf8');

  assert.match(migration009, /^\s*online_payments_enabled\s*=\s*false,/m);
  assert.doesNotMatch(migration009, /^\s*online_payments_enabled\s*=\s*true/m);
  assert.match(checkoutSource, /useState<'cod' \| 'online'>\('cod'\)/);
  assert.match(checkoutSource, /checkServerReadiness\(\)/);
  assert.match(providerSource, /razorpay-create-order/);

  const repo = new InMemoryPaymentHarness();
  const rp = new MockRazorpayClient();

  // Case A: DB online_payments_enabled = false -> GET reports false and POST returns 503
  repo.gatewayConfig.online_payments_enabled = false;
  const probeDisabled = await handleCreateRazorpayOrder(
    new Request('https://edge.local/razorpay-create-order', { method: 'GET' }),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET, razorpayWebhookSecretConfigured: true } }
  );
  assert.equal(probeDisabled.status, 200);
  assert.equal(((await probeDisabled.json()) as { onlineCheckoutReady: boolean }).onlineCheckoutReady, false);

  const postDisabled = await handleCreateRazorpayOrder(
    makeCreateReq(
      { shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-1', quantity: 1 }], idempotencyKey: 'idem-flag-off' },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET, razorpayWebhookSecretConfigured: true } }
  );
  assert.equal(postDisabled.status, 503);

  // Case B: DB flag true, but RAZORPAY_WEBHOOK_SECRET missing -> GET reports false
  repo.gatewayConfig.online_payments_enabled = true;
  const probeNoWebhook = await handleCreateRazorpayOrder(
    new Request('https://edge.local/razorpay-create-order', { method: 'GET' }),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET, razorpayWebhookSecretConfigured: false } }
  );
  assert.equal(((await probeNoWebhook.json()) as { onlineCheckoutReady: boolean }).onlineCheckoutReady, false);

  // Case C: DB flag true AND all server secrets configured -> GET reports true
  const probeReady = await handleCreateRazorpayOrder(
    new Request('https://edge.local/razorpay-create-order', { method: 'GET' }),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET, razorpayWebhookSecretConfigured: true } }
  );
  assert.equal(((await probeReady.json()) as { onlineCheckoutReady: boolean }).onlineCheckoutReady, true);
});

test('28. Finding 2 — Authorized lifecycle: bounded hold, delayed capture, capture-during-expiry reconciliation, abandoned timeout, and late webhook refund_pending', async () => {
  const repo = new InMemoryPaymentHarness();
  const rp = new MockRazorpayClient();

  // A) Authorized timeout -> abandoned authorization past bounded expiry releases stock once after Razorpay check
  const crAuthTimeout = await handleCreateRazorpayOrder(
    makeCreateReq(
      { shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-1', quantity: 1 }], idempotencyKey: 'idem-auth-exp' },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  const oAuth = (await crAuthTimeout.json()) as { orderId: string; providerOrderId: string; amountPaise: number };
  assert.equal(repo.products['prod-1'].stock, 4);

  rp.paymentsById.set('pay_auth_only', {
    id: 'pay_auth_only',
    order_id: oAuth.providerOrderId,
    amount: oAuth.amountPaise,
    currency: 'INR',
    status: 'authorized',
  });
  await handleRazorpayWebhook(
    await makeWebhookReq(
      {
        event: 'payment.authorized',
        payload: { payment: { entity: { id: 'pay_auth_only', order_id: oAuth.providerOrderId, amount: oAuth.amountPaise, currency: 'INR', status: 'authorized' } } },
      },
      { eventId: 'evt_auth_timeout' }
    ),
    { repo, razorpayClient: rp, env: { razorpayWebhookSecret: WEBHOOK_SECRET } }
  );
  assert.equal(repo.orders.get(oAuth.orderId)?.payment_status, 'authorized');
  assert.equal(repo.orders.get(oAuth.orderId)?.order_status, 'pending_payment');

  // Verify bounded hold <= 45 mins from creation
  const ordRec = repo.orders.get(oAuth.orderId)!;
  assert.ok(Date.parse(ordRec.reservation_expires_at!) <= ordRec.createdAtMs + 45 * 60_000);

  // Move past hold expiry while Razorpay still shows 'authorized' (not captured) -> expiry worker releases stock once
  ordRec.reservation_expires_at = new Date(Date.now() - 10_000).toISOString();
  const expAuth = await handleExpireOnlineOrders(
    new Request('https://edge.local/razorpay-expire-orders', {
      method: 'POST',
      headers: { 'x-cron-secret': CRON_SECRET },
    }),
    { repo, razorpayClient: rp, env: { cronSecret: CRON_SECRET, serviceRoleKey: SERVICE_ROLE_KEY } }
  );
  const expAuthData = (await expAuth.json()) as { releasedCount: number; reconciledCaptureCount: number };
  assert.equal(expAuthData.releasedCount, 1);
  assert.equal(repo.products['prod-1'].stock, 5);
  assert.equal(ordRec.order_status, 'expired');

  // D) Late capture webhook arriving AFTER expiry must NOT re-confirm order or skip refund; marks refund_pending with zero ledger entries
  rp.paymentsById.set('pay_auth_only', {
    id: 'pay_auth_only',
    order_id: oAuth.providerOrderId,
    amount: oAuth.amountPaise,
    currency: 'INR',
    status: 'captured',
  });
  const lateCapWh = await handleRazorpayWebhook(
    await makeWebhookReq(
      {
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_auth_only', order_id: oAuth.providerOrderId, amount: oAuth.amountPaise, currency: 'INR', status: 'captured' } } },
      },
      { eventId: 'evt_late_cap_after_exp' }
    ),
    { repo, razorpayClient: rp, env: { razorpayWebhookSecret: WEBHOOK_SECRET } }
  );
  const lateCapData = (await lateCapWh.json()) as { lateCaptureAfterExpiry: boolean; paymentStatus: string; orderStatus: string };
  assert.equal(lateCapWh.status, 200);
  assert.equal(lateCapData.lateCaptureAfterExpiry, true);
  assert.equal(lateCapData.paymentStatus, 'refund_pending');
  assert.equal(lateCapData.orderStatus, 'expired');
  assert.equal(repo.products['prod-1'].stock, 5);
  assert.equal(repo.ledgerEntries.filter((e) => e.orderId === oAuth.orderId).length, 0);

  // C) Capture occurring right before/during expiry worker -> worker checks Razorpay, sees captured, reconciles instead of releasing stock
  const crRace = await handleCreateRazorpayOrder(
    makeCreateReq(
      { shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-1', quantity: 1 }], idempotencyKey: 'idem-cap-race' },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  const oRace = (await crRace.json()) as { orderId: string; providerOrderId: string; amountPaise: number };
  assert.equal(repo.products['prod-1'].stock, 4);
  repo.orders.get(oRace.orderId)!.reservation_expires_at = new Date(Date.now() - 5_000).toISOString();
  rp.paymentsById.set('pay_captured_in_flight', {
    id: 'pay_captured_in_flight',
    order_id: oRace.providerOrderId,
    amount: oRace.amountPaise,
    currency: 'INR',
    status: 'captured',
  });

  const expRace = await handleExpireOnlineOrders(
    new Request('https://edge.local/razorpay-expire-orders', {
      method: 'POST',
      headers: { 'x-cron-secret': CRON_SECRET },
    }),
    { repo, razorpayClient: rp, env: { cronSecret: CRON_SECRET, serviceRoleKey: SERVICE_ROLE_KEY } }
  );
  const expRaceData = (await expRace.json()) as { releasedCount: number; reconciledCaptureCount: number };
  assert.equal(expRaceData.releasedCount, 0);
  assert.equal(expRaceData.reconciledCaptureCount, 1);
  assert.equal(repo.products['prod-1'].stock, 4); // stock NOT restored!
  assert.equal(repo.orders.get(oRace.orderId)?.order_status, 'confirmed');
  assert.equal(repo.orders.get(oRace.orderId)?.payment_status, 'paid');
});

test('29. Finding 3 — Webhook recovers cleanly after temporary DB failure (stale processing lease & beginWebhookEvent error)', async () => {
  const repo = new InMemoryPaymentHarness();
  const rp = new MockRazorpayClient();

  const cr = await handleCreateRazorpayOrder(
    makeCreateReq(
      { shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-1', quantity: 1 }], idempotencyKey: 'idem-wh-rec' },
      'jwt-cust-a'
    ),
    { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
  );
  const ord = (await cr.json()) as { orderId: string; providerOrderId: string; amountPaise: number };
  rp.paymentsById.set('pay_rec_1', {
    id: 'pay_rec_1',
    order_id: ord.providerOrderId,
    amount: ord.amountPaise,
    currency: 'INR',
    status: 'captured',
  });

  const payload = {
    event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_rec_1', order_id: ord.providerOrderId, amount: ord.amountPaise, currency: 'INR', status: 'captured' } } },
  };

  // Transient DB failure during beginWebhookEvent -> returns 500 so Razorpay retries
  repo.forceBeginWebhookError = true;
  const errRes = await handleRazorpayWebhook(
    await makeWebhookReq(payload, { eventId: 'evt_transient_1' }),
    { repo, razorpayClient: rp, env: { razorpayWebhookSecret: WEBHOOK_SECRET } }
  );
  assert.equal(errRes.status, 500);
  repo.forceBeginWebhookError = false;

  // Simulate previous attempt crashed mid-processing (> 60s ago) leaving status='processing'
  repo.webhooks.set('evt_stale_1', {
    status: 'processing',
    receivedAtMs: Date.now() - 90_000,
  });

  const retryRes = await handleRazorpayWebhook(
    await makeWebhookReq(payload, { eventId: 'evt_stale_1' }),
    { repo, razorpayClient: rp, env: { razorpayWebhookSecret: WEBHOOK_SECRET } }
  );
  assert.equal(retryRes.status, 200);
  const retryData = (await retryRes.json()) as { deduplicated?: boolean; orderId?: string };
  assert.notEqual(retryData.deduplicated, true);
  assert.equal(repo.orders.get(ord.orderId)?.payment_status, 'paid');
  assert.equal(repo.webhooks.get('evt_stale_1')?.status, 'processed');
});

test('30. Finding 4 — Expiry endpoint rejects customer JWTs (403), missing auth (401), forged secrets (403), and documents cron setup', async () => {
  const repo = new InMemoryPaymentHarness();
  const readme = fs.readFileSync(
    path.join(repoRoot, 'supabase/functions/razorpay-expire-orders/README.md'),
    'utf8'
  );
  assert.match(readme, /CRON_SECRET/);
  assert.match(readme, /pg_cron/);

  const noAuth = await handleExpireOnlineOrders(
    new Request('https://edge.local/razorpay-expire-orders', { method: 'POST' }),
    { repo, env: { cronSecret: CRON_SECRET, serviceRoleKey: SERVICE_ROLE_KEY } }
  );
  assert.equal(noAuth.status, 401);

  const custJwt = await handleExpireOnlineOrders(
    new Request('https://edge.local/razorpay-expire-orders', {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-cust-a' },
    }),
    { repo, env: { cronSecret: CRON_SECRET, serviceRoleKey: SERVICE_ROLE_KEY } }
  );
  assert.equal(custJwt.status, 403);

  const wrongCron = await handleExpireOnlineOrders(
    new Request('https://edge.local/razorpay-expire-orders', {
      method: 'POST',
      headers: { 'x-cron-secret': 'wrong-secret' },
    }),
    { repo, env: { cronSecret: CRON_SECRET, serviceRoleKey: SERVICE_ROLE_KEY } }
  );
  assert.equal(wrongCron.status, 403);

  const okServiceRole = await handleExpireOnlineOrders(
    new Request('https://edge.local/razorpay-expire-orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    }),
    { repo, env: { cronSecret: CRON_SECRET, serviceRoleKey: SERVICE_ROLE_KEY } }
  );
  assert.equal(okServiceRole.status, 200);
});

test('31. Finding 5 — All 10 payment lifecycle reconciliation scenarios maintain exact DB, inventory, and ledger invariants', async () => {
  const rp = new MockRazorpayClient();

  // Scenario 1: Payment initiated, customer closes modal / drops out -> expires cleanly, stock restored
  {
    const repo = new InMemoryPaymentHarness();
    const cr = await handleCreateRazorpayOrder(
      makeCreateReq({ shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-1', quantity: 1 }], idempotencyKey: 'idem-s1' }, 'jwt-cust-a'),
      { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
    );
    const { orderId } = (await cr.json()) as { orderId: string };
    assert.equal(repo.products['prod-1'].stock, 4);
    repo.orders.get(orderId)!.reservation_expires_at = new Date(Date.now() - 1_000).toISOString();
    await handleExpireOnlineOrders(
      new Request('https://edge.local/razorpay-expire-orders', { method: 'POST', headers: { 'x-cron-secret': CRON_SECRET } }),
      { repo, razorpayClient: rp, env: { cronSecret: CRON_SECRET } }
    );
    assert.equal(repo.orders.get(orderId)?.payment_status, 'expired');
    assert.equal(repo.orders.get(orderId)?.order_status, 'expired');
    assert.equal(repo.products['prod-1'].stock, 5);
    assert.equal(repo.ledgerEntries.length, 0);
  }

  // Scenario 2: Payment fails on Razorpay -> customer retries later before expiry and succeeds
  {
    const repo = new InMemoryPaymentHarness();
    const cr1 = await handleCreateRazorpayOrder(
      makeCreateReq({ shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-1', quantity: 1 }], idempotencyKey: 'idem-s2' }, 'jwt-cust-a'),
      { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
    );
    const o1 = (await cr1.json()) as { orderId: string; providerOrderId: string; amountPaise: number };
    await handleRazorpayWebhook(
      await makeWebhookReq(
        { event: 'payment.failed', payload: { payment: { entity: { id: 'p_s2_fail', order_id: o1.providerOrderId, amount: o1.amountPaise, currency: 'INR', status: 'failed' } } } },
        { eventId: 'evt_s2_fail' }
      ),
      { repo, razorpayClient: rp, env: { razorpayWebhookSecret: WEBHOOK_SECRET } }
    );
    assert.equal(repo.orders.get(o1.orderId)?.payment_status, 'failed');
    const cr2 = await handleCreateRazorpayOrder(
      makeCreateReq({ shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-1', quantity: 1 }], idempotencyKey: 'idem-s2', retryAttempt: true }, 'jwt-cust-a'),
      { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
    );
    const o2 = (await cr2.json()) as { providerOrderId: string };
    rp.paymentsById.set('p_s2_ok', { id: 'p_s2_ok', order_id: o2.providerOrderId, amount: o1.amountPaise, currency: 'INR', status: 'captured' });
    await handleVerifyRazorpayPayment(
      makeVerifyReq({ orderId: o1.orderId, providerOrderId: o2.providerOrderId, providerPaymentId: 'p_s2_ok', providerSignature: await hmacSha256Hex(KEY_SECRET, `${o2.providerOrderId}|p_s2_ok`) }, 'jwt-cust-a'),
      { repo, razorpayClient: rp, env: { razorpayKeySecret: KEY_SECRET } }
    );
    assert.equal(repo.orders.get(o1.orderId)?.payment_status, 'paid');
    assert.equal(repo.orders.get(o1.orderId)?.order_status, 'confirmed');
    assert.equal(repo.products['prod-1'].stock, 4);
    assert.equal(repo.ledgerEntries.length, 5);
  }

  // Scenario 3: Payment succeeds in Razorpay, browser disconnects before verify -> webhook settles order cleanly
  {
    const repo = new InMemoryPaymentHarness();
    const cr = await handleCreateRazorpayOrder(
      makeCreateReq({ shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-1', quantity: 1 }], idempotencyKey: 'idem-s3' }, 'jwt-cust-a'),
      { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
    );
    const o = (await cr.json()) as { orderId: string; providerOrderId: string; amountPaise: number };
    rp.paymentsById.set('p_s3', { id: 'p_s3', order_id: o.providerOrderId, amount: o.amountPaise, currency: 'INR', status: 'captured' });
    await handleRazorpayWebhook(
      await makeWebhookReq(
        { event: 'payment.captured', payload: { payment: { entity: { id: 'p_s3', order_id: o.providerOrderId, amount: o.amountPaise, currency: 'INR', status: 'captured' } } } },
        { eventId: 'evt_s3' }
      ),
      { repo, razorpayClient: rp, env: { razorpayWebhookSecret: WEBHOOK_SECRET } }
    );
    assert.equal(repo.orders.get(o.orderId)?.payment_status, 'paid');
    assert.equal(repo.orders.get(o.orderId)?.order_status, 'confirmed');
    assert.equal(repo.products['prod-1'].stock, 4);
    assert.equal(repo.ledgerEntries.length, 5);
  }

  // Scenario 4: Verify callback AND webhook run concurrently/sequentially -> exact-once ledger & capture
  {
    const repo = new InMemoryPaymentHarness();
    const cr = await handleCreateRazorpayOrder(
      makeCreateReq({ shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-1', quantity: 1 }], idempotencyKey: 'idem-s4' }, 'jwt-cust-a'),
      { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
    );
    const o = (await cr.json()) as { orderId: string; providerOrderId: string; amountPaise: number };
    rp.paymentsById.set('p_s4', { id: 'p_s4', order_id: o.providerOrderId, amount: o.amountPaise, currency: 'INR', status: 'captured' });
    const sig = await hmacSha256Hex(KEY_SECRET, `${o.providerOrderId}|p_s4`);
    await Promise.all([
      handleVerifyRazorpayPayment(
        makeVerifyReq({ orderId: o.orderId, providerOrderId: o.providerOrderId, providerPaymentId: 'p_s4', providerSignature: sig }, 'jwt-cust-a'),
        { repo, razorpayClient: rp, env: { razorpayKeySecret: KEY_SECRET } }
      ),
      handleRazorpayWebhook(
        await makeWebhookReq(
          { event: 'payment.captured', payload: { payment: { entity: { id: 'p_s4', order_id: o.providerOrderId, amount: o.amountPaise, currency: 'INR', status: 'captured' } } } },
          { eventId: 'evt_s4' }
        ),
        { repo, razorpayClient: rp, env: { razorpayWebhookSecret: WEBHOOK_SECRET } }
      ),
    ]);
    assert.equal(repo.orders.get(o.orderId)?.payment_status, 'paid');
    assert.equal(repo.orders.get(o.orderId)?.order_status, 'confirmed');
    assert.equal(repo.ledgerEntries.filter((e) => e.entryType === 'payment_captured').length, 1);
  }

  // Scenario 5 & 6: Webhook before verify + verify before webhook (already covered & asserted cleanly)
  // Scenario 7: Payment authorized, NOT captured yet -> pending_payment, zero ledger
  {
    const repo = new InMemoryPaymentHarness();
    const cr = await handleCreateRazorpayOrder(
      makeCreateReq({ shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-1', quantity: 1 }], idempotencyKey: 'idem-s7' }, 'jwt-cust-a'),
      { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
    );
    const o = (await cr.json()) as { orderId: string; providerOrderId: string; amountPaise: number };
    rp.paymentsById.set('p_s7', { id: 'p_s7', order_id: o.providerOrderId, amount: o.amountPaise, currency: 'INR', status: 'authorized' });
    const ver = await handleVerifyRazorpayPayment(
      makeVerifyReq({ orderId: o.orderId, providerOrderId: o.providerOrderId, providerPaymentId: 'p_s7', providerSignature: await hmacSha256Hex(KEY_SECRET, `${o.providerOrderId}|p_s7`) }, 'jwt-cust-a'),
      { repo, razorpayClient: rp, env: { razorpayKeySecret: KEY_SECRET } }
    );
    assert.equal(((await ver.json()) as { verified: boolean }).verified, false);
    assert.equal(repo.orders.get(o.orderId)?.payment_status, 'authorized');
    assert.equal(repo.orders.get(o.orderId)?.order_status, 'pending_payment');
    assert.equal(repo.products['prod-1'].stock, 4);
    assert.equal(repo.ledgerEntries.length, 0);
  }

  // Scenario 8: Payment authorized, delayed capture via webhook -> confirmed & ledger posted
  {
    const repo = new InMemoryPaymentHarness();
    const cr = await handleCreateRazorpayOrder(
      makeCreateReq({ shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-1', quantity: 1 }], idempotencyKey: 'idem-s8' }, 'jwt-cust-a'),
      { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
    );
    const o = (await cr.json()) as { orderId: string; providerOrderId: string; amountPaise: number };
    rp.paymentsById.set('p_s8', { id: 'p_s8', order_id: o.providerOrderId, amount: o.amountPaise, currency: 'INR', status: 'authorized' });
    await handleRazorpayWebhook(
      await makeWebhookReq(
        { event: 'payment.authorized', payload: { payment: { entity: { id: 'p_s8', order_id: o.providerOrderId, amount: o.amountPaise, currency: 'INR', status: 'authorized' } } } },
        { eventId: 'evt_s8_auth' }
      ),
      { repo, razorpayClient: rp, env: { razorpayWebhookSecret: WEBHOOK_SECRET } }
    );
    rp.paymentsById.set('p_s8', { id: 'p_s8', order_id: o.providerOrderId, amount: o.amountPaise, currency: 'INR', status: 'captured' });
    await handleRazorpayWebhook(
      await makeWebhookReq(
        { event: 'payment.captured', payload: { payment: { entity: { id: 'p_s8', order_id: o.providerOrderId, amount: o.amountPaise, currency: 'INR', status: 'captured' } } } },
        { eventId: 'evt_s8_cap' }
      ),
      { repo, razorpayClient: rp, env: { razorpayWebhookSecret: WEBHOOK_SECRET } }
    );
    assert.equal(repo.orders.get(o.orderId)?.payment_status, 'paid');
    assert.equal(repo.orders.get(o.orderId)?.order_status, 'confirmed');
    assert.equal(repo.ledgerEntries.length, 5);
  }

  // Scenario 9: Transient DB error on verify -> retryable 503, customer re-checks & settles cleanly
  {
    const repo = new InMemoryPaymentHarness();
    const cr = await handleCreateRazorpayOrder(
      makeCreateReq({ shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-1', quantity: 1 }], idempotencyKey: 'idem-s9' }, 'jwt-cust-a'),
      { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
    );
    const o = (await cr.json()) as { orderId: string; providerOrderId: string; amountPaise: number };
    rp.paymentsById.set('p_s9', { id: 'p_s9', order_id: o.providerOrderId, amount: o.amountPaise, currency: 'INR', status: 'captured' });
    const sig = await hmacSha256Hex(KEY_SECRET, `${o.providerOrderId}|p_s9`);

    repo.forceFinalizeTransientError = true;
    const errVerify = await handleVerifyRazorpayPayment(
      makeVerifyReq({ orderId: o.orderId, providerOrderId: o.providerOrderId, providerPaymentId: 'p_s9', providerSignature: sig }, 'jwt-cust-a'),
      { repo, razorpayClient: rp, env: { razorpayKeySecret: KEY_SECRET } }
    );
    assert.equal(errVerify.status, 503);
    assert.equal(((await errVerify.json()) as { retryable: boolean }).retryable, true);

    repo.forceFinalizeTransientError = false;
    const okVerify = await handleVerifyRazorpayPayment(
      makeVerifyReq({ orderId: o.orderId, providerOrderId: o.providerOrderId, providerPaymentId: 'p_s9', providerSignature: sig }, 'jwt-cust-a'),
      { repo, razorpayClient: rp, env: { razorpayKeySecret: KEY_SECRET } }
    );
    assert.equal(okVerify.status, 200);
    assert.equal(repo.orders.get(o.orderId)?.payment_status, 'paid');
    assert.equal(repo.orders.get(o.orderId)?.order_status, 'confirmed');
    assert.equal(repo.ledgerEntries.length, 5);
  }

  // Scenario 10: Duplicate payment webhooks -> deduplicated cleanly, zero double ledger entries
  {
    const repo = new InMemoryPaymentHarness();
    const cr = await handleCreateRazorpayOrder(
      makeCreateReq({ shippingAddress: VALID_SHIPPING, items: [{ product_id: 'prod-1', quantity: 1 }], idempotencyKey: 'idem-s10' }, 'jwt-cust-a'),
      { repo, razorpayClient: rp, env: { razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET } }
    );
    const o = (await cr.json()) as { orderId: string; providerOrderId: string; amountPaise: number };
    rp.paymentsById.set('p_s10', { id: 'p_s10', order_id: o.providerOrderId, amount: o.amountPaise, currency: 'INR', status: 'captured' });
    const whPayload = { event: 'payment.captured', payload: { payment: { entity: { id: 'p_s10', order_id: o.providerOrderId, amount: o.amountPaise, currency: 'INR', status: 'captured' } } } };
    await handleRazorpayWebhook(
      await makeWebhookReq(whPayload, { eventId: 'evt_s10_dup' }),
      { repo, razorpayClient: rp, env: { razorpayWebhookSecret: WEBHOOK_SECRET } }
    );
    const dupRes = await handleRazorpayWebhook(
      await makeWebhookReq(whPayload, { eventId: 'evt_s10_dup' }),
      { repo, razorpayClient: rp, env: { razorpayWebhookSecret: WEBHOOK_SECRET } }
    );
    assert.equal(((await dupRes.json()) as { deduplicated: boolean }).deduplicated, true);
    assert.equal(repo.ledgerEntries.length, 5);
  }
});
