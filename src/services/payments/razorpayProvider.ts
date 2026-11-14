import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import type { PaymentProvider, PaymentProviderAvailability } from './paymentProvider';
import type {
  CreatePaymentOrderRequest,
  CreatePaymentOrderResponse,
  RefundRequest,
  RefundResult,
  VerifyOnlinePaymentRequest,
  VerifyOnlinePaymentResponse,
} from './paymentTypes';

function readPublicRazorpayKeyId(): string {
  const metaEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
  const raw = metaEnv?.VITE_RAZORPAY_KEY_ID;
  return typeof raw === 'string' ? raw.trim() : '';
}

function readPublicSupabaseConfig(): { url: string; anonKey: string } {
  const metaEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
  const url = (metaEnv?.VITE_SUPABASE_URL || metaEnv?.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const anonKey = (metaEnv?.VITE_SUPABASE_ANON_KEY || metaEnv?.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  return { url, anonKey };
}

async function extractFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (error && typeof error === 'object') {
    const errObj = error as { message?: string; context?: Response };
    if (errObj.context && typeof errObj.context.json === 'function') {
      try {
        const parsed = (await errObj.context.json()) as { error?: string };
        if (parsed?.error) return parsed.error;
      } catch {
        // Fallback to standard message
      }
    }
    if (typeof errObj.message === 'string' && errObj.message.trim()) {
      return errObj.message;
    }
  }
  return fallback;
}

export class OnlinePaymentsNotEnabledError extends Error {
  constructor(
    message = 'Online Razorpay checkout requires a configured Supabase backend and VITE_RAZORPAY_KEY_ID.'
  ) {
    super(message);
    this.name = 'OnlinePaymentsNotEnabledError';
  }
}

/**
 * Stage 7.8.2 Razorpay Standard Checkout client adapter.
 * Strictly reads ONLY public VITE_RAZORPAY_KEY_ID and invokes authenticated Supabase Edge Functions.
 * Never holds key secrets, webhook secrets, or service-role tokens.
 */
export class RazorpayProviderAdapter implements PaymentProvider {
  public readonly providerName = 'razorpay' as const;

  getPublicKeyId(): string {
    return readPublicRazorpayKeyId();
  }

  getAvailability(): PaymentProviderAvailability {
    const publicKeyConfigured = Boolean(this.getPublicKeyId());
    const onlineCheckoutReady = Boolean(isSupabaseConfigured && supabase && publicKeyConfigured);

    let reason: string | undefined;
    if (!isSupabaseConfigured || !supabase) {
      reason = 'Supabase backend is not configured; using Demo Mode (COD only).';
    } else if (!publicKeyConfigured) {
      reason = 'VITE_RAZORPAY_KEY_ID is not configured.';
    }

    return {
      provider: 'razorpay',
      onlineCheckoutReady,
      publicKeyConfigured,
      ...(reason ? { reason } : {}),
    };
  }

  async checkServerReadiness(): Promise<PaymentProviderAvailability> {
    const local = this.getAvailability();
    if (!local.onlineCheckoutReady || !supabase) {
      return local;
    }

    const { url, anonKey } = readPublicSupabaseConfig();
    if (!url || !anonKey) {
      return {
        provider: 'razorpay',
        onlineCheckoutReady: false,
        publicKeyConfigured: local.publicKeyConfigured,
        reason: 'Supabase backend environment variables are not configured.',
      };
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 5000) : null;

    try {
      const sessionRes = await supabase.auth.getSession().catch(() => null);
      const accessToken = sessionRes?.data?.session?.access_token;

      const res = await fetch(`${url.replace(/\/+$/, '')}/functions/v1/razorpay-create-order`, {
        method: 'GET',
        headers: {
          apikey: anonKey,
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        ...(controller ? { signal: controller.signal } : {}),
      });

      if (!res.ok) {
        return {
          provider: 'razorpay',
          onlineCheckoutReady: false,
          publicKeyConfigured: local.publicKeyConfigured,
          reason: 'Online payment Edge Functions are not deployed or unreachable yet.',
        };
      }

      const payload = (await res.json().catch(() => null)) as {
        onlineCheckoutReady?: boolean;
        reason?: string;
      } | null;

      if (!payload || payload.onlineCheckoutReady !== true) {
        return {
          provider: 'razorpay',
          onlineCheckoutReady: false,
          publicKeyConfigured: local.publicKeyConfigured,
          reason:
            payload?.reason ||
            'Online payments are currently disabled pending staging verification.',
        };
      }

      return {
        provider: 'razorpay',
        onlineCheckoutReady: true,
        publicKeyConfigured: local.publicKeyConfigured,
      };
    } catch {
      return {
        provider: 'razorpay',
        onlineCheckoutReady: false,
        publicKeyConfigured: local.publicKeyConfigured,
        reason: 'Unable to verify server-side Razorpay Edge Function readiness.',
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async createPaymentOrder(request: CreatePaymentOrderRequest): Promise<CreatePaymentOrderResponse> {
    if (!isSupabaseConfigured || !supabase) {
      throw new OnlinePaymentsNotEnabledError(
        'Razorpay payment order creation requires an active Supabase backend.'
      );
    }

    const { data, error } = await supabase.functions.invoke<CreatePaymentOrderResponse>(
      'razorpay-create-order',
      {
        body: {
          shippingAddress: request.shippingAddress,
          items: request.items,
          idempotencyKey: request.idempotencyKey,
          retryAttempt: request.retryAttempt === true,
        },
      }
    );

    if (error || !data?.providerOrderId) {
      const msg = await extractFunctionErrorMessage(
        error,
        'Unable to initialize online payment order.'
      );
      throw new Error(msg);
    }

    return data;
  }

  async verifyPayment(request: VerifyOnlinePaymentRequest): Promise<VerifyOnlinePaymentResponse> {
    if (!isSupabaseConfigured || !supabase) {
      throw new OnlinePaymentsNotEnabledError(
        'Razorpay payment verification requires an active Supabase backend.'
      );
    }

    const { data, error } = await supabase.functions.invoke<VerifyOnlinePaymentResponse>(
      'razorpay-verify-payment',
      {
        body: {
          orderId: request.orderId,
          providerOrderId: request.providerOrderId,
          providerPaymentId: request.providerPaymentId,
          providerSignature: request.providerSignature,
        },
      }
    );

    if (error || !data) {
      const msg = await extractFunctionErrorMessage(
        error,
        'Unable to verify payment with server.'
      );
      throw new Error(msg);
    }

    return data;
  }

  async requestRefund(request: RefundRequest): Promise<RefundResult> {
    if (!isSupabaseConfigured || !supabase) {
      throw new OnlinePaymentsNotEnabledError(
        'Razorpay refund processing requires an active Supabase backend.'
      );
    }

    const { data, error } = await supabase.functions.invoke<{
      refundId: string;
      orderId: string;
      providerRefundId?: string | null;
      amountPaise: number;
      currency: string;
      status: 'pending' | 'processed' | 'failed';
      orderPaymentStatus?: string;
      idempotentReplay?: boolean;
    }>('razorpay-create-refund', {
      body: {
        orderId: request.orderId,
        refundId: request.refundId ?? null,
        sellerOrderId: request.sellerOrderId ?? null,
        items: request.items ?? null,
        amountPaise: request.amountPaise ?? null,
        shippingRefundPaise: request.shippingRefundPaise ?? 0,
        reason: request.reason,
        idempotencyKey: request.idempotencyKey,
        internalNotes: request.internalNotes ?? null,
        speed: request.speed ?? 'normal',
      },
    });

    if (error || !data?.refundId) {
      const msg = await extractFunctionErrorMessage(
        error,
        'Unable to initiate Razorpay refund.'
      );
      throw new Error(msg);
    }

    return {
      refundId: data.refundId,
      orderId: data.orderId,
      providerRefundId: data.providerRefundId ?? null,
      refundChannel: 'razorpay',
      amountPaise: Number(data.amountPaise),
      status: data.status,
      orderPaymentStatus: data.orderPaymentStatus,
      reversalStatus: data.status === 'processed' ? 'reversed' : data.status === 'failed' ? 'failed' : 'pending',
      idempotentReplay: Boolean(data.idempotentReplay),
    };
  }
}
