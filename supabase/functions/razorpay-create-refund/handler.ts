import { RazorpayApiError } from '../_shared/razorpayClient.ts';
import {
  corsHeaders,
  jsonResponse,
  type CreateRefundEnv,
  type RazorpayRefundApiClient,
  type RefundEdgeRepository,
  type RefundItemReservationInput,
} from '../_shared/types.ts';

function normalizeRefundItems(raw: unknown): RefundItemReservationInput[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('Refund items array cannot be empty when provided.');
  }
  const merged = new Map<string, number>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Invalid refund item payload.');
    }
    const obj = entry as Record<string, unknown>;
    const orderItemId = typeof obj.order_item_id === 'string' ? obj.order_item_id.trim() : '';
    const qty = Number(obj.quantity);
    if (!orderItemId) {
      throw new Error('Every refund item must specify order_item_id.');
    }
    if (!Number.isSafeInteger(qty) || qty <= 0 || qty > 100) {
      throw new Error('Refund item quantity must be a positive integer.');
    }
    merged.set(orderItemId, (merged.get(orderItemId) || 0) + qty);
  }
  return Array.from(merged.entries()).map(([order_item_id, quantity]) => ({
    order_item_id,
    quantity,
  }));
}

export async function handleCreateRazorpayRefund(
  req: Request,
  deps: {
    repo: RefundEdgeRepository;
    razorpayClient: RazorpayRefundApiClient | null;
    env: CreateRefundEnv;
  }
): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  if (!deps.env.razorpayKeyId || !deps.env.razorpayKeySecret || !deps.razorpayClient) {
    return jsonResponse(
      { error: 'Razorpay refund credentials are not configured on the server.' },
      503
    );
  }

  const authHeader = req.headers.get('authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  const actor = await deps.repo.authenticateCustomer(jwt);
  if (!actor) {
    return jsonResponse({ error: 'Authentication required to initiate refunds.' }, 401);
  }

  const isAuthorizedAdmin = await deps.repo.isOperationsAdmin(actor.id);
  if (!isAuthorizedAdmin) {
    return jsonResponse(
      { error: 'Forbidden: only operations or super administrators may initiate Razorpay refunds.' },
      403
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Invalid JSON request body.' }, 400);
  }

  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
  const refundId =
    typeof body.refundId === 'string' && body.refundId.trim() ? body.refundId.trim() : null;
  const sellerOrderId =
    typeof body.sellerOrderId === 'string' && body.sellerOrderId.trim()
      ? body.sellerOrderId.trim()
      : null;
  const idempotencyKey =
    typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  const reason =
    typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim()
      : 'Admin approved refund';
  const internalNotes =
    typeof body.internalNotes === 'string' && body.internalNotes.trim()
      ? body.internalNotes.trim()
      : null;
  const speed = body.speed === 'optimum' ? 'optimum' : 'normal';

  let amountPaise: number | null = null;
  if (body.amountPaise !== undefined && body.amountPaise !== null) {
    const num = Number(body.amountPaise);
    if (!Number.isSafeInteger(num) || num <= 0) {
      return jsonResponse({ error: 'amountPaise must be a positive integer.' }, 400);
    }
    amountPaise = num;
  }

  let shippingRefundPaise = 0;
  if (body.shippingRefundPaise !== undefined && body.shippingRefundPaise !== null) {
    const sNum = Number(body.shippingRefundPaise);
    if (!Number.isSafeInteger(sNum) || sNum < 0) {
      return jsonResponse({ error: 'shippingRefundPaise must be a non-negative integer.' }, 400);
    }
    shippingRefundPaise = sNum;
  }

  if (!orderId) {
    return jsonResponse({ error: 'orderId is required.' }, 400);
  }
  if (!idempotencyKey || idempotencyKey.length < 6) {
    return jsonResponse({ error: 'A valid idempotencyKey is required.' }, 400);
  }

  let items: RefundItemReservationInput[] | null = null;
  try {
    items = normalizeRefundItems(body.items);
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Invalid refund items.' },
      400
    );
  }

  let reserved;
  try {
    reserved = await deps.repo.reserveOnlineRefund({
      actorId: actor.id,
      orderId,
      refundId,
      sellerOrderId,
      items,
      amountPaise,
      shippingRefundPaise,
      reason,
      idempotencyKey,
      internalNotes,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to reserve refund.';
    const lower = msg.toLowerCase();
    const status =
      lower.includes('not found')
        ? 404
        : lower.includes('forbidden') || lower.includes('authorized')
          ? 403
          : 400;
    return jsonResponse({ error: msg }, status);
  }

  if (reserved.already_initiated) {
    return jsonResponse({
      refundId: reserved.refund_id,
      orderId: reserved.order_id,
      providerRefundId: reserved.provider_refund_id,
      amountPaise: reserved.amount_paise,
      currency: reserved.currency,
      status: reserved.refund_status,
      idempotentReplay: true,
    });
  }

  try {
    const rpRefund = await deps.razorpayClient.createRefund(reserved.provider_payment_id, {
      amountPaise: reserved.amount_paise,
      speed,
      receipt: `rfnd_${reserved.refund_id.slice(0, 24)}`,
      notes: {
        nohaj_refund_id: reserved.refund_id,
        nohaj_order_id: reserved.order_id,
        idempotency_key: idempotencyKey.slice(0, 120),
      },
    });

    const mappedStatus: 'pending' | 'processed' | 'failed' =
      rpRefund.status === 'processed'
        ? 'processed'
        : rpRefund.status === 'failed'
          ? 'failed'
          : 'pending';

    const finalized = await deps.repo.finalizeOnlineRefundState({
      refundId: reserved.refund_id,
      providerRefundId: rpRefund.id,
      providerPaymentId: reserved.provider_payment_id,
      nextStatus: mappedStatus,
      amountPaise: rpRefund.amount,
      failureReason: rpRefund.error_description || null,
      actorId: actor.id,
      metadata: {
        speed_processed: rpRefund.speed_processed || null,
        speed_requested: rpRefund.speed_requested || speed,
        razorpay_status: rpRefund.status,
      },
    });

    return jsonResponse({
      refundId: finalized.refund_id,
      orderId: finalized.order_id,
      providerRefundId: rpRefund.id,
      amountPaise: reserved.amount_paise,
      currency: reserved.currency,
      status: finalized.refund_status,
      orderPaymentStatus: finalized.order_payment_status,
      idempotentReplay: false,
    });
  } catch (err) {
    const isClientRejection =
      err instanceof RazorpayApiError && err.statusCode >= 400 && err.statusCode < 500;
    const msg = err instanceof Error ? err.message : 'Razorpay refund request failed.';

    if (isClientRejection) {
      await deps.repo
        .finalizeOnlineRefundState({
          refundId: reserved.refund_id,
          providerPaymentId: reserved.provider_payment_id,
          nextStatus: 'failed',
          failureReason: msg,
          actorId: actor.id,
          metadata: {
            gateway_rejected: true,
            error_code: err instanceof RazorpayApiError ? err.code : 'RAZORPAY_4XX',
          },
        })
        .catch(() => undefined);

      return jsonResponse(
        {
          error: msg,
          refundId: reserved.refund_id,
          status: 'failed',
          recoverable: true,
        },
        400
      );
    }

    // Timeout / transient 5xx: keep refund record in 'pending' (processing) so
    // idempotent replays or Razorpay refund webhooks reconcile without double-issuing.
    await deps.repo
      .finalizeOnlineRefundState({
        refundId: reserved.refund_id,
        providerPaymentId: reserved.provider_payment_id,
        nextStatus: 'pending',
        actorId: actor.id,
        metadata: {
          gateway_timeout_or_transient_error: true,
          last_error: msg,
        },
      })
      .catch(() => undefined);

    return jsonResponse(
      {
        error: 'Razorpay refund gateway timed out or returned a transient error; refund remains recoverable in pending state.',
        refundId: reserved.refund_id,
        status: 'pending',
        recoverable: true,
      },
      504
    );
  }
}
