import { RazorpayApiError } from '../_shared/razorpayClient.ts';
import {
  corsHeaders,
  jsonResponse,
  type RazorpayRouteApiClient,
  type RouteApiEnv,
  type RouteEdgeRepository,
} from '../_shared/types.ts';

function normalizePan(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw.trim().toUpperCase();
  if (!cleaned) return undefined;
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(cleaned)) {
    throw new Error('Full 10-character PAN (e.g., ABCDE1234F) is required when transmitting to Razorpay.');
  }
  return cleaned;
}

export async function handleCreateRouteLinkedAccount(
  req: Request,
  deps: {
    repo: RouteEdgeRepository;
    razorpayClient: RazorpayRouteApiClient | null;
    env: RouteApiEnv;
  }
): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const authHeader = req.headers.get('authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  const actor = await deps.repo.authenticateCustomer(jwt);
  if (!actor) {
    return jsonResponse({ error: 'Authentication required.' }, 401);
  }

  const isOpsAdmin = await deps.repo.isOperationsAdmin(actor.id);
  if (!isOpsAdmin) {
    return jsonResponse(
      { error: 'Forbidden: only operations or super administrators may manage Razorpay Linked Accounts.' },
      403
    );
  }

  if (!deps.env.razorpayRouteEnabled) {
    return jsonResponse(
      { error: 'Razorpay Route is disabled by server configuration (RAZORPAY_ROUTE_ENABLED=false).' },
      503
    );
  }

  const gatewayConfig = await deps.repo.getGatewayConfig();
  if (!gatewayConfig.razorpay_route_enabled || gatewayConfig.route_approval_status !== 'approved') {
    return jsonResponse(
      { error: 'Razorpay Route is not approved or enabled in payment gateway configuration.' },
      503
    );
  }

  if (!deps.env.razorpayKeyId || !deps.env.razorpayKeySecret || !deps.razorpayClient) {
    return jsonResponse({ error: 'Razorpay server credentials are not configured.' }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Invalid JSON request body.' }, 400);
  }

  const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
  const sellerId = typeof body.sellerId === 'string' ? body.sellerId.trim() : '';

  if (!accountId && !sellerId) {
    return jsonResponse({ error: 'accountId or sellerId is required.' }, 400);
  }

  const settlementAccount = accountId
    ? await deps.repo.getSellerSettlementAccountById(accountId)
    : await deps.repo.getSellerSettlementAccountBySellerId(sellerId);

  if (!settlementAccount) {
    return jsonResponse({ error: 'Seller settlement onboarding record not found.' }, 404);
  }

  if (!settlementAccount.seller_consent_accepted || !settlementAccount.agreement_accepted) {
    return jsonResponse(
      { error: 'Seller consent and settlement agreement acceptance are required before Linked Account creation.' },
      400
    );
  }

  let pan: string | undefined;
  try {
    pan = normalizePan(body.pan);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Invalid PAN format.' }, 400);
  }

  const bankAccountNumber =
    typeof body.bankAccountNumber === 'string' && body.bankAccountNumber.trim()
      ? body.bankAccountNumber.trim()
      : undefined;
  const ifscCode =
    (typeof body.bankIfsc === 'string' && body.bankIfsc.trim().toUpperCase()) ||
    settlementAccount.bank_ifsc ||
    undefined;
  const beneficiaryName =
    (typeof body.beneficiaryName === 'string' && body.beneficiaryName.trim()) ||
    settlementAccount.beneficiary_name ||
    settlementAccount.legal_business_name;

  try {
    let linkedAccountId = settlementAccount.razorpay_linked_account_id;
    let productId = settlementAccount.razorpay_product_id;
    let rawActivationStatus = settlementAccount.razorpay_raw_activation_status || 'under_review';
    let requirements: unknown[] | null = null;
    let idempotentReplay = false;

    if (linkedAccountId) {
      idempotentReplay = true;
      const fetched = await deps.razorpayClient.fetchLinkedAccount(linkedAccountId);
      rawActivationStatus = fetched.status || rawActivationStatus;
    } else {
      const created = await deps.razorpayClient.createLinkedAccount({
        email: settlementAccount.contact_email,
        phone: settlementAccount.contact_phone,
        legalBusinessName: settlementAccount.legal_business_name,
        businessType: settlementAccount.business_type || 'individual',
        contactName: settlementAccount.contact_name,
        referenceId: settlementAccount.seller_id,
        pan,
        gstin: settlementAccount.gstin || undefined,
        registeredAddress: settlementAccount.registered_address || null,
      });
      linkedAccountId = created.id;
      rawActivationStatus = created.status || 'created';
    }

    if (!productId) {
      const product = await deps.razorpayClient.requestRouteProduct(linkedAccountId, {
        tncAccepted: true,
      });
      productId = product.id;
      rawActivationStatus = product.activation_status || rawActivationStatus;
      requirements = product.requirements || null;
    }

    if (bankAccountNumber && ifscCode && productId) {
      const updatedProduct = await deps.razorpayClient.updateRouteProduct(linkedAccountId, productId, {
        accountNumber: bankAccountNumber,
        ifscCode,
        beneficiaryName,
        tncAccepted: true,
      });
      rawActivationStatus = updatedProduct.activation_status || rawActivationStatus;
      requirements = updatedProduct.requirements || requirements;
    } else if (productId) {
      const latestProduct = await deps.razorpayClient.fetchRouteProduct(linkedAccountId, productId);
      rawActivationStatus = latestProduct.activation_status || rawActivationStatus;
      requirements = latestProduct.requirements || requirements;
    }

    const synced = await deps.repo.syncLinkedAccountFromRoute({
      accountId: settlementAccount.id,
      linkedAccountId,
      productId,
      rawActivationStatus,
      kycRequirements: requirements,
      actorId: actor.id,
    });

    return jsonResponse({
      account: synced,
      linkedAccountId: synced.razorpay_linked_account_id,
      productId: synced.razorpay_product_id,
      routeOnboardingStatus: synced.route_onboarding_status,
      payoutsEnabled: synced.payouts_enabled,
      idempotentReplay,
    });
  } catch (err) {
    const status = err instanceof RazorpayApiError && err.statusCode >= 400 && err.statusCode < 500 ? 400 : 502;
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Unable to create Razorpay Linked Account.' },
      status
    );
  }
}
