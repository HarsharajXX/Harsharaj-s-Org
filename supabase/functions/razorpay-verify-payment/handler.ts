import { verifyRazorpayCheckoutSignature } from '../_shared/crypto.ts';
import {
  corsHeaders,
  jsonResponse,
  type PaymentEdgeRepository,
  type RazorpayApiClient,
  type VerifyPaymentEnv,
} from '../_shared/types.ts';

export async function handleVerifyRazorpayPayment(
  req: Request,
  deps: {
    repo: PaymentEdgeRepository;
    razorpayClient: RazorpayApiClient | null;
    env: VerifyPaymentEnv;
  }
): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const authHeader = req.headers.get('authorization') || '';
  const jwt = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  if (!jwt) {
    return jsonResponse({ error: 'Authentication required to verify payment.' }, 401);
  }

  const customer = await deps.repo.authenticateCustomer(jwt);
  if (!customer) {
    return jsonResponse({ error: 'Invalid or expired authentication session.' }, 401);
  }

  if (!deps.env.razorpayKeySecret || !deps.razorpayClient) {
    return jsonResponse(
      { error: 'Razorpay verification credentials are not configured on the server.' },
      503
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Invalid JSON request body.' }, 400);
  }

  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
  const providerOrderId =
    typeof body.providerOrderId === 'string' ? body.providerOrderId.trim() : '';
  const providerPaymentId =
    typeof body.providerPaymentId === 'string' ? body.providerPaymentId.trim() : '';
  const providerSignature =
    typeof body.providerSignature === 'string' ? body.providerSignature.trim() : '';

  if (!orderId || !providerOrderId || !providerPaymentId || !providerSignature) {
    return jsonResponse(
      {
        error:
          'orderId, providerOrderId, providerPaymentId, and providerSignature are all required.',
      },
      400
    );
  }

  const orderSnapshot = await deps.repo.getOrderPaymentSnapshot(orderId);
  if (!orderSnapshot) {
    return jsonResponse({ error: 'Order not found.' }, 404);
  }

  // Strictly block cross-customer verification attempts before inspecting provider state
  if (orderSnapshot.customer_id !== customer.id) {
    return jsonResponse(
      { error: 'You are not authorized to verify payment for this order.' },
      403
    );
  }

  const attemptLookup = await deps.repo.getAttemptByProviderOrderId(providerOrderId);
  if (!attemptLookup || attemptLookup.order.id !== orderSnapshot.id) {
    return jsonResponse(
      { error: 'Razorpay order ID does not match the stored payment attempt for this order.' },
      400
    );
  }

  // Step 1: Verify Razorpay HMAC-SHA256 checkout signature
  const signatureValid = await verifyRazorpayCheckoutSignature({
    providerOrderId,
    providerPaymentId,
    signature: providerSignature,
    keySecret: deps.env.razorpayKeySecret,
  });

  if (!signatureValid) {
    return jsonResponse({ error: 'Invalid Razorpay payment signature.' }, 400);
  }

  // Idempotent return if already captured & API-verified with this payment ID
  if (
    ['paid', 'captured', 'refund_pending', 'refunded', 'partially_refunded'].includes(
      orderSnapshot.payment_status
    ) &&
    attemptLookup.attempt.status === 'captured' &&
    attemptLookup.attempt.provider_payment_id === providerPaymentId &&
    attemptLookup.attempt.api_verified
  ) {
    return jsonResponse({
      verified: true,
      paymentStatus: 'captured',
      orderStatus: orderSnapshot.order_status,
      amountPaise: orderSnapshot.total_paise,
    });
  }

  // Step 2: Independently fetch payment status & amount from Razorpay API
  let rpPayment;
  try {
    rpPayment = await deps.razorpayClient.fetchPayment(providerPaymentId);
  } catch (err) {
    return jsonResponse(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Unable to confirm payment status with Razorpay API.',
      },
      502
    );
  }

  if (rpPayment.order_id !== providerOrderId) {
    return jsonResponse(
      { error: 'Razorpay payment does not belong to the expected Razorpay order.' },
      400
    );
  }

  if (rpPayment.currency !== orderSnapshot.currency) {
    return jsonResponse(
      {
        error: `Currency mismatch: expected ${orderSnapshot.currency}, received ${rpPayment.currency}.`,
      },
      400
    );
  }

  if (rpPayment.amount !== orderSnapshot.total_paise) {
    return jsonResponse(
      {
        error: `Payment amount mismatch: expected ${orderSnapshot.total_paise} paise, received ${rpPayment.amount} paise.`,
      },
      400
    );
  }

  // Step 3: Require actual capture — authorized/created payments stay unfulfilled intermediate state
  if (rpPayment.status === 'authorized' || rpPayment.status === 'created') {
    if (rpPayment.status === 'authorized') {
      await deps.repo.recordPaymentState({
        orderId: orderSnapshot.id,
        providerOrderId,
        providerPaymentId,
        nextStatus: 'authorized',
        signatureVerified: true,
        apiVerified: true,
      });
    }
    return jsonResponse({
      verified: false,
      paymentStatus: rpPayment.status === 'authorized' ? 'authorized' : 'pending',
      orderStatus: orderSnapshot.order_status,
      amountPaise: orderSnapshot.total_paise,
    });
  }

  if (rpPayment.status === 'failed') {
    await deps.repo.recordPaymentState({
      orderId: orderSnapshot.id,
      providerOrderId,
      providerPaymentId,
      nextStatus: 'failed',
      failureCode: rpPayment.error_code ?? 'PAYMENT_FAILED',
      failureReason: rpPayment.error_description ?? 'Payment failed at gateway.',
      signatureVerified: true,
      apiVerified: true,
    });
    return jsonResponse({
      verified: false,
      paymentStatus: 'failed',
      orderStatus: orderSnapshot.order_status,
      amountPaise: orderSnapshot.total_paise,
    });
  }

  if (rpPayment.status !== 'captured') {
    return jsonResponse(
      { error: `Unexpected Razorpay payment status: ${rpPayment.status}.` },
      400
    );
  }

  // Step 4: Guard against confirming orders whose stock reservation was already released
  if (
    orderSnapshot.reservation_released_at !== null ||
    ['expired', 'cancelled'].includes(orderSnapshot.order_status)
  ) {
    const lateResult = await deps.repo.recordLateCaptureAfterExpiry({
      orderId: orderSnapshot.id,
      providerOrderId,
      providerPaymentId,
      amountPaise: rpPayment.amount,
      currency: rpPayment.currency,
      signatureVerified: true,
      apiVerified: true,
    });
    return jsonResponse(
      {
        verified: false,
        paymentStatus: lateResult.payment_status,
        orderStatus: lateResult.order_status,
        requiresRefund: lateResult.requires_refund,
        error:
          'Payment arrived after checkout reservation expired and stock was released. Payment is flagged refund_pending for automated/manual refund.',
      },
      409
    );
  }

  // Step 5: Finalize capture atomically in PostgreSQL
  try {
    const finalized = await deps.repo.finalizePaymentCapture({
      orderId: orderSnapshot.id,
      providerOrderId,
      providerPaymentId,
      amountPaise: rpPayment.amount,
      currency: rpPayment.currency,
      signatureVerified: true,
      apiVerified: true,
      gatewayMethod: rpPayment.method ?? null,
      gatewayFeePaise: rpPayment.fee ?? 0,
      verificationSource: 'verify_endpoint',
    });

    return jsonResponse({
      verified: true,
      paymentStatus: 'captured',
      orderStatus: finalized.order_status,
      amountPaise: orderSnapshot.total_paise,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to finalize captured payment state.';
    const lower = msg.toLowerCase();
    const isExpiredRace =
      lower.includes('expired') || lower.includes('cancelled') || lower.includes('released');
    if (isExpiredRace) {
      const lateResult = await deps.repo
        .recordLateCaptureAfterExpiry({
          orderId: orderSnapshot.id,
          providerOrderId,
          providerPaymentId,
          amountPaise: rpPayment.amount,
          currency: rpPayment.currency,
          signatureVerified: true,
          apiVerified: true,
        })
        .catch(() => null);
      return jsonResponse(
        {
          verified: false,
          paymentStatus: lateResult?.payment_status ?? 'refund_pending',
          orderStatus: lateResult?.order_status ?? orderSnapshot.order_status,
          requiresRefund: true,
          error: msg,
        },
        409
      );
    }

    const isConflict = lower.includes('duplicate') || lower.includes('conflict');
    return jsonResponse(
      {
        error: msg,
        retryable: !isConflict,
      },
      isConflict ? 409 : 503
    );
  }
}
