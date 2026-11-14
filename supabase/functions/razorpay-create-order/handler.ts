import {
  corsHeaders,
  jsonResponse,
  type CheckoutItemInput,
  type CreateOrderEnv,
  type PaymentEdgeRepository,
  type RazorpayApiClient,
  type ShippingAddressInput,
} from '../_shared/types.ts';

function normalizeCheckoutItems(rawItems: unknown): CheckoutItemInput[] {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error('Cart must contain at least one item.');
  }

  const merged = new Map<string, CheckoutItemInput>();
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Invalid cart item payload.');
    }
    const item = raw as Record<string, unknown>;
    const productId = typeof item.product_id === 'string' ? item.product_id.trim() : '';
    const variantId =
      typeof item.variant_id === 'string' && item.variant_id.trim().length > 0
        ? item.variant_id.trim()
        : null;
    const quantity = Number(item.quantity);

    if (!productId) {
      throw new Error('Every checkout item must specify a product_id.');
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 100) {
      throw new Error('Item quantity must be a positive integer up to 100.');
    }

    const key = `${productId}::${variantId || ''}`;
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += quantity;
    } else {
      merged.set(key, { product_id: productId, variant_id: variantId, quantity });
    }
  }

  return Array.from(merged.values()).sort((a, b) => {
    if (a.product_id !== b.product_id) return a.product_id < b.product_id ? -1 : 1;
    const va = a.variant_id || '';
    const vb = b.variant_id || '';
    if (va === vb) return 0;
    return va < vb ? -1 : 1;
  });
}

function validateShippingAddress(raw: unknown): ShippingAddressInput {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Shipping address is required.');
  }
  const addr = raw as Record<string, unknown>;
  const full_name = typeof addr.full_name === 'string' ? addr.full_name.trim() : '';
  const email = typeof addr.email === 'string' ? addr.email.trim() : '';
  const phone = typeof addr.phone === 'string' ? addr.phone.trim() : '';
  const line1 = typeof addr.line1 === 'string' ? addr.line1.trim() : '';
  const city = typeof addr.city === 'string' ? addr.city.trim() : '';
  const state = typeof addr.state === 'string' ? addr.state.trim() : undefined;
  const postal_code = typeof addr.postal_code === 'string' ? addr.postal_code.trim() : '';

  if (!full_name || !email || !phone || !line1 || !city || !postal_code) {
    throw new Error('Complete shipping details (name, email, phone, address, city, postal code) are required.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('A valid email address is required.');
  }

  return { full_name, email, phone, line1, city, ...(state ? { state } : {}), postal_code };
}

