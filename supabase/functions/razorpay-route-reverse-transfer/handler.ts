import { RazorpayApiError } from '../_shared/razorpayClient.ts';
import {
  corsHeaders,
  jsonResponse,
  type RazorpayRouteApiClient,
  type RouteApiEnv,
  type RouteEdgeRepository,
} from '../_shared/types.ts';

export async function handleReverseRouteTransfer(
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
      { error: 'Forbidden: only operations or super administrators may reverse Route transfers.' },
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

  const transferId = typeof body.transferId === 'string' ? body.transferId.trim() : '';
  const refundId =
    typeof body.refundId === 'string' && body.refundId.trim() ? body.refundId.trim() : null;
  const idempotencyKey =
    typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  const reason =
    typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim()
      : 'Admin initiated refund reversal';

  let amountPaise: number | null = null;
  if (body.amountPaise !== undefined && body.amountPaise !== null) {
    const num = Number(body.amountPaise);
    if (!Number.isSafeInteger(num) || num <= 0) {
      return jsonResponse({ error: 'amountPaise must be a positive integer.' }, 400);
    }
    amountPaise = num;
  }

  if (!transferId) {
    return jsonResponse({ error: 'transferId is required.' }, 400);
  }
  if (!idempotencyKey || idempotencyKey.length < 6) {
    return jsonResponse({ error: 'A valid idempotencyKey is required.' }, 400);
  }

  let reserved;
  try {
    reserved = await deps.repo.reserveSellerTransferReversal({
      actorId: actor.id,
      transferId,
      amountPaise,
      refundId,
      reason,
      idempotencyKey,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to reserve Route transfer reversal.';
    const lower = msg.toLowerCase();
    const status = lower.includes('not found') ? 404 : lower.includes('forbidden') ? 403 : 400;
    return jsonResponse({ error: msg }, status);
  }

  if (reserved.already_initiated) {
    return jsonResponse({
      reversalId: reserved.reversal_id,
      sellerTransferId: reserved.seller_transfer_id,
      providerReversalId: reserved.provider_reversal_id,
      amountPaise: reserved.amount_paise,
      status: reserved.reversal_status,
      idempotentReplay: true,
    });
  }

  try {
    const rpReversal = await deps.razorpayClient.reverseTransfer(reserved.provider_transfer_id, {
      amountPaise: reserved.amount_paise,
      notes: {
        nohaj_reversal_id: reserved.reversal_id,
        nohaj_transfer_id: reserved.seller_transfer_id,
        nohaj_order_id: reserved.order_id,
        ...(refundId ? { nohaj_refund_id: refundId } : {}),
      },
    });

    const mappedStatus: 'processed' | 'failed' =
      rpReversal.status === 'failed' ? 'failed' : 'processed';

    const finalized = await deps.repo.finalizeSellerTransferReversal({
      reversalId: reserved.reversal_id,
      providerReversalId: rpReversal.id,
      providerTransferId: reserved.provider_transfer_id,
      nextStatus: mappedStatus,
      amountPaise: rpReversal.amount || reserved.amount_paise,
      actorId: actor.id,
      metadata: { razorpay_status: rpReversal.status || 'processed' },
    });

    return jsonResponse({
      reversalId: finalized.reversal_id,
      sellerTransferId: finalized.seller_transfer_id,
      providerReversalId: rpReversal.id,
      amountPaise: reserved.amount_paise,
      reversalStatus: finalized.reversal_status,
      transferStatus: finalized.transfer_status,
      idempotentReplay: false,
    });
  } catch (err) {
    const isClientRejection =
      err instanceof RazorpayApiError && err.statusCode >= 400 && err.statusCode < 500;
    const msg = err instanceof Error ? err.message : 'Razorpay Route transfer reversal failed.';

    if (isClientRejection) {
      await deps.repo
        .finalizeSellerTransferReversal({
          reversalId: reserved.reversal_id,
          providerTransferId: reserved.provider_transfer_id,
          nextStatus: 'failed',
          failureReason: msg,
          actorId: actor.id,
          metadata: { gateway_rejected: true },
        })
        .catch(() => undefined);

      return jsonResponse(
        {
          error: msg,
          reversalId: reserved.reversal_id,
          status: 'failed',
          recoverable: true,
        },
        400
      );
    }

    return jsonResponse(
      {
        error: 'Razorpay Route gateway timed out; reversal remains recoverable in pending state.',
        reversalId: reserved.reversal_id,
        status: 'pending',
        recoverable: true,
      },
      504
    );
  }
}
