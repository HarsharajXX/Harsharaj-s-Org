import { sha256Hex, verifyRazorpayWebhookSignature } from '../_shared/crypto.ts';
import { sanitizeWebhookPayload } from '../_shared/supabaseRepo.ts';
import {
  corsHeaders,
  jsonResponse,
  type PaymentEdgeRepository,
  type RazorpayApiClient,
  type WebhookEnv,
} from '../_shared/types.ts';

const SUPPORTED_WEBHOOK_EVENTS = new Set([
  'payment.authorized',
  'payment.captured',
  'payment.failed',
  'order.paid',
]);

export async function handleRazorpayWebhook(
  req: Request,
  deps: {
    repo: PaymentEdgeRepository;
    razorpayClient: RazorpayApiClient | null;
    env: WebhookEnv;
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

  // Read exact raw request body before JSON.parse so signature validation matches byte-for-byte
  const rawBody = await req.text();
  const signature = req.headers.get('x-razorpay-signature') || '';

  const signatureValid = await verifyRazorpayWebhookSignature({
    rawBody,
    signature,
    webhookSecret: deps.env.razorpayWebhookSecret,
  });

  if (!signatureValid) {
    return jsonResponse({ error: 'Invalid Razorpay webhook signature.' }, 401);
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
  const paymentEntity = payloadObj.payment?.entity;
  const orderEntity = payloadObj.order?.entity;

  const providerOrderId =
    (typeof paymentEntity?.order_id === 'string' && paymentEntity.order_id) ||
    (typeof orderEntity?.id === 'string' && orderEntity.id) ||
    null;
  const providerPaymentId =
    (typeof paymentEntity?.id === 'string' && paymentEntity.id) || null;

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
      err instanceof Error ? err.message : 'Temporary database failure recording webhook event.';
    return jsonResponse({ error: safeMsg }, 500);
  }

  if (beginResult.deduplicated) {
    return jsonResponse({
      ok: true,
      deduplicated: true,
      status: beginResult.existingStatus || 'processed',
    });
  }

  if (!SUPPORTED_WEBHOOK_EVENTS.has(eventType)) {
    await deps.repo.completeWebhookEvent({
      eventId,
      status: 'ignored',
      errorMessage: `Unsupported webhook event type for Stage 7.8.2: ${eventType}`,
    });
    return jsonResponse({ ok: true, ignored: true });
  }

  if (!providerOrderId) {
    await deps.repo.completeWebhookEvent({
      eventId,
      status: 'ignored',
      errorMessage: 'Webhook payload missing provider order_id.',
    });
    return jsonResponse({ ok: true, ignored: true });
  }

  try {
    const attemptLookup = await deps.repo.getAttemptByProviderOrderId(providerOrderId);
    if (!attemptLookup) {
      await deps.repo.completeWebhookEvent({
        eventId,
        status: 'ignored',
        errorMessage: 'No matching Nohaj payment attempt found for provider_order_id.',
      });
      return jsonResponse({ ok: true, ignored: true });
    }

    const { order } = attemptLookup;

    if (eventType === 'payment.authorized') {
      const amount = Number(paymentEntity?.amount || 0);
      const currency = String(paymentEntity?.currency || '');
      if (amount !== order.total_paise || currency !== order.currency) {
        await deps.repo.completeWebhookEvent({
          eventId,
          status: 'failed',
          errorMessage: 'Webhook authorized amount/currency mismatch.',
        });
        return jsonResponse({ error: 'Payment amount or currency mismatch.' }, 400);
      }

      const res = await deps.repo.recordPaymentState({
        orderId: order.id,
        providerOrderId,
        providerPaymentId,
        nextStatus: 'authorized',
        signatureVerified: true,
        apiVerified: false,
      });

      await deps.repo.completeWebhookEvent({ eventId, status: 'processed' });
      return jsonResponse({
        ok: true,
        event: eventType,
        ignoredOutOfOrder: res.ignored_out_of_order,
      });
    }

    if (eventType === 'payment.failed') {
      const res = await deps.repo.recordPaymentState({
        orderId: order.id,
        providerOrderId,
        providerPaymentId,
        nextStatus: 'failed',
        failureCode:
          typeof paymentEntity?.error_code === 'string'
            ? paymentEntity.error_code
            : 'WEBHOOK_PAYMENT_FAILED',
        failureReason:
          typeof paymentEntity?.error_description === 'string'
            ? paymentEntity.error_description
            : 'Payment failed.',
        signatureVerified: true,
        apiVerified: false,
      });

      await deps.repo.completeWebhookEvent({ eventId, status: 'processed' });
      return jsonResponse({
        ok: true,
        event: eventType,
        ignoredOutOfOrder: res.ignored_out_of_order,
      });
    }

    // payment.captured or order.paid
    if (!providerPaymentId) {
      await deps.repo.completeWebhookEvent({
        eventId,
        status: 'failed',
        errorMessage: 'Captured/paid webhook missing payment entity ID.',
      });
      return jsonResponse({ error: 'Missing payment entity ID.' }, 400);
    }

    let authoritativeAmount = Number(paymentEntity?.amount ?? orderEntity?.amount_paid ?? 0);
    let authoritativeCurrency = String(paymentEntity?.currency ?? orderEntity?.currency ?? '');
    let authoritativeStatus = String(paymentEntity?.status ?? '');
    let authoritativeMethod =
      typeof paymentEntity?.method === 'string' ? paymentEntity.method : null;
    let authoritativeFee = Number(paymentEntity?.fee || 0);
    let apiVerified = false;

    if (deps.razorpayClient) {
      const rpPayment = await deps.razorpayClient.fetchPayment(providerPaymentId);
      if (rpPayment.order_id !== providerOrderId) {
        await deps.repo.completeWebhookEvent({
          eventId,
          status: 'failed',
          errorMessage: 'Razorpay API order_id mismatch during webhook confirmation.',
        });
        return jsonResponse({ error: 'Payment order_id mismatch.' }, 400);
      }
      authoritativeAmount = rpPayment.amount;
      authoritativeCurrency = rpPayment.currency;
      authoritativeStatus = rpPayment.status;
      authoritativeMethod = rpPayment.method ?? authoritativeMethod;
      authoritativeFee = rpPayment.fee ?? authoritativeFee;
      apiVerified = true;
    }

    if (authoritativeStatus !== 'captured') {
      await deps.repo.completeWebhookEvent({
        eventId,
        status: 'ignored',
        errorMessage: `Payment status is ${authoritativeStatus}, not captured.`,
      });
      return jsonResponse({ ok: true, ignored: true });
    }

    if (authoritativeAmount !== order.total_paise || authoritativeCurrency !== order.currency) {
      await deps.repo.completeWebhookEvent({
        eventId,
        status: 'failed',
        errorMessage: 'Webhook captured amount/currency mismatch against order total.',
      });
      return jsonResponse({ error: 'Payment amount or currency mismatch.' }, 400);
    }

    if (order.reservation_released_at !== null || ['expired', 'cancelled'].includes(order.order_status)) {
      const lateResult = await deps.repo.recordLateCaptureAfterExpiry({
        orderId: order.id,
        providerOrderId,
        providerPaymentId,
        amountPaise: authoritativeAmount,
        currency: authoritativeCurrency,
        signatureVerified: true,
        apiVerified,
      });

      await deps.repo.completeWebhookEvent({
        eventId,
        status: 'processed',
        errorMessage: 'Late capture recorded as refund_pending after reservation expiry.',
      });

      return jsonResponse({
        ok: true,
        event: eventType,
        orderId: lateResult.order_id,
        orderStatus: lateResult.order_status,
        paymentStatus: lateResult.payment_status,
        lateCaptureAfterExpiry: true,
        requiresRefund: lateResult.requires_refund,
      });
    }

    try {
      const finalized = await deps.repo.finalizePaymentCapture({
        orderId: order.id,
        providerOrderId,
        providerPaymentId,
        amountPaise: authoritativeAmount,
        currency: authoritativeCurrency,
        signatureVerified: true,
        apiVerified,
        gatewayMethod: authoritativeMethod,
        gatewayFeePaise: authoritativeFee,
        verificationSource: 'webhook',
      });

      await deps.repo.completeWebhookEvent({ eventId, status: 'processed' });
      return jsonResponse({
        ok: true,
        event: eventType,
        orderId: finalized.order_id,
        alreadyCaptured: finalized.already_captured,
      });
    } catch (finalizeErr) {
      const msg = finalizeErr instanceof Error ? finalizeErr.message : '';
      const lower = msg.toLowerCase();
      if (lower.includes('expired') || lower.includes('cancelled') || lower.includes('released')) {
        const lateResult = await deps.repo.recordLateCaptureAfterExpiry({
          orderId: order.id,
          providerOrderId,
          providerPaymentId,
          amountPaise: authoritativeAmount,
          currency: authoritativeCurrency,
          signatureVerified: true,
          apiVerified,
        });

        await deps.repo.completeWebhookEvent({
          eventId,
          status: 'processed',
          errorMessage: 'Late capture race resolved as refund_pending without restoring confirmation.',
        });

        return jsonResponse({
          ok: true,
          event: eventType,
          orderId: lateResult.order_id,
          orderStatus: lateResult.order_status,
          paymentStatus: lateResult.payment_status,
          lateCaptureAfterExpiry: true,
          requiresRefund: lateResult.requires_refund,
        });
      }
      throw finalizeErr;
    }
  } catch (err) {
    const safeMsg = err instanceof Error ? err.message : 'Webhook processing failed.';
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
