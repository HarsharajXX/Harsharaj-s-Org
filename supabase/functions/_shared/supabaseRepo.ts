import type {
  AuthenticatedCustomer,
  CaptureFinalizationResult,
  CheckoutItemInput,
  ExpiredOrderCandidate,
  FinalizeOnlineRefundResult,
  FinalizeRouteTransferResult,
  FinalizeTransferReversalResult,
  GatewayConfigRow,
  LateCaptureResult,
  OrderPaymentSnapshot,
  PaymentAttemptRow,
  PaymentEdgeRepository,
  PaymentStateUpdateResult,
  ReconciliationTransferCandidate,
  RefundEdgeRepository,
  RefundItemReservationInput,
  RegisteredAttemptResult,
  ReservationResult,
  ReserveOnlineRefundResult,
  ReserveRouteTransferResult,
  ReserveTransferReversalResult,
  RouteEdgeRepository,
  SellerSettlementAccountRow,
  ShippingAddressInput,
} from './types.ts';

export interface SupabaseLikeClient {
  auth: {
    getUser(jwt: string): Promise<{ data: { user: { id: string; email?: string } | null }; error: { message: string } | null }>;
  };
  from(table: string): any;
  rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: any; error: { message: string; code?: string } | null }>;
}

export function sanitizeWebhookPayload(rawPayload: Record<string, unknown>): Record<string, unknown> {
  const payloadObj = (rawPayload.payload || {}) as Record<string, Record<string, Record<string, unknown>>>;
  const payment = payloadObj.payment?.entity;
  const order = payloadObj.order?.entity;
  const refund = payloadObj.refund?.entity;
  const account = payloadObj.account?.entity;
  const product = payloadObj.product?.entity;
  const transfer = payloadObj.transfer?.entity;
  const reversal = payloadObj.reversal?.entity;
  const settlement = payloadObj.settlement?.entity;
  return {
    event: rawPayload.event || null,
    account_id: rawPayload.account_id || null,
    created_at: rawPayload.created_at || null,
    payment: payment
      ? {
          id: payment.id || null,
          order_id: payment.order_id || null,
          amount: payment.amount || null,
          currency: payment.currency || null,
          status: payment.status || null,
          method: payment.method || null,
          captured: payment.captured ?? null,
          error_code: payment.error_code || null,
        }
      : null,
    order: order
      ? {
          id: order.id || null,
          amount: order.amount || null,
          amount_paid: order.amount_paid || null,
          currency: order.currency || null,
          status: order.status || null,
          receipt: order.receipt || null,
        }
      : null,
    refund: refund
      ? {
          id: refund.id || null,
          payment_id: refund.payment_id || null,
          amount: refund.amount || null,
          currency: refund.currency || null,
          status: refund.status || null,
          speed_processed: refund.speed_processed || null,
          speed_requested: refund.speed_requested || null,
        }
      : null,
    account: account
      ? {
          id: account.id || null,
          status: account.status || null,
          reference_id: account.reference_id || null,
        }
      : null,
    product: product
      ? {
          id: product.id || null,
          account_id: product.account_id || null,
          product_name: product.product_name || null,
          activation_status: product.activation_status || null,
        }
      : null,
    transfer: transfer
      ? {
          id: transfer.id || null,
          source: transfer.source || null,
          recipient: transfer.recipient || null,
          amount: transfer.amount || null,
          currency: transfer.currency || null,
          status: transfer.status || null,
          settlement_status: transfer.settlement_status || null,
          recipient_settlement_id: transfer.recipient_settlement_id || null,
          on_hold: transfer.on_hold ?? null,
          amount_reversed: transfer.amount_reversed ?? null,
        }
      : null,
    reversal: reversal
      ? {
          id: reversal.id || null,
          transfer_id: reversal.transfer_id || null,
          amount: reversal.amount || null,
          currency: reversal.currency || null,
          status: reversal.status || null,
        }
      : null,
    settlement: settlement
      ? {
          id: settlement.id || null,
          amount: settlement.amount || null,
          status: settlement.status || null,
          utr: settlement.utr || null,
        }
      : null,
  };
}

