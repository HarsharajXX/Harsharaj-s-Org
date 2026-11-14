import type {
  CreatePaymentOrderRequest,
  CreatePaymentOrderResponse,
  PaymentProviderName,
  RefundRequest,
  RefundResult,
  VerifyOnlinePaymentRequest,
  VerifyOnlinePaymentResponse,
} from './paymentTypes';
import { RazorpayProviderAdapter } from './razorpayProvider';

export interface PaymentProviderAvailability {
  provider: PaymentProviderName;
  onlineCheckoutReady: boolean;
  publicKeyConfigured: boolean;
  reason?: string;
}

/**
 * Provider-agnostic client payment gateway contract.
 * Actual order creation, signature/API verification, webhooks, and refunds execute
 * solely inside trusted server-side Supabase Edge Functions (Stage 7.8.2+).
 */
export interface PaymentProvider {
  readonly providerName: PaymentProviderName;
  getAvailability(): PaymentProviderAvailability;
  checkServerReadiness(): Promise<PaymentProviderAvailability>;
  createPaymentOrder(request: CreatePaymentOrderRequest): Promise<CreatePaymentOrderResponse>;
  verifyPayment(request: VerifyOnlinePaymentRequest): Promise<VerifyOnlinePaymentResponse>;
  requestRefund(request: RefundRequest): Promise<RefundResult>;
}

export function getPaymentProvider(provider: PaymentProviderName = 'razorpay'): PaymentProvider {
  if (provider === 'razorpay') {
    return new RazorpayProviderAdapter();
  }
  throw new Error(`Unsupported payment provider: ${String(provider)}`);
}
