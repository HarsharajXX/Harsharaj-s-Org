export interface RazorpaySuccessResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export interface RazorpayFailedResponse {
  error?: {
    code?: string;
    description?: string;
    source?: string;
    step?: string;
    reason?: string;
  };
}

export interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: 'INR';
  name: string;
  description: string;
  order_id: string;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  notes?: Record<string, string>;
  theme?: {
    color?: string;
  };
  handler: (response: RazorpaySuccessResponse) => void;
  modal?: {
    ondismiss?: () => void;
    escape?: boolean;
    backdropclose?: boolean;
  };
}

interface RazorpayCheckoutInstance {
  open(): void;
  on(event: 'payment.failed', cb: (response: RazorpayFailedResponse) => void): void;
}

interface WindowWithRazorpay extends Window {
  Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance;
}

const RAZORPAY_SDK_URL = 'https://checkout.razorpay.com/v1/checkout.js';
let sdkLoadPromise: Promise<void> | null = null;

export function loadRazorpayCheckoutSdk(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Razorpay Checkout SDK requires a browser environment.'));
  }

  const win = window as WindowWithRazorpay;
  if (win.Razorpay) {
    return Promise.resolve();
  }

  if (sdkLoadPromise) {
    return sdkLoadPromise;
  }

  sdkLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${RAZORPAY_SDK_URL}"]`
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => {
          sdkLoadPromise = null;
          reject(new Error('Failed to load Razorpay Checkout script.'));
        },
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.src = RAZORPAY_SDK_URL;
    script.async = true;
    script.onload = () => {
      if ((window as WindowWithRazorpay).Razorpay) {
        resolve();
      } else {
        sdkLoadPromise = null;
        reject(new Error('Razorpay SDK loaded but window.Razorpay is unavailable.'));
      }
    };
    script.onerror = () => {
      sdkLoadPromise = null;
      reject(new Error('Failed to load Razorpay Standard Checkout SDK.'));
    };
    document.head.appendChild(script);
  });

  return sdkLoadPromise;
}

export async function openRazorpayCheckoutModal(
  options: RazorpayCheckoutOptions,
  onPaymentFailed?: (response: RazorpayFailedResponse) => void
): Promise<void> {
  await loadRazorpayCheckoutSdk();
  const win = window as WindowWithRazorpay;
  if (!win.Razorpay) {
    throw new Error('Razorpay Checkout modal could not be initialized.');
  }

  const rzp = new win.Razorpay(options);
  if (onPaymentFailed) {
    rzp.on('payment.failed', onPaymentFailed);
  }
  rzp.open();
}