export async function handleCreateRazorpayOrder(
  req: Request,
  deps: {
    repo: PaymentEdgeRepository;
    razorpayClient: RazorpayApiClient | null;
    env: CreateOrderEnv;
  }
): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 204, headers: corsHeaders });
  }

  if (req.method === 'GET') {
    const hasKeyCredentials = Boolean(
      deps.env.razorpayKeyId && deps.env.razorpayKeySecret && deps.razorpayClient
    );
    const hasWebhookSecret = deps.env.razorpayWebhookSecretConfigured === true;

    let gatewayConfig;
    try {
      gatewayConfig = await deps.repo.getGatewayConfig();
    } catch {
      return jsonResponse({
        onlineCheckoutReady: false,
        provider: 'razorpay',
        mode: 'test',
        routeEnabled: false,
        reason: 'Payment gateway configuration is not available on the server yet.',
      });
    }

    const flagEnabled =
      gatewayConfig.online_payments_enabled === true &&
      gatewayConfig.active_provider === 'razorpay';
    const onlineCheckoutReady = hasKeyCredentials && hasWebhookSecret && flagEnabled;

    let reason: string | undefined;
    if (!hasKeyCredentials) {
      reason = 'Server-side Razorpay API secrets are not configured.';
    } else if (!hasWebhookSecret) {
      reason = 'Server-side Razorpay webhook verification secret is not configured.';
    } else if (!flagEnabled) {
      reason = 'Online payments are currently disabled pending staging verification.';
    }

    return jsonResponse({
      onlineCheckoutReady,
      provider: gatewayConfig.active_provider,
      mode: gatewayConfig.razorpay_mode,
      routeEnabled: gatewayConfig.razorpay_route_enabled,
      ...(reason ? { reason } : {}),
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const authHeader = req.headers.get('authorization') || '';
  const jwt = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  if (!jwt) {
    return jsonResponse({ error: 'Authentication required for online checkout.' }, 401);
  }

  const customer = await deps.repo.authenticateCustomer(jwt);
  if (!customer) {
    return jsonResponse({ error: 'Invalid or expired authentication session.' }, 401);
  }

  if (
    !deps.env.razorpayKeyId ||
    !deps.env.razorpayKeySecret ||
    deps.env.razorpayWebhookSecretConfigured === false ||
    !deps.razorpayClient
  ) {
    return jsonResponse(
      { error: 'Online payment gateway credentials are not configured on the server.' },
      503
    );
  }

  let gatewayConfig;
  try {
    gatewayConfig = await deps.repo.getGatewayConfig();
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Unable to read payment gateway configuration.' },
      500
    );
  }

  if (!gatewayConfig.online_payments_enabled || gatewayConfig.active_provider !== 'razorpay') {
    return jsonResponse(
      { error: 'Online payments are currently disabled. Please use Cash on Delivery.' },
      503
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Invalid JSON request body.' }, 400);
  }

  let shippingAddress: ShippingAddressInput;
  let items: CheckoutItemInput[];
  try {
    shippingAddress = validateShippingAddress(body.shippingAddress);
    items = normalizeCheckoutItems(body.items);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Invalid checkout input.' }, 400);
  }

  const idempotencyKey =
    typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  if (!idempotencyKey || idempotencyKey.length < 6 || idempotencyKey.length > 128) {
    return jsonResponse({ error: 'A valid checkout idempotencyKey is required.' }, 400);
  }
  const retryAttempt = body.retryAttempt === true;

  // Authoritative server-side inventory reservation & price calculation in PostgreSQL.
  // Any browser-provided totals, prices, customer IDs, or commissions are strictly ignored.
  let reservation;
  try {
    reservation = await deps.repo.reserveOnlineOrderInventory({
      customerId: customer.id,
      shippingAddress,
      items,
      idempotencyKey,
    });
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Unable to reserve inventory for checkout.' },
      400
    );
  }

  const snapshot = await deps.repo.getOrderPaymentSnapshot(reservation.order_id);
  if (!snapshot) {
    return jsonResponse({ error: 'Reserved order snapshot could not be loaded.' }, 500);
  }

  if (['paid', 'captured', 'refund_pending', 'refunded', 'partially_refunded'].includes(snapshot.payment_status)) {
    return jsonResponse({ error: 'This checkout order has already been paid.' }, 409);
  }

  const expiresAtMs = snapshot.reservation_expires_at
    ? Date.parse(snapshot.reservation_expires_at)
    : Date.parse(reservation.reservation_expires_at);
  if (
    snapshot.reservation_released_at !== null ||
    ['expired', 'cancelled'].includes(snapshot.order_status) ||
    (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now())
  ) {
    await deps.repo.releaseExpiredOnlineOrderInventory(reservation.order_id).catch(() => 0);
    return jsonResponse(
      { error: 'This checkout reservation has expired. Please start a fresh checkout.' },
      409
    );
  }

  const existingAttempts = await deps.repo.listOrderAttempts(reservation.order_id);
  const openAttempt = existingAttempts.find(
    (attempt) =>
      ['created', 'pending', 'authorized'].includes(attempt.status) &&
      Boolean(attempt.provider_order_id)
  );

  if (openAttempt && openAttempt.provider_order_id && !retryAttempt) {
    return jsonResponse({
      orderId: reservation.order_id,
      orderNumber: reservation.order_number,
      paymentId: openAttempt.payment_id,
      attemptId: openAttempt.id,
      provider: 'razorpay',
      providerOrderId: openAttempt.provider_order_id,
      amountPaise: reservation.total_paise,
      currency: reservation.currency,
      publicKeyId: deps.env.razorpayKeyId,
      reservationExpiresAt: reservation.reservation_expires_at,
      reusedExisting: true,
    });
  }

  // Create a Razorpay Order strictly using DB-authoritative paise amount
  let rpOrder;
  try {
    rpOrder = await deps.razorpayClient.createOrder({
      amountPaise: reservation.total_paise,
      currency: 'INR',
      receipt: reservation.order_number,
      notes: {
        nohaj_order_id: reservation.order_id,
        order_number: reservation.order_number,
      },
    });
  } catch (err) {
    const failureReason = err instanceof Error ? err.message : 'Razorpay order creation failed.';
    await deps.repo
      .recordCreateOrderFailure({
        orderId: reservation.order_id,
        customerId: customer.id,
        amountPaise: reservation.total_paise,
        idempotencyKey,
        failureCode: 'RAZORPAY_ORDER_CREATE_FAILED',
        failureReason,
      })
      .catch(() => undefined);

    return jsonResponse(
      {
        error: 'Unable to initialize online payment with Razorpay right now. Your reservation remains held briefly so you can retry.',
        orderId: reservation.order_id,
        reservationExpiresAt: reservation.reservation_expires_at,
        retryable: true,
      },
      502
    );
  }

  if (!rpOrder?.id || rpOrder.amount !== reservation.total_paise || rpOrder.currency !== 'INR') {
    return jsonResponse(
      { error: 'Razorpay returned mismatched order parameters.' },
      502
    );
  }

  const registered = await deps.repo.registerPaymentAttempt({
    orderId: reservation.order_id,
    customerId: customer.id,
    providerOrderId: rpOrder.id,
    amountPaise: reservation.total_paise,
    currency: 'INR',
    idempotencyKey,
    expiresAt: reservation.reservation_expires_at,
    metadata: {
      receipt: reservation.order_number,
      razorpay_status: rpOrder.status,
    },
  });

  return jsonResponse({
    orderId: reservation.order_id,
    orderNumber: reservation.order_number,
    paymentId: registered.payment_id,
    attemptId: registered.attempt_id,
    provider: 'razorpay',
    providerOrderId: rpOrder.id,
    amountPaise: reservation.total_paise,
    currency: 'INR',
    publicKeyId: deps.env.razorpayKeyId,
    reservationExpiresAt: reservation.reservation_expires_at,
    reusedExisting: reservation.reused_existing,
  });
}
