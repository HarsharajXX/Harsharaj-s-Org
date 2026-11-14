import { sha256Hex, verifyRazorpayWebhookSignature } from '../_shared/crypto.ts';
import { sanitizeWebhookPayload } from '../_shared/supabaseRepo.ts';
import {
  corsHeaders,
  jsonResponse,
  type RazorpayRefundApiClient,
  type RefundEdgeRepository,
  type RefundWebhookEnv,
} from '../_shared/types.ts';

const SUPPORTED_REFUND_EVENTS = new Set([
  'refund.created',
  'refund.processed',
  'refund.failed',
  'refund.speed_changed',
]);

export async function handleRazorpayRefundWebhook(
  req: Request,
  deps: {
    repo: RefundEdgeRepository;
    razorpayClient: RazorpayRefundApiClient | null;
    env: RefundWebhookEnv;
  }
): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  if (!deps.env.razorpayWebhookSecret) {
    return jsonResponse({ error: 'Webhook verification secret not configured.' }, 503);
  }

  const rawBody = await req.text();
  const signature = req.headers.get('x-razorpay-signature') || '';

  const signatureValid = await verifyRazorpayWebhookSignature({
    rawBody,
    signature,
    webhookSecret: deps.env.razorpayWebhookSecret,
  });

  if (!signatureValid) {
    return jsonResponse({ error: 'Invalid Razorpay refund webhook signature.' }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Invalid webhook JSON payload.' }, 400);
  }

  const eventType = typeof payload.event === 'string' ? payload.event : '';
  const eventIdHeader = req.headers.get('x-razorpay-event-id') || '';
  const eventId =
    eventIdHeader.trim() ||
    (typeof payload.id === 'string' && payload.id.trim()) ||
    `sha256:${await sha256Hex(rawBody)}`;

  const payloadObj = (payload.payload || {}) as Record<
    string,
    { entity?: Record<string, unknown> }
  >;
  const refundEntity = payloadObj.refund?.entity;
  const paymentEntity = payloadObj.payment?.entity;

  const providerRefundId =
    typeof refundEntity?.id === 'string' ? refundEntity.id.trim() : null;
  const providerPaymentId =
    (typeof refundEntity?.payment_id === 'string' && refundEntity.payment_id.trim()) ||
    (typeof paymentEntity?.id === 'string' && paymentEntity.id.trim()) ||
    null;
  const providerOrderId =
    typeof paymentEntity?.order_id === 'string' ? paymentEntity.order_id.trim() : null;

  let beginResult;
  try {
    beginResult = await deps.repo.beginWebhookEvent({
      eventId,
      eventType,
      providerOrderId,
      providerPaymentId,
      signatureValid: true,
      safePayload: sanitizeWebhookPayload(payload),
    });
  } catch (err) {
    const safeMsg =
      err instanceof Error ? err.message : 'Unable to record webhook deduplication event.';
    return jsonResponse({ error: safeMsg }, 500);
  }

  if (beginResult.deduplicated) {
    return jsonResponse({
      ok: true,
      deduplicated: true,
      status: beginResult.existingStatus || 'processed',
    });
  }

  if (!SUPPORTED_REFUND_EVENTS.has(eventType)) {
    await deps.repo.completeWebhookEvent({
      eventId,
      status: 'ignored',
      errorMessage: `Unsupported refund webhook event: ${eventType}`,
    });
    return jsonResponse({ ok: true, ignored: true });
  }

  if (!providerRefundId) {
    await deps.repo.completeWebhookEvent({
      eventId,
      status: 'failed',
      errorMessage: 'Refund webhook payload missing refund.entity.id.',
    });
    return jsonResponse({ error: 'Missing refund entity ID.' }, 400);
  }

  try {
    let authoritativeAmount = Number(refundEntity?.amount || 0);
    let authoritativeStatus = String(refundEntity?.status || '');
    let authoritativePaymentId = providerPaymentId;
    let speedProcessed =
      typeof refundEntity?.speed_processed === 'string'
        ? refundEntity.speed_processed
        : null;
    const notes = (refundEntity?.notes || {}) as Record<string, unknown>;
    let failureReason =
      typeof refundEntity?.error_description === 'string'
        ? refundEntity.error_description
        : null;

    if (deps.razorpayClient) {
      const rpRefund = await deps.razorpayClient.fetchRefund(providerRefundId);
      authoritativeAmount = rpRefund.amount;
      authoritativeStatus = rpRefund.status;
      authoritativePaymentId = rpRefund.payment_id || authoritativePaymentId;
      speedProcessed = rpRefund.speed_processed ?? speedProcessed;
      failureReason = rpRefund.error_description ?? failureReason;
    }

    let matchedRefund = await deps.repo.getRefundRecordByProviderRefundId(providerRefundId);
    if (!matchedRefund && typeof notes.nohaj_refund_id === 'string' && notes.nohaj_refund_id.trim()) {
      matchedRefund = await deps.repo.getRefundRecordById(notes.nohaj_refund_id.trim());
    }

    if (!matchedRefund) {
      await deps.repo.completeWebhookEvent({
        eventId,
        status: 'ignored',
        errorMessage: `No local refund_records row matched Razorpay refund ${providerRefundId}.`,
      });
      return jsonResponse({ ok: true, ignored: true });
    }

    if (eventType === 'refund.speed_changed') {
      await deps.repo.completeWebhookEvent({
        eventId,
        status: 'processed',
      });
      return jsonResponse({
        ok: true,
        event: eventType,
        refundId: matchedRefund.id,
        speedProcessed,
      });
    }

    const mappedNextStatus: 'pending' | 'processed' | 'failed' =
      eventType === 'refund.processed' || authoritativeStatus === 'processed'
        ? 'processed'
        : eventType === 'refund.failed' || authoritativeStatus === 'failed'
          ? 'failed'
          : 'pending';

    const finalized = await deps.repo.finalizeOnlineRefundState({
      refundId: matchedRefund.id,
      providerRefundId,
      providerPaymentId: authoritativePaymentId,
      nextStatus: mappedNextStatus,
      amountPaise: authoritativeAmount > 0 ? authoritativeAmount : null,
      failureReason:
        mappedNextStatus === 'failed'
          ? failureReason || 'Razorpay reported refund failure.'
          : null,
      metadata: {
        webhook_event: eventType,
        webhook_event_id: eventId,
        speed_processed: speedProcessed,
      },
    });

    await deps.repo.completeWebhookEvent({
      eventId,
      status: 'processed',
    });

    return jsonResponse({
      ok: true,
      event: eventType,
      refundId: finalized.refund_id,
      orderId: finalized.order_id,
      refundStatus: finalized.refund_status,
      orderPaymentStatus: finalized.order_payment_status,
      alreadyProcessed: finalized.already_processed,
      ignoredOutOfOrder: finalized.ignored_out_of_order,
    });
  } catch (err) {
    const safeMsg = err instanceof Error ? err.message : 'Refund webhook processing failed.';
    await deps.repo
      .completeWebhookEvent({
        eventId,
        status: 'failed',
        errorMessage: safeMsg,
      })
      .catch(() => undefined);

    return jsonResponse({ error: safeMsg }, 500);
  }
}