export class SupabasePaymentEdgeRepository
  implements PaymentEdgeRepository, RefundEdgeRepository, RouteEdgeRepository
{
  constructor(private readonly client: SupabaseLikeClient) {}

  async authenticateCustomer(jwt: string): Promise<AuthenticatedCustomer | null> {
    if (!jwt) return null;
    const { data, error } = await this.client.auth.getUser(jwt);
    if (error || !data?.user?.id) return null;
    return { id: data.user.id, email: data.user.email };
  }

  async getGatewayConfig(): Promise<GatewayConfigRow> {
    const { data, error } = await this.client
      .from('payment_gateway_config')
      .select('active_provider, online_payments_enabled, razorpay_mode, razorpay_route_enabled, route_approval_status')
      .eq('id', 1)
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Payment gateway configuration is missing.');
    }
    return data as GatewayConfigRow;
  }

  async reserveOnlineOrderInventory(params: {
    customerId: string;
    shippingAddress: ShippingAddressInput;
    items: CheckoutItemInput[];
    idempotencyKey: string;
  }): Promise<ReservationResult> {
    const { data, error } = await this.client.rpc('reserve_online_order_inventory', {
      p_customer_id: params.customerId,
      p_shipping_address: params.shippingAddress,
      p_items: params.items,
      p_idempotency_key: params.idempotencyKey,
    });

    if (error) {
      throw new Error(error.message || 'Could not reserve inventory for checkout.');
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.order_id) {
      throw new Error('Reservation helper did not return an order ID.');
    }
    return {
      order_id: String(row.order_id),
      order_number: String(row.order_number),
      total_paise: Number(row.total_paise),
      currency: 'INR',
      reservation_expires_at: String(row.reservation_expires_at),
      reused_existing: Boolean(row.reused_existing),
    };
  }

  async getOrderPaymentSnapshot(orderId: string): Promise<OrderPaymentSnapshot | null> {
    const { data, error } = await this.client
      .from('orders')
      .select(
        'id, order_number, customer_id, total_paise, currency, payment_method, payment_status, order_status, reservation_expires_at, reservation_released_at'
      )
      .eq('id', orderId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      ...data,
      total_paise: Number(data.total_paise),
    } as OrderPaymentSnapshot;
  }

  async listOrderAttempts(orderId: string): Promise<PaymentAttemptRow[]> {
    const { data, error } = await this.client
      .from('payment_attempts')
      .select(
        'id, payment_id, order_id, attempt_number, provider_order_id, provider_payment_id, amount_paise, currency, status, signature_verified, api_verified'
      )
      .eq('order_id', orderId)
      .order('attempt_number', { ascending: false });

    if (error) throw new Error(error.message);
    return (data || []).map((row: Record<string, unknown>) => ({
      ...row,
      attempt_number: Number(row.attempt_number),
      amount_paise: Number(row.amount_paise),
    })) as PaymentAttemptRow[];
  }

  async getAttemptByProviderOrderId(providerOrderId: string): Promise<{
    order: OrderPaymentSnapshot;
    attempt: PaymentAttemptRow;
  } | null> {
    const { data: attempt, error } = await this.client
      .from('payment_attempts')
      .select(
        'id, payment_id, order_id, attempt_number, provider_order_id, provider_payment_id, amount_paise, currency, status, signature_verified, api_verified'
      )
      .eq('provider_order_id', providerOrderId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!attempt) return null;

    const order = await this.getOrderPaymentSnapshot(String(attempt.order_id));
    if (!order) return null;

    return {
      order,
      attempt: {
        ...attempt,
        attempt_number: Number(attempt.attempt_number),
        amount_paise: Number(attempt.amount_paise),
      } as PaymentAttemptRow,
    };
  }

  async registerPaymentAttempt(params: {
    orderId: string;
    customerId: string;
    providerOrderId: string;
    amountPaise: number;
    currency: 'INR';
    idempotencyKey: string;
    expiresAt: string;
    metadata?: Record<string, unknown>;
  }): Promise<RegisteredAttemptResult> {
    const { data, error } = await this.client.rpc('register_razorpay_payment_attempt', {
      p_order_id: params.orderId,
      p_customer_id: params.customerId,
      p_provider_order_id: params.providerOrderId,
      p_amount_paise: params.amountPaise,
      p_currency: params.currency,
      p_idempotency_key: params.idempotencyKey,
      p_expires_at: params.expiresAt,
      p_metadata: params.metadata || {},
    });

    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return {
      payment_id: String(row.payment_id),
      attempt_id: String(row.attempt_id),
      attempt_number: Number(row.attempt_number),
    };
  }

  async recordCreateOrderFailure(params: {
    orderId: string;
    customerId: string;
    amountPaise: number;
    idempotencyKey: string;
    failureCode: string;
    failureReason: string;
  }): Promise<void> {
    const { data: existingPayment } = await this.client
      .from('payments')
      .select('id')
      .eq('order_id', params.orderId)
      .eq('provider', 'razorpay')
      .maybeSingle();

    let paymentId = existingPayment?.id as string | undefined;
    if (!paymentId) {
      const { data: inserted, error: insertErr } = await this.client
        .from('payments')
        .insert({
          order_id: params.orderId,
          customer_id: params.customerId,
          provider: 'razorpay',
          amount: Number((params.amountPaise / 100).toFixed(2)),
          amount_paise: params.amountPaise,
          currency: 'INR',
          status: 'failed',
          idempotency_key: params.idempotencyKey,
          metadata: { failure_code: params.failureCode },
        })
        .select('id')
        .single();
      if (insertErr) throw new Error(insertErr.message);
      paymentId = String(inserted.id);
    }

    const attempts = await this.listOrderAttempts(params.orderId);
    const nextAttempt = (attempts[0]?.attempt_number || 0) + 1;

    await this.client.from('payment_attempts').insert({
      payment_id: paymentId,
      order_id: params.orderId,
      attempt_number: nextAttempt,
      provider: 'razorpay',
      amount_paise: params.amountPaise,
      currency: 'INR',
      status: 'failed',
      failure_code: params.failureCode,
      failure_reason: params.failureReason,
      idempotency_key: `${params.idempotencyKey}:failed:${nextAttempt}`,
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
    gatewayMethod?: string | null;
    gatewayFeePaise?: number;
    verificationSource: 'verify_endpoint' | 'webhook';
  }): Promise<CaptureFinalizationResult> {
    const { data, error } = await this.client.rpc('finalize_online_payment_capture', {
      p_order_id: params.orderId,
      p_provider_order_id: params.providerOrderId,
      p_provider_payment_id: params.providerPaymentId,
      p_amount_paise: params.amountPaise,
      p_currency: params.currency,
      p_signature_verified: params.signatureVerified,
      p_api_verified: params.apiVerified,
      p_gateway_method: params.gatewayMethod ?? null,
      p_gateway_fee_paise: params.gatewayFeePaise ?? 0,
      p_verification_source: params.verificationSource,
    });

    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return {
      order_id: String(row.order_id),
      payment_status: String(row.payment_status),
      order_status: String(row.order_status),
      already_captured: Boolean(row.already_captured),
    };
  }

  async recordPaymentState(params: {
    orderId: string;
    providerOrderId: string;
    providerPaymentId?: string | null;
    nextStatus: 'authorized' | 'failed';
    failureCode?: string | null;
    failureReason?: string | null;
    signatureVerified: boolean;
    apiVerified: boolean;
  }): Promise<PaymentStateUpdateResult> {
    const { data, error } = await this.client.rpc('record_online_payment_state', {
      p_order_id: params.orderId,
      p_provider_order_id: params.providerOrderId,
      p_provider_payment_id: params.providerPaymentId ?? null,
      p_next_status: params.nextStatus,
      p_failure_code: params.failureCode ?? null,
      p_failure_reason: params.failureReason ?? null,
      p_signature_verified: params.signatureVerified,
      p_api_verified: params.apiVerified,
    });

    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return {
      order_id: String(row.order_id),
      payment_status: String(row.payment_status),
      order_status: String(row.order_status),
      ignored_out_of_order: Boolean(row.ignored_out_of_order),
    };
  }

  async beginWebhookEvent(params: {
    eventId: string;
    eventType: string;
    providerOrderId?: string | null;
    providerPaymentId?: string | null;
    signatureValid: boolean;
    safePayload: Record<string, unknown>;
  }): Promise<{ deduplicated: boolean; existingStatus?: string }> {
    const { data: existing, error: selectErr } = await this.client
      .from('payment_webhook_events')
      .select('id, processing_status, received_at')
      .eq('event_id', params.eventId)
      .maybeSingle();

    if (selectErr) {
      throw new Error(selectErr.message || 'Unable to query webhook deduplication state.');
    }

    if (existing) {
      const status = String(existing.processing_status);
      if (status === 'processed' || status === 'ignored') {
        return { deduplicated: true, existingStatus: status };
      }

      if (status === 'processing') {
        const receivedAtMs = existing.received_at ? Date.parse(String(existing.received_at)) : NaN;
        const staleLease = Number.isFinite(receivedAtMs) && Date.now() - receivedAtMs >= 60_000;
        if (!staleLease) {
          return { deduplicated: true, existingStatus: status };
        }
      }

      // Reclaim failed or stale-processing (>= 60s) webhook lease safely
      const { error: reclaimErr } = await this.client
        .from('payment_webhook_events')
        .update({
          processing_status: 'processing',
          received_at: new Date().toISOString(),
          error_message: null,
        })
        .eq('id', existing.id);

      if (reclaimErr) {
        throw new Error(reclaimErr.message || 'Unable to reclaim webhook event processing lease.');
      }

      return { deduplicated: false };
    }

    const { error } = await this.client.from('payment_webhook_events').insert({
      provider: 'razorpay',
      event_id: params.eventId,
      event_type: params.eventType,
      provider_order_id: params.providerOrderId ?? null,
      provider_payment_id: params.providerPaymentId ?? null,
      signature_valid: params.signatureValid,
      processing_status: 'processing',
      safe_payload: params.safePayload,
    });

    if (error) {
      if (error.code === '23505') {
        return { deduplicated: true, existingStatus: 'processing' };
      }
      throw new Error(error.message);
    }

    return { deduplicated: false };
  }

  async completeWebhookEvent(params: {
    eventId: string;
    status: 'processed' | 'ignored' | 'failed';
    errorMessage?: string | null;
  }): Promise<void> {
    const { error } = await this.client
      .from('payment_webhook_events')
      .update({
        processing_status: params.status,
        processed_at: params.status === 'failed' ? null : new Date().toISOString(),
        error_message: params.errorMessage ?? null,
      })
      .eq('event_id', params.eventId);

    if (error) {
      throw new Error(error.message || 'Unable to update webhook event completion state.');
    }
  }

  async listExpiredPendingOrders(limit = 50): Promise<ExpiredOrderCandidate[]> {
    const nowIso = new Date().toISOString();
    const { data: orderRows, error: ordersErr } = await this.client
      .from('orders')
      .select(
        'id, order_number, customer_id, total_paise, currency, payment_method, payment_status, order_status, reservation_expires_at, reservation_released_at'
      )
      .eq('payment_method', 'online')
      .eq('order_status', 'pending_payment')
      .in('payment_status', ['created', 'pending', 'failed', 'authorized'])
      .is('reservation_released_at', null)
      .not('reservation_expires_at', 'is', null)
      .lte('reservation_expires_at', nowIso)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (ordersErr) throw new Error(ordersErr.message);
    if (!orderRows || orderRows.length === 0) return [];

    const orderIds = orderRows.map((o: Record<string, unknown>) => String(o.id));
    const { data: attemptRows, error: attemptsErr } = await this.client
      .from('payment_attempts')
      .select(
        'id, payment_id, order_id, attempt_number, provider_order_id, provider_payment_id, amount_paise, currency, status, signature_verified, api_verified'
      )
      .in('order_id', orderIds)
      .order('attempt_number', { ascending: false });

    if (attemptsErr) throw new Error(attemptsErr.message);

    const attemptsByOrder = new Map<string, PaymentAttemptRow[]>();
    for (const raw of attemptRows || []) {
      const row = {
        ...raw,
        attempt_number: Number(raw.attempt_number),
        amount_paise: Number(raw.amount_paise),
      } as PaymentAttemptRow;
      const list = attemptsByOrder.get(row.order_id) || [];
      list.push(row);
      attemptsByOrder.set(row.order_id, list);
    }

    return orderRows.map((raw: Record<string, unknown>) => {
      const order = {
        ...raw,
        total_paise: Number(raw.total_paise),
      } as OrderPaymentSnapshot;
      return {
        order,
        attempts: attemptsByOrder.get(order.id) || [],
      };
    });
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
    const { data, error } = await this.client.rpc('record_late_capture_after_expiry', {
      p_order_id: params.orderId,
      p_provider_order_id: params.providerOrderId,
      p_provider_payment_id: params.providerPaymentId,
      p_amount_paise: params.amountPaise,
      p_currency: params.currency,
      p_signature_verified: params.signatureVerified,
      p_api_verified: params.apiVerified,
    });

    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return {
      order_id: String(row.order_id),
      payment_status: String(row.payment_status),
      order_status: String(row.order_status),
      requires_refund: Boolean(row.requires_refund),
    };
  }

  async releaseExpiredOnlineOrderInventory(orderId?: string | null): Promise<number> {
    const { data, error } = await this.client.rpc('release_expired_online_order_inventory', {
      p_order_id: orderId ?? null,
      p_target_status: 'expired',
    });
    if (error) throw new Error(error.message);
    return Number(data || 0);
  }

  async isOperationsAdmin(userId: string): Promise<boolean> {
    if (!userId) return false;
    const { data, error } = await this.client
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .in('role', ['super_admin', 'operations_admin']);
    if (error) throw new Error(error.message);
    return Array.isArray(data) && data.length > 0;
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
    const { data, error } = await this.client.rpc('reserve_online_refund', {
      p_actor_id: params.actorId,
      p_order_id: params.orderId,
      p_refund_id: params.refundId ?? null,
      p_seller_order_id: params.sellerOrderId ?? null,
      p_items: params.items ?? null,
      p_amount_paise: params.amountPaise ?? null,
      p_shipping_refund_paise: params.shippingRefundPaise ?? 0,
      p_reason: params.reason,
      p_idempotency_key: params.idempotencyKey,
      p_internal_notes: params.internalNotes ?? null,
    });
    if (error) throw new Error(error.message || 'Unable to reserve online refund.');
    const row = Array.isArray(data) ? data[0] : data;
    return {
      refund_id: String(row.refund_id),
      order_id: String(row.order_id),
      provider_payment_id: String(row.provider_payment_id),
      amount_paise: Number(row.amount_paise),
      currency: String(row.currency || 'INR'),
      already_initiated: Boolean(row.already_initiated),
      provider_refund_id: row.provider_refund_id ? String(row.provider_refund_id) : null,
      refund_status: (row.refund_status || 'pending') as 'pending' | 'processed' | 'failed',
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
    const { data, error } = await this.client.rpc('finalize_online_refund_state', {
      p_refund_id: params.refundId ?? null,
      p_provider_refund_id: params.providerRefundId ?? null,
      p_provider_payment_id: params.providerPaymentId ?? null,
      p_next_status: params.nextStatus,
      p_amount_paise: params.amountPaise ?? null,
      p_failure_reason: params.failureReason ?? null,
      p_actor_id: params.actorId ?? null,
      p_metadata: params.metadata ?? {},
    });
    if (error) throw new Error(error.message || 'Unable to finalize online refund state.');
    const row = Array.isArray(data) ? data[0] : data;
    return {
      refund_id: String(row.refund_id),
      order_id: String(row.order_id),
      refund_status: (row.refund_status || 'pending') as 'pending' | 'processed' | 'failed',
      order_payment_status: String(row.order_payment_status),
      already_processed: Boolean(row.already_processed),
      ignored_out_of_order: Boolean(row.ignored_out_of_order),
    };
  }

  async getRefundRecordById(refundId: string): Promise<{
    id: string;
    order_id: string;
    payment_id: string | null;
    amount_paise: number;
    status: string;
    provider_refund_id: string | null;
  } | null> {
    const { data, error } = await this.client
      .from('refund_records')
      .select('id, order_id, payment_id, amount_paise, status, provider_refund_id')
      .eq('id', refundId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      id: String(data.id),
      order_id: String(data.order_id),
      payment_id: data.payment_id ? String(data.payment_id) : null,
      amount_paise: Number(data.amount_paise),
      status: String(data.status),
      provider_refund_id: data.provider_refund_id ? String(data.provider_refund_id) : null,
    };
  }

  async getRefundRecordByProviderRefundId(providerRefundId: string): Promise<{
    id: string;
    order_id: string;
    payment_id: string | null;
    amount_paise: number;
    status: string;
    provider_refund_id: string | null;
  } | null> {
    const { data, error } = await this.client
      .from('refund_records')
      .select('id, order_id, payment_id, amount_paise, status, provider_refund_id')
      .eq('provider_refund_id', providerRefundId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      id: String(data.id),
      order_id: String(data.order_id),
      payment_id: data.payment_id ? String(data.payment_id) : null,
      amount_paise: Number(data.amount_paise),
      status: String(data.status),
      provider_refund_id: data.provider_refund_id ? String(data.provider_refund_id) : null,
    };
  }

  private mapSettlementAccountRow(data: Record<string, unknown>): SellerSettlementAccountRow {
    return {
      id: String(data.id),
      seller_id: String(data.seller_id),
      legal_business_name: String(data.legal_business_name || ''),
      business_type: data.business_type ? String(data.business_type) : null,
      contact_name: String(data.contact_name || ''),
      contact_email: String(data.contact_email || ''),
      contact_phone: String(data.contact_phone || ''),
      pan_last4: data.pan_last4 ? String(data.pan_last4) : null,
      gstin: data.gstin ? String(data.gstin) : null,
      beneficiary_name: data.beneficiary_name ? String(data.beneficiary_name) : null,
      bank_account_last4: data.bank_account_last4 ? String(data.bank_account_last4) : null,
      bank_ifsc: data.bank_ifsc ? String(data.bank_ifsc) : null,
      registered_address:
        data.registered_address && typeof data.registered_address === 'object'
          ? (data.registered_address as Record<string, unknown>)
          : null,
      kyc_status: String(data.kyc_status || 'not_started'),
      route_onboarding_status: String(data.route_onboarding_status || 'not_started'),
      payouts_enabled: Boolean(data.payouts_enabled),
      razorpay_linked_account_id: data.razorpay_linked_account_id
        ? String(data.razorpay_linked_account_id)
        : null,
      razorpay_product_id: data.razorpay_product_id ? String(data.razorpay_product_id) : null,
      razorpay_raw_activation_status: data.razorpay_raw_activation_status
        ? String(data.razorpay_raw_activation_status)
        : null,
      seller_consent_accepted: Boolean(data.seller_consent_accepted),
      agreement_accepted: Boolean(data.agreement_accepted),
    };
  }

  private readonly settlementAccountColumns =
    'id, seller_id, legal_business_name, business_type, contact_name, contact_email, contact_phone, pan_last4, gstin, beneficiary_name, bank_account_last4, bank_ifsc, registered_address, kyc_status, route_onboarding_status, payouts_enabled, razorpay_linked_account_id, razorpay_product_id, razorpay_raw_activation_status, seller_consent_accepted, agreement_accepted';

  async getSellerSettlementAccountById(
    accountId: string
  ): Promise<SellerSettlementAccountRow | null> {
    const { data, error } = await this.client
      .from('seller_settlement_accounts')
      .select(this.settlementAccountColumns)
      .eq('id', accountId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? this.mapSettlementAccountRow(data as Record<string, unknown>) : null;
  }

  async getSellerSettlementAccountBySellerId(
    sellerId: string
  ): Promise<SellerSettlementAccountRow | null> {
    const { data, error } = await this.client
      .from('seller_settlement_accounts')
      .select(this.settlementAccountColumns)
      .eq('seller_id', sellerId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? this.mapSettlementAccountRow(data as Record<string, unknown>) : null;
  }

  async getSellerSettlementAccountByLinkedAccountId(
    linkedAccountId: string
  ): Promise<SellerSettlementAccountRow | null> {
    const { data, error } = await this.client
      .from('seller_settlement_accounts')
      .select(this.settlementAccountColumns)
      .eq('razorpay_linked_account_id', linkedAccountId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? this.mapSettlementAccountRow(data as Record<string, unknown>) : null;
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
    const { data, error } = await this.client.rpc('sync_linked_account_from_route', {
      p_account_id: params.accountId ?? null,
      p_razorpay_linked_account_id: params.linkedAccountId,
      p_razorpay_product_id: params.productId ?? null,
      p_razorpay_stakeholder_id: params.stakeholderId ?? null,
      p_raw_activation_status: params.rawActivationStatus,
      p_kyc_requirements: params.kycRequirements ?? null,
      p_actor_id: params.actorId ?? null,
    });
    if (error) throw new Error(error.message || 'Unable to sync Linked Account from Razorpay Route.');
    const row = Array.isArray(data) ? data[0] : data;
    return this.mapSettlementAccountRow(row as Record<string, unknown>);
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
    const { data, error } = await this.client.rpc('reserve_seller_route_transfer', {
      p_actor_id: params.actorId,
      p_seller_order_id: params.sellerOrderId,
      p_amount_paise: params.amountPaise ?? null,
      p_transfer_id: params.transferId ?? null,
      p_on_hold: params.onHold ?? false,
      p_hold_until: params.holdUntil ?? null,
      p_idempotency_key: params.idempotencyKey,
    });
    if (error) throw new Error(error.message || 'Unable to reserve Route transfer.');
    const row = Array.isArray(data) ? data[0] : data;
    return {
      transfer_id: String(row.transfer_id),
      seller_order_id: String(row.seller_order_id),
      order_id: String(row.order_id),
      payment_id: String(row.payment_id),
      provider_payment_id: String(row.provider_payment_id),
      seller_id: String(row.seller_id),
      settlement_account_id: String(row.settlement_account_id),
      linked_account_id: String(row.linked_account_id),
      amount_paise: Number(row.amount_paise),
      currency: String(row.currency || 'INR'),
      on_hold: Boolean(row.on_hold),
      hold_until: row.hold_until ? String(row.hold_until) : null,
      already_initiated: Boolean(row.already_initiated),
      provider_transfer_id: row.provider_transfer_id ? String(row.provider_transfer_id) : null,
      transfer_status: String(row.transfer_status),
    };
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
    const { data, error } = await this.client.rpc('finalize_seller_route_transfer', {
      p_transfer_id: params.transferId ?? null,
      p_provider_transfer_id: params.providerTransferId ?? null,
      p_next_status: params.nextStatus,
      p_settlement_id: params.settlementId ?? null,
      p_settlement_utr: params.settlementUtr ?? null,
      p_failure_reason: params.failureReason ?? null,
      p_error_code: params.errorCode ?? null,
      p_actor_id: params.actorId ?? null,
      p_metadata: params.metadata ?? {},
    });
    if (error) throw new Error(error.message || 'Unable to finalize Route transfer.');
    const row = Array.isArray(data) ? data[0] : data;
    return {
      transfer_id: String(row.transfer_id),
      seller_order_id: String(row.seller_order_id),
      transfer_status: String(row.transfer_status),
      settlement_status: String(row.settlement_status),
      ignored_out_of_order: Boolean(row.ignored_out_of_order),
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
    const { data, error } = await this.client.rpc('reserve_seller_transfer_reversal', {
      p_actor_id: params.actorId,
      p_transfer_id: params.transferId,
      p_amount_paise: params.amountPaise ?? null,
      p_refund_id: params.refundId ?? null,
      p_reason: params.reason,
      p_idempotency_key: params.idempotencyKey,
    });
    if (error) throw new Error(error.message || 'Unable to reserve Route transfer reversal.');
    const row = Array.isArray(data) ? data[0] : data;
    return {
      reversal_id: String(row.reversal_id),
      seller_transfer_id: String(row.seller_transfer_id),
      provider_transfer_id: String(row.provider_transfer_id),
      seller_order_id: String(row.seller_order_id),
      order_id: String(row.order_id),
      amount_paise: Number(row.amount_paise),
      already_initiated: Boolean(row.already_initiated),
      provider_reversal_id: row.provider_reversal_id ? String(row.provider_reversal_id) : null,
      reversal_status: String(row.reversal_status),
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
    const { data, error } = await this.client.rpc('finalize_seller_transfer_reversal', {
      p_reversal_id: params.reversalId ?? null,
      p_provider_reversal_id: params.providerReversalId ?? null,
      p_provider_transfer_id: params.providerTransferId ?? null,
      p_next_status: params.nextStatus,
      p_amount_paise: params.amountPaise ?? null,
      p_failure_reason: params.failureReason ?? null,
      p_actor_id: params.actorId ?? null,
      p_metadata: params.metadata ?? {},
    });
    if (error) throw new Error(error.message || 'Unable to finalize Route transfer reversal.');
    const row = Array.isArray(data) ? data[0] : data;
    return {
      reversal_id: String(row.reversal_id),
      seller_transfer_id: String(row.seller_transfer_id),
      reversal_status: String(row.reversal_status),
      transfer_status: String(row.transfer_status),
      already_processed: Boolean(row.already_processed),
    };
  }

  async listPendingTransfersForReconciliation(
    limit = 50
  ): Promise<ReconciliationTransferCandidate[]> {
    const { data, error } = await this.client
      .from('seller_transfers')
      .select(
        'id, provider_transfer_id, seller_order_id, seller_id, amount_paise, status, settlement_status, settlement_id'
      )
      .not('provider_transfer_id', 'is', null)
      .in('status', ['pending', 'created', 'on_hold', 'processed'])
      .neq('settlement_status', 'settled')
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data || []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      provider_transfer_id: String(row.provider_transfer_id),
      seller_order_id: String(row.seller_order_id),
      seller_id: String(row.seller_id),
      amount_paise: Number(row.amount_paise),
      status: String(row.status),
      settlement_status: String(row.settlement_status),
      settlement_id: row.settlement_id ? String(row.settlement_id) : null,
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
    const { error } = await this.client.from('reconciliation_runs').insert({
      run_type: params.runType,
      status: params.status,
      checked_count: params.checkedCount,
      discrepancy_count: params.discrepancyCount,
      summary: params.summary,
      started_by: params.startedBy ?? null,
      completed_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  }
}
