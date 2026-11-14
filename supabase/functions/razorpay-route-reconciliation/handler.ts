import { timingSafeEqualStrings } from '../_shared/crypto.ts';
import {
  corsHeaders,
  jsonResponse,
  type RazorpayRouteApiClient,
  type RouteEdgeRepository,
  type RouteReconciliationEnv,
} from '../_shared/types.ts';

export async function handleRouteSettlementReconciliation(
  req: Request,
  deps: {
    repo: RouteEdgeRepository;
    razorpayClient: RazorpayRouteApiClient | null;
    env: RouteReconciliationEnv;
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

  const authorizedViaCron =
    Boolean(deps.env.cronSecret) &&
    Boolean(suppliedSecret) &&
    timingSafeEqualStrings(suppliedSecret, deps.env.cronSecret!);
  const authorizedViaServiceRole =
    Boolean(deps.env.serviceRoleKey) &&
    Boolean(suppliedSecret) &&
    timingSafeEqualStrings(suppliedSecret, deps.env.serviceRoleKey!);

  let actorId: string | null = null;
  if (!authorizedViaCron && !authorizedViaServiceRole) {
    if (!bearerToken) {
      return jsonResponse({ error: 'Authentication or scheduled job secret required.' }, 401);
    }
    const actor = await deps.repo.authenticateCustomer(bearerToken);
    if (!actor) {
      return jsonResponse({ error: 'Authentication required.' }, 401);
    }
    const isOpsAdmin = await deps.repo.isOperationsAdmin(actor.id);
    if (!isOpsAdmin) {
      return jsonResponse(
        { error: 'Forbidden: only operations or super administrators may run Route settlement reconciliation.' },
        403
      );
    }
    actorId = actor.id;
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

  let limit = 50;
  try {
    const raw = await req.text();
    if (raw.trim()) {
      const parsed = JSON.parse(raw) as { limit?: number };
      if (Number.isSafeInteger(parsed.limit) && (parsed.limit as number) > 0 && (parsed.limit as number) <= 200) {
        limit = parsed.limit as number;
      }
    }
  } catch {
    return jsonResponse({ error: 'Invalid JSON request body.' }, 400);
  }

  const candidates = await deps.repo.listPendingTransfersForReconciliation(limit);
  let settledCount = 0;
  let processedCount = 0;
  let failedCount = 0;
  let unchangedCount = 0;
  let discrepancyCount = 0;
  const errors: Array<{ transferId: string; error: string }> = [];

  for (const candidate of candidates) {
    try {
      const rpTransfer = await deps.razorpayClient.fetchTransfer(candidate.provider_transfer_id);
      let nextStatus: 'created' | 'on_hold' | 'processed' | 'settled' | 'failed' = 'created';
      let settlementUtr: string | null = null;
      const settlementId = rpTransfer.recipient_settlement_id || candidate.settlement_id || null;

      if (rpTransfer.settlement_status === 'settled') {
        nextStatus = 'settled';
        if (settlementId) {
          try {
            const rpSettlement = await deps.razorpayClient.fetchSettlement(settlementId);
            settlementUtr = rpSettlement.utr || null;
          } catch {
            // Record settled state even if settlement UTR lookup transiently fails
          }
        }
      } else if (rpTransfer.status === 'failed' || rpTransfer.settlement_status === 'failed') {
        nextStatus = 'failed';
      } else if (rpTransfer.on_hold || rpTransfer.settlement_status === 'on_hold') {
        nextStatus = 'on_hold';
      } else if (rpTransfer.status === 'processed') {
        nextStatus = 'processed';
      }

      if (rpTransfer.amount !== candidate.amount_paise) {
        discrepancyCount += 1;
      }

      const finalized = await deps.repo.finalizeSellerRouteTransfer({
        transferId: candidate.id,
        providerTransferId: rpTransfer.id,
        nextStatus,
        settlementId,
        settlementUtr,
        failureReason: rpTransfer.error?.description ?? null,
        errorCode: rpTransfer.error?.code ?? null,
        actorId,
        metadata: { reconciled_via: 'razorpay-route-reconciliation' },
      });

      if (finalized.settlement_status === 'settled') settledCount += 1;
      else if (finalized.transfer_status === 'failed') failedCount += 1;
      else if (finalized.transfer_status === 'processed') processedCount += 1;
      else unchangedCount += 1;
    } catch (err) {
      discrepancyCount += 1;
      errors.push({
        transferId: candidate.id,
        error: err instanceof Error ? err.message : 'Unable to fetch Razorpay transfer status.',
      });
    }
  }

  const runStatus: 'completed' | 'completed_with_discrepancies' =
    discrepancyCount > 0 || errors.length > 0 ? 'completed_with_discrepancies' : 'completed';

  const summary = {
    checkedCount: candidates.length,
    settledCount,
    processedCount,
    failedCount,
    unchangedCount,
    discrepancyCount,
    errors,
  };

  await deps.repo.recordReconciliationRun({
    runType: 'razorpay_transfers',
    status: runStatus,
    checkedCount: candidates.length,
    discrepancyCount,
    summary,
    startedBy: actorId,
  });

  return jsonResponse({
    ok: true,
    status: runStatus,
    ...summary,
    executedAt: new Date().toISOString(),
  });
}
