import { sha256Hex, verifyRazorpayWebhookSignature } from '../_shared/crypto.ts';
import { sanitizeWebhookPayload } from '../_shared/supabaseRepo.ts';
import {
  corsHeaders,
  jsonResponse,
  type RazorpayRouteApiClient,
  type RouteEdgeRepository,
  type RouteWebhookEnv,
} from '../_shared/types.ts';

const ACCOUNT_EVENTS = new Set([
  'account.under_review',
  'account.activated',
  'account.needs_clarification',
  'account.suspended',
  'account.rejected',
]);

const PRODUCT_ROUTE_EVENTS = new Set([
  'product.route.under_review',
  'product.route.needs_clarification',
  'product.route.activated',
  'product.route.rejected',
  'product.route.suspended',
]);

const TRANSFER_EVENTS = new Set([
  'transfer.processed',
  'transfer.failed',
  'transfer.settled',
]);

const REVERSAL_EVENTS = new Set([
  'transfer.reversed',
  'reversal.created',
  'reversal.processed',
  'reversal.failed',
]);

export async function handleRazorpayRouteWebhook(
  req: Request,
  deps: {
    repo: RouteEdgeRepository;
    razorpayClient: RazorpayRouteApiClient | null;
    env: RouteWebhookEnv;
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
    return jsonResponse({ error: 'Invalid Razorpay Route webhook signature.' }, 401);
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
  const accountEntity = payloadObj.account?.entity;
  const productEntity = payloadObj.product?.entity;
  const transferEntity = payloadObj.transfer?.entity;
  const reversalEntity = payloadObj.reversal?.entity;
  const settlementEntity = payloadObj.settlement?.entity;

  const providerPaymentId =
    typeof transferEntity?.source === 'string' && transferEntity.source.startsWith('pay_')
      ? transferEntity.source
      : null;

  let beginResult;
  try {
    beginResult = await deps.repo.beginWebhookEvent({
      eventId,
      eventType,
      providerOrderId: null,
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

  if (!deps.env.razorpayRouteEnabled) {
    await deps.repo.completeWebhookEvent({
      eventId,
      status: 'ignored',
      errorMessage: 'Razorpay Route is disabled (RAZORPAY_ROUTE_ENABLED=false).',
    });
    return jsonResponse({ ok: true, ignored: true, reason: 'Razorpay Route is disabled.' });
  }

  try {
    if (ACCOUNT_EVENTS.has(eventType) || PRODUCT_ROUTE_EVENTS.has(eventType)) {
      const linkedAccountId =
        (typeof productEntity?.account_id === 'string' && productEntity.account_id.trim()) ||
        (typeof accountEntity?.id === 'string' && accountEntity.id.trim()) ||
        (typeof payload.account_id === 'string' && payload.account_id.trim()) ||
        '';
      const productId =
        typeof productEntity?.id === 'string' && productEntity.id.trim()
          ? productEntity.id.trim()
          : null;

      if (!linkedAccountId) {
        await deps.repo.completeWebhookEvent({
          eventId,
          status: 'ignored',
          errorMessage: 'Linked Account webhook missing account_id.',
        });
        return jsonResponse({ ok: true, ignored: true });
      }

      const existingAcct = await deps.repo.getSellerSettlementAccountByLinkedAccountId(linkedAccountId);
      if (!existingAcct) {
        await deps.repo.completeWebhookEvent({
          eventId,
          status: 'ignored',
          errorMessage: `No seller settlement account matched Linked Account ${linkedAccountId}.`,
        });
        return jsonResponse({ ok: true, ignored: true });
      }

      let rawStatus =
        (typeof productEntity?.activation_status === 'string' && productEntity.activation_status) ||
        (typeof accountEntity?.status === 'string' && accountEntity.status) ||
        eventType.split('.').pop() ||
        'under_review';
      let requirements = Array.isArray(productEntity?.requirements)
        ? (productEntity.requirements as unknown[])
        : null;

      if (deps.razorpayClient) {
        if (productId) {
          const rpProd = await deps.razorpayClient.fetchRouteProduct(linkedAccountId, productId);
          rawStatus = rpProd.activation_status || rawStatus;
          requirements = rpProd.requirements || requirements;
        } else {
          const rpAcct = await deps.razorpayClient.fetchLinkedAccount(linkedAccountId);
          rawStatus = rpAcct.status || rawStatus;
        }
      }

      const synced = await deps.repo.syncLinkedAccountFromRoute({
        accountId: existingAcct.id,
        linkedAccountId,
        productId,
        rawActivationStatus: rawStatus,
        kycRequirements: requirements,
      });

      await deps.repo.completeWebhookEvent({ eventId, status: 'processed' });
      return jsonResponse({
        ok: true,
        event: eventType,
        linkedAccountId,
        routeOnboardingStatus: synced.route_onboarding_status,
        payoutsEnabled: synced.payouts_enabled,
      });
    }

    if (TRANSFER_EVENTS.has(eventType)) {
      const providerTransferId =
        typeof transferEntity?.id === 'string' ? transferEntity.id.trim() : '';
      if (!providerTransferId) {
        await deps.repo.completeWebhookEvent({
          eventId,
          status: 'failed',
          errorMessage: 'Transfer webhook missing transfer.entity.id.',
        });
        return jsonResponse({ error: 'Missing transfer entity ID.' }, 400);
      }

      let rpTransferStatus = String(transferEntity?.status || '');
      let rpSettlementStatus =
        typeof transferEntity?.settlement_status === 'string'
          ? transferEntity.settlement_status
          : '';
      let settlementId =
        typeof transferEntity?.recipient_settlement_id === 'string'
          ? transferEntity.recipient_settlement_id
          : null;
      let onHold = Boolean(transferEntity?.on_hold);
      const errObj = (transferEntity?.error || {}) as Record<string, unknown>;
      let failureReason = typeof errObj.description === 'string' ? errObj.description : null;
      let errorCode = typeof errObj.code === 'string' ? errObj.code : null;
      let settlementUtr: string | null =
        typeof settlementEntity?.utr === 'string' ? settlementEntity.utr : null;

      if (deps.razorpayClient) {
        const rpTransfer = await deps.razorpayClient.fetchTransfer(providerTransferId);
        rpTransferStatus = rpTransfer.status;
        rpSettlementStatus = rpTransfer.settlement_status || rpSettlementStatus;
        settlementId = rpTransfer.recipient_settlement_id || settlementId;
        onHold = Boolean(rpTransfer.on_hold);
        failureReason = rpTransfer.error?.description ?? failureReason;
        errorCode = rpTransfer.error?.code ?? errorCode;

        if (settlementId && rpSettlementStatus === 'settled' && !settlementUtr) {
          try {
            const rpSettlement = await deps.razorpayClient.fetchSettlement(settlementId);
            settlementUtr = rpSettlement.utr || null;
          } catch {
            // Best-effort UTR enrichment; settlement_id is still recorded
          }
        }
      }

      const nextStatus: 'created' | 'on_hold' | 'processed' | 'settled' | 'failed' =
        eventType === 'transfer.settled' || rpSettlementStatus === 'settled'
          ? 'settled'
          : eventType === 'transfer.failed' ||
              rpTransferStatus === 'failed' ||
              rpSettlementStatus === 'failed'
            ? 'failed'
            : onHold || rpSettlementStatus === 'on_hold'
              ? 'on_hold'
              : eventType === 'transfer.processed' || rpTransferStatus === 'processed'
                ? 'processed'
                : 'created';

      const transferNotes = (transferEntity?.notes || {}) as Record<string, unknown>;
      const localTransferId =
        typeof transferNotes.nohaj_transfer_id === 'string' &&
        transferNotes.nohaj_transfer_id.trim()
          ? transferNotes.nohaj_transfer_id.trim()
          : null;

      const finalized = await deps.repo.finalizeSellerRouteTransfer({
        transferId: localTransferId,
        providerTransferId,
        nextStatus,
        settlementId,
        settlementUtr,
        failureReason:
          nextStatus === 'failed'
            ? failureReason || 'Razorpay reported Route transfer failure.'
            : null,
        errorCode: nextStatus === 'failed' ? errorCode : null,
        metadata: {
          webhook_event: eventType,
          webhook_event_id: eventId,
        },
      });

      await deps.repo.completeWebhookEvent({ eventId, status: 'processed' });
      return jsonResponse({
        ok: true,
        event: eventType,
        transferId: finalized.transfer_id,
        transferStatus: finalized.transfer_status,
        settlementStatus: finalized.settlement_status,
        ignoredOutOfOrder: finalized.ignored_out_of_order,
      });
    }

    if (REVERSAL_EVENTS.has(eventType)) {
      const providerReversalId =
        typeof reversalEntity?.id === 'string' && reversalEntity.id.trim()
          ? reversalEntity.id.trim()
          : null;
      const providerTransferId =
        (typeof reversalEntity?.transfer_id === 'string' && reversalEntity.transfer_id.trim()) ||
        (typeof transferEntity?.id === 'string' && transferEntity.id.trim()) ||
        null;
      const reversalNotes = (reversalEntity?.notes || {}) as Record<string, unknown>;
      const localReversalId =
        typeof reversalNotes.nohaj_reversal_id === 'string' &&
        reversalNotes.nohaj_reversal_id.trim()
          ? reversalNotes.nohaj_reversal_id.trim()
          : null;
      const amountPaise =
        typeof reversalEntity?.amount === 'number'
          ? reversalEntity.amount
          : typeof transferEntity?.amount_reversed === 'number'
            ? transferEntity.amount_reversed
            : null;

      if (!providerReversalId && !providerTransferId) {
        await deps.repo.completeWebhookEvent({
          eventId,
          status: 'ignored',
          errorMessage: 'Reversal webhook missing reversal/transfer IDs.',
        });
        return jsonResponse({ ok: true, ignored: true });
      }

      if (eventType === 'reversal.created' && !providerReversalId) {
        await deps.repo.completeWebhookEvent({ eventId, status: 'processed' });
        return jsonResponse({ ok: true, event: eventType });
      }

      const nextReversalStatus: 'processed' | 'failed' =
        eventType === 'reversal.failed' || reversalEntity?.status === 'failed'
          ? 'failed'
          : 'processed';

      const finalized = await deps.repo.finalizeSellerTransferReversal({
        reversalId: localReversalId,
        providerReversalId,
        providerTransferId,
        nextStatus: nextReversalStatus,
        amountPaise,
        failureReason:
          nextReversalStatus === 'failed' ? 'Razorpay reported transfer reversal failure.' : null,
        metadata: {
          webhook_event: eventType,
          webhook_event_id: eventId,
        },
      });

      await deps.repo.completeWebhookEvent({ eventId, status: 'processed' });
      return jsonResponse({
        ok: true,
        event: eventType,
        reversalId: finalized.reversal_id,
        transferStatus: finalized.transfer_status,
        alreadyProcessed: finalized.already_processed,
      });
    }

    if (eventType === 'settlement.processed') {
      await deps.repo.completeWebhookEvent({ eventId, status: 'processed' });
      return jsonResponse({ ok: true, event: eventType });
    }

    await deps.repo.completeWebhookEvent({
      eventId,
      status: 'ignored',
      errorMessage: `Unsupported Route webhook event: ${eventType}`,
    });
    return jsonResponse({ ok: true, ignored: true });
  } catch (err) {
    const safeMsg = err instanceof Error ? err.message : 'Route webhook processing failed.';
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
