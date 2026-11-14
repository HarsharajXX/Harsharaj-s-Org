import { timingSafeEqualStrings } from '../_shared/crypto.ts';
import {
  corsHeaders,
  jsonResponse,
  type ExpireOrdersEnv,
  type PaymentEdgeRepository,
  type RazorpayApiClient,
  type RazorpayPaymentEntity,
} from '../_shared/types.ts';

async function findCapturedPaymentInRazorpay(
  razorpayClient: RazorpayApiClient,
  attempts: Array<{ provider_order_id: string | null; provider_payment_id: string | null }>
): Promise<{ checked: boolean; capturedPayment: RazorpayPaymentEntity | null }> {
  const providerOrderIds = Array.from(
    new Set(
      attempts
        .map((a) => a.provider_order_id?.trim() || '')
        .filter((id) => id.length > 0)
    )
  );
  const providerPaymentIds = Array.from(
    new Set(
      attempts
        .map((a) => a.provider_payment_id?.trim() || '')
        .filter((id) => id.length > 0)
    )
  );

  if (providerOrderIds.length === 0 && providerPaymentIds.length === 0) {
    return { checked: true, capturedPayment: null };
  }

  let anyCheckSucceeded = false;

  for (const rpOrderId of providerOrderIds) {
    try {
      const payments = await razorpayClient.fetchOrderPayments(rpOrderId);
      anyCheckSucceeded = true;
      const captured = payments.find((p) => p.status === 'captured');
      if (captured) {
        return { checked: true, capturedPayment: captured };
      }
    } catch {
      // Fallback to individual payment ID check if available
    }
  }

  for (const rpPaymentId of providerPaymentIds) {
    try {
      const payment = await razorpayClient.fetchPayment(rpPaymentId);
      anyCheckSucceeded = true;
      if (payment.status === 'captured') {
        return { checked: true, capturedPayment: payment };
      }
    } catch {
      // Track if all checks failed
    }
  }

  return { checked: anyCheckSucceeded, capturedPayment: null };
}

export async function handleExpireOnlineOrders(
  req: Request,
  deps: {
    repo: PaymentEdgeRepository;
    razorpayClient?: RazorpayApiClient | null;
    env: ExpireOrdersEnv;
  }
): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const authHeader = req.headers.get('authorization') || '';
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';
  const cronHeader = (req.headers.get('x-cron-secret') || '').trim();
  const suppliedSecret = cronHeader || bearerToken;

  if (!suppliedSecret) {
    return jsonResponse({ error: 'Unauthorized scheduled job request.' }, 401);
  }

  const authorizedViaCron =
    Boolean(deps.env.cronSecret) &&
    timingSafeEqualStrings(suppliedSecret, deps.env.cronSecret!);
  const authorizedViaServiceRole =
    Boolean(deps.env.serviceRoleKey) &&
    timingSafeEqualStrings(suppliedSecret, deps.env.serviceRoleKey!);

  if (!authorizedViaCron && !authorizedViaServiceRole) {
    return jsonResponse({ error: 'Forbidden scheduled job credentials.' }, 403);
  }

  let targetOrderId: string | null = null;
  try {
    const raw = await req.text();
    if (raw.trim()) {
      const parsed = JSON.parse(raw) as { orderId?: string };
      if (typeof parsed.orderId === 'string' && parsed.orderId.trim()) {
        targetOrderId = parsed.orderId.trim();
      }
    }
  } catch {
    return jsonResponse({ error: 'Invalid JSON request body.' }, 400);
  }

  const candidates = await deps.repo.listExpiredPendingOrders(50);
  const filtered = targetOrderId
    ? candidates.filter((c) => c.order.id === targetOrderId)
    : candidates;

  let releasedCount = 0;
  let reconciledCaptureCount = 0;
  let deferredUnverifiedCount = 0;

  for (const { order, attempts } of filtered) {
    if (deps.razorpayClient && attempts.length > 0) {
      const inspection = await findCapturedPaymentInRazorpay(deps.razorpayClient, attempts);
      if (!inspection.checked) {
        // Do not blindly release inventory if Razorpay verification API was unreachable for an attempted/authorized payment
        deferredUnverifiedCount += 1;
        continue;
      }

      if (
        inspection.capturedPayment &&
        inspection.capturedPayment.amount === order.total_paise &&
        inspection.capturedPayment.currency === order.currency
      ) {
        const rpPay = inspection.capturedPayment;
        await deps.repo.finalizePaymentCapture({
          orderId: order.id,
          providerOrderId: rpPay.order_id,
          providerPaymentId: rpPay.id,
          amountPaise: rpPay.amount,
          currency: rpPay.currency,
          signatureVerified: false,
          apiVerified: true,
          gatewayMethod: rpPay.method ?? null,
          gatewayFeePaise: rpPay.fee ?? 0,
          verificationSource: 'webhook',
        });
        reconciledCaptureCount += 1;
        continue;
      }
    }

    releasedCount += await deps.repo.releaseExpiredOnlineOrderInventory(order.id);
  }

  const executedAt = new Date().toISOString();

  console.info(
    JSON.stringify({
      event: 'razorpay_expire_orders_completed',
      releasedCount,
      reconciledCaptureCount,
      deferredUnverifiedCount,
      scopedOrder: Boolean(targetOrderId),
      executedAt,
    })
  );

  return jsonResponse({
    ok: true,
    releasedCount,
    reconciledCaptureCount,
    deferredUnverifiedCount,
    executedAt,
  });
}
