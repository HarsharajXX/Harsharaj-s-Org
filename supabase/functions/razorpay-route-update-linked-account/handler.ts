import { RazorpayApiError } from '../_shared/razorpayClient.ts';
import {
  corsHeaders,
  jsonResponse,
  type RazorpayRouteApiClient,
  type RouteApiEnv,
  type RouteEdgeRepository,
} from '../_shared/types.ts';

export async function handleUpdateRouteLinkedAccount(
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
      { error: 'Forbidden: only operations or super administrators may update Razorpay Linked Accounts.' },
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
    return jsonResponse({ error: 'Seller settlement account not found.' }, 404);
  }

  if (!settlementAccount.razorpay_linked_account_id) {
    return jsonResponse(
      { error: 'Seller does not yet have a Razorpay Linked Account ID. Create it first.' },
      400
    );
  }

  const linkedAccountId = settlementAccount.razorpay_linked_account_id;
  const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim() : undefined;
  const phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : undefined;
  const legalBusinessName =
    typeof body.legalBusinessName === 'string' && body.legalBusinessName.trim()
      ? body.legalBusinessName.trim()
      : undefined;
  const contactName =
    typeof body.contactName === 'string' && body.contactName.trim()
      ? body.contactName.trim()
      : undefined;
  const gstin = typeof body.gstin === 'string' && body.gstin.trim() ? body.gstin.trim().toUpperCase() : undefined;
  const pan = typeof body.pan === 'string' && body.pan.trim() ? body.pan.trim().toUpperCase() : undefined;
  const bankAccountNumber =
    typeof body.bankAccountNumber === 'string' && body.bankAccountNumber.trim()
      ? body.bankAccountNumber.trim()
      : undefined;
  const ifscCode =
    typeof body.bankIfsc === 'string' && body.bankIfsc.trim()
      ? body.bankIfsc.trim().toUpperCase()
      : settlementAccount.bank_ifsc || undefined;
  const beneficiaryName =
    typeof body.beneficiaryName === 'string' && body.beneficiaryName.trim()
      ? body.beneficiaryName.trim()
      : settlementAccount.beneficiary_name || undefined;

  try {
    let rawActivationStatus = settlementAccount.razorpay_raw_activation_status || 'under_review';
    let productId = settlementAccount.razorpay_product_id;
    let requirements: unknown[] | null = null;

    if (email || phone || legalBusinessName || contactName || pan || gstin) {
      const updatedAccount = await deps.razorpayClient.updateLinkedAccount(linkedAccountId, {
        email,
        phone,
        legalBusinessName,
        contactName,
        pan,
        gstin,
      });
      rawActivationStatus = updatedAccount.status || rawActivationStatus;
    }

    if (!productId && (bankAccountNumber || body.requestProduct)) {
      const product = await deps.razorpayClient.requestRouteProduct(linkedAccountId, {
        tncAccepted: true,
      });
      productId = product.id;
      rawActivationStatus = product.activation_status || rawActivationStatus;
      requirements = product.requirements || null;
    }

    if (productId && (bankAccountNumber || ifscCode || beneficiaryName)) {
      if (bankAccountNumber) {
        const updatedProduct = await deps.razorpayClient.updateRouteProduct(linkedAccountId, productId, {
          accountNumber: bankAccountNumber,
          ifscCode,
          beneficiaryName,
          tncAccepted: true,
        });
        rawActivationStatus = updatedProduct.activation_status || rawActivationStatus;
        requirements = updatedProduct.requirements || requirements;
      } else {
        const fetchedProduct = await deps.razorpayClient.fetchRouteProduct(linkedAccountId, productId);
        rawActivationStatus = fetchedProduct.activation_status || rawActivationStatus;
        requirements = fetchedProduct.requirements || requirements;
      }
    } else if (productId) {
      const fetchedProduct = await deps.razorpayClient.fetchRouteProduct(linkedAccountId, productId);
      rawActivationStatus = fetchedProduct.activation_status || rawActivationStatus;
      requirements = fetchedProduct.requirements || requirements;
    } else {
      const fetchedAccount = await deps.razorpayClient.fetchLinkedAccount(linkedAccountId);
      rawActivationStatus = fetchedAccount.status || rawActivationStatus;
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
    });
  } catch (err) {
    const status = err instanceof RazorpayApiError && err.statusCode >= 400 && err.statusCode < 500 ? 400 : 502;
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Unable to update Razorpay Linked Account.' },
      status
    );
  }
}
