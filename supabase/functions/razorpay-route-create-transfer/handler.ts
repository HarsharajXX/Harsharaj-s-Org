import { RazorpayApiError } from '../_shared/razorpayClient.ts';
import {
  corsHeaders,
  jsonResponse,
  type RazorpayRouteApiClient,
  type RazorpayTransferEntity,
  type ReserveRouteTransferResult,
  type RouteApiEnv,
  type RouteEdgeRepository,
} from '../_shared/types.ts';

interface TransferAllocationInput {
  sellerOrderId: string;
  amountPaise?: number | null;
  transferId?: string | null;
  onHold?: boolean;
  holdUntil?: string | null;
  idempotencyKey: string;
}

function parseAllocations(body: Record<string, unknown>): TransferAllocationInput[] {
  const rawList = Array.isArray(body.allocations) ? body.allocations : [body];
  if (rawList.length === 0) {
    throw new Error('At least one seller order transfer allocation is required.');
  }

  return rawList.map((entry, idx) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Invalid transfer allocation at index ${idx}.`);
    }
    const obj = entry as Record<string, unknown>;
    const sellerOrderId = typeof obj.sellerOrderId === 'string' ? obj.sellerOrderId.trim() : '';
    const idempotencyKey = typeof obj.idempotencyKey === 'string' ? obj.idempotencyKey.trim() : '';
    if (!sellerOrderId) {
      throw new Error(`sellerOrderId is required for transfer allocation ${idx}.`);
    }
    if (!idempotencyKey || idempotencyKey.length < 6) {
      throw new Error(`A valid idempotencyKey (min 6 chars) is required for transfer allocation ${idx}.`);
    }

    let amountPaise: number | null = null;
    if (obj.amountPaise !== undefined && obj.amountPaise !== null) {
      const parsed = Number(obj.amountPaise);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error('amountPaise must be a positive integer when specified.');
      }
      amountPaise = parsed;
    }

    const transferId =
      typeof obj.transferId === 'string' && obj.transferId.trim() ? obj.transferId.trim() : null;
    const onHold = Boolean(obj.onHold);
    let holdUntil: string | null = null;
    if (typeof obj.holdUntil === 'string' && obj.holdUntil.trim()) {
      const ms = Date.parse(obj.holdUntil.trim());
      if (!Number.isFinite(ms)) {
        throw new Error('holdUntil must be a valid ISO timestamp.');
      }
      holdUntil = new Date(ms).toISOString();
    }

    return {
      sellerOrderId,
      amountPaise,
      transferId,
      onHold,
      holdUntil,
      idempotencyKey,
    };
  });
}

function mapRazorpayTransferState(rp: RazorpayTransferEntity): {
  nextStatus: 'created' | 'on_hold' | 'processed' | 'settled' | 'failed';
  settlementId: string | null;
  failureReason: string | null;
  errorCode: string | null;
} {
  if (rp.status === 'failed' || rp.settlement_status === 'failed') {
    return {
      nextStatus: 'failed',
      settlementId: rp.recipient_settlement_id || null,
      failureReason: rp.error?.description || 'Razorpay Route transfer failed.',
      errorCode: rp.error?.code || 'TRANSFER_FAILED',
    };
  }
  if (rp.settlement_status === 'settled') {
    return {
      nextStatus: 'settled',
      settlementId: rp.recipient_settlement_id || null,
      failureReason: null,
      errorCode: null,
    };
  }
  if (rp.on_hold || rp.settlement_status === 'on_hold') {
    return {
      nextStatus: 'on_hold',
      settlementId: rp.recipient_settlement_id || null,
      failureReason: null,
      errorCode: null,
    };
  }
  if (rp.status === 'processed') {
    return {
      nextStatus: 'processed',
      settlementId: rp.recipient_settlement_id || null,
      failureReason: null,
      errorCode: null,
    };
  }
  return {
    nextStatus: 'created',
    settlementId: rp.recipient_settlement_id || null,
    failureReason: null,
    errorCode: null,
  };
}

export async function handleCreateRouteTransfer(
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
      { error: 'Forbidden: only operations or super administrators may initiate Route transfers.' },
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

  let allocations: TransferAllocationInput[];
  try {
    allocations = parseAllocations(body);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Invalid transfer payload.' }, 400);
  }

  const reservedRows: ReserveRouteTransferResult[] = [];
  for (const alloc of allocations) {
    try {
      const reserved = await deps.repo.reserveSellerRouteTransfer({
        actorId: actor.id,
        sellerOrderId: alloc.sellerOrderId,
        amountPaise: alloc.amountPaise ?? null,
        transferId: alloc.transferId ?? null,
        onHold: alloc.onHold ?? false,
        holdUntil: alloc.holdUntil ?? null,
        idempotencyKey: alloc.idempotencyKey,
      });
      reservedRows.push(reserved);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to reserve Route transfer.';
      const lower = msg.toLowerCase();
      const status = lower.includes('not found')
        ? 404
        : lower.includes('forbidden')
          ? 403
          : 400;
      return jsonResponse({ error: msg }, status);
    }
  }

  const results: Array<{
    transferId: string;
    sellerOrderId: string;
    sellerId: string;
    providerTransferId: string | null;
    amountPaise: number;
    status: string;
    settlementStatus: string;
    idempotentReplay: boolean;
  }> = [];

  const toDispatchByPayment = new Map<string, ReserveRouteTransferResult[]>();
  for (const row of reservedRows) {
    if (row.already_initiated) {
      results.push({
        transferId: row.transfer_id,
        sellerOrderId: row.seller_order_id,
        sellerId: row.seller_id,
        providerTransferId: row.provider_transfer_id,
        amountPaise: row.amount_paise,
        status: row.transfer_status,
        settlementStatus: row.transfer_status === 'on_hold' ? 'on_hold' : 'pending',
        idempotentReplay: true,
      });
      continue;
    }
    const group = toDispatchByPayment.get(row.provider_payment_id) || [];
    group.push(row);
    toDispatchByPayment.set(row.provider_payment_id, group);
  }

  for (const [providerPaymentId, group] of toDispatchByPayment.entries()) {
    try {
      const rpTransfers = await deps.razorpayClient.createPaymentTransfers(
        providerPaymentId,
        group.map((r) => ({
          account: r.linked_account_id,
          amountPaise: r.amount_paise,
          onHold: r.on_hold,
          onHoldUntil: r.hold_until ? Math.floor(Date.parse(r.hold_until) / 1000) : undefined,
          notes: {
            nohaj_transfer_id: r.transfer_id,
            nohaj_seller_order_id: r.seller_order_id,
            nohaj_order_id: r.order_id,
          },
          linkedAccountNotes: ['nohaj_seller_order_id'],
        }))
      );

      for (let i = 0; i < group.length; i++) {
        const resRow = group[i];
        const matched =
          rpTransfers.find(
            (t) =>
              t.notes?.nohaj_transfer_id === resRow.transfer_id ||
              (t.recipient === resRow.linked_account_id && t.amount === resRow.amount_paise)
          ) || rpTransfers[i];

        if (!matched?.id) {
          throw new Error('Razorpay Route response did not return transfer entity details.');
        }

        const mapped = mapRazorpayTransferState(matched);
        const finalized = await deps.repo.finalizeSellerRouteTransfer({
          transferId: resRow.transfer_id,
          providerTransferId: matched.id,
          nextStatus: mapped.nextStatus,
          settlementId: mapped.settlementId,
          failureReason: mapped.failureReason,
          errorCode: mapped.errorCode,
          actorId: actor.id,
          metadata: {
            razorpay_status: matched.status,
            razorpay_settlement_status: matched.settlement_status || null,
          },
        });

        results.push({
          transferId: finalized.transfer_id,
          sellerOrderId: finalized.seller_order_id,
          sellerId: resRow.seller_id,
          providerTransferId: matched.id,
          amountPaise: resRow.amount_paise,
          status: finalized.transfer_status,
          settlementStatus: finalized.settlement_status,
          idempotentReplay: false,
        });
      }
    } catch (err) {
      const isClientRejection =
        err instanceof RazorpayApiError && err.statusCode >= 400 && err.statusCode < 500;
      const msg = err instanceof Error ? err.message : 'Razorpay Route transfer request failed.';

      if (isClientRejection) {
        for (const r of group) {
          await deps.repo
            .finalizeSellerRouteTransfer({
              transferId: r.transfer_id,
              nextStatus: 'failed',
              failureReason: msg,
              errorCode: err instanceof RazorpayApiError ? err.code : 'RAZORPAY_4XX',
              actorId: actor.id,
              metadata: { gateway_rejected: true },
            })
            .catch(() => undefined);
        }
        return jsonResponse({ error: msg, recoverable: true, partialResults: results }, 400);
      }

      for (const r of group) {
        await deps.repo
          .finalizeSellerRouteTransfer({
            transferId: r.transfer_id,
            nextStatus: 'pending',
            actorId: actor.id,
            metadata: { gateway_timeout_or_transient_error: true, last_error: msg },
          })
          .catch(() => undefined);
      }
      return jsonResponse(
        {
          error: 'Razorpay Route gateway timed out or returned a transient error; transfers remain recoverable in pending state.',
          recoverable: true,
          partialResults: results,
        },
        504
      );
    }
  }

  return jsonResponse({
    transfers: results,
    transfer: results.length === 1 ? results[0] : undefined,
    idempotentReplay: results.length > 0 && results.every((r) => r.idempotentReplay),
  });
}
