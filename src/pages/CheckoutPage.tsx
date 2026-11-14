import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCartItemKey, prepareCheckoutItems, useStore } from '../context/StoreContext';
import { getPaymentProvider, type PaymentProviderAvailability } from '../services/payments/paymentProvider';
import { paiseToInr } from '../services/payments/paymentTypes';
import { openRazorpayCheckoutModal } from '../services/payments/razorpayCheckoutSdk';
import type { VerifyOnlinePaymentRequest } from '../services/payments/paymentTypes';
import { formatINR } from '../utils/format';

interface ConfirmationSummary {
  id: string;
  customerName: string;
  total: number;
  shippingAddress: string;
  paymentMethod: 'cod' | 'online';
  isDemo: boolean;
}

type OnlineCheckoutStage =
  | 'idle'
  | 'creating_order'
  | 'awaiting_payment'
  | 'verifying'
  | 'verification_pending'
  | 'failed';

function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `nhj_${crypto.randomUUID()}`;
  }
  return `nhj_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export const CheckoutPage: React.FC = () => {
  const {
    isLiveMode,
    cart,
    cartSubtotal,
    user,
    clearCart,
    refreshLiveState,
    placeDemoOrder,
    placeLiveOrder,
    showToast,
  } = useStore();

  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'online'>('cod');
  const [submitting, setSubmitting] = useState(false);
  const [onlineStage, setOnlineStage] = useState<OnlineCheckoutStage>('idle');
  const [onlineMessage, setOnlineMessage] = useState<string | null>(null);
  const [activeOrderMeta, setActiveOrderMeta] = useState<{
    orderId: string;
    orderNumber: string;
    amountPaise: number;
    reservationExpiresAt: string;
  } | null>(null);
  const [pendingVerificationPayload, setPendingVerificationPayload] =
    useState<VerifyOnlinePaymentRequest | null>(null);
  const [confirmedOrder, setConfirmedOrder] = useState<ConfirmationSummary | null>(null);

  const paymentProvider = useMemo(() => getPaymentProvider('razorpay'), []);
  const [gatewayAvailability, setGatewayAvailability] = useState<PaymentProviderAvailability>(() => ({
    provider: 'razorpay',
    onlineCheckoutReady: false,
    publicKeyConfigured: paymentProvider.getAvailability().publicKeyConfigured,
    reason: isLiveMode
      ? 'Checking server-side Razorpay readiness...'
      : 'Requires live Supabase backend & Edge Functions.',
  }));

  useEffect(() => {
    let active = true;
    void paymentProvider.checkServerReadiness().then((status) => {
      if (!active) return;
      setGatewayAvailability(status);
      if (!status.onlineCheckoutReady) {
        setPaymentMethod('cod');
      }
    });
    return () => {
      active = false;
    };
  }, [paymentProvider, isLiveMode]);

  const cartSignature = useMemo(
    () =>
      cart
        .map((c) => `${c.product.id}:${c.variantId || ''}:${c.quantity}`)
        .sort()
        .join('|'),
    [cart]
  );

  const [checkoutIdempotencyKey, setCheckoutIdempotencyKey] = useState<string>(() =>
    createIdempotencyKey()
  );

  useEffect(() => {
    setCheckoutIdempotencyKey(createIdempotencyKey());
    setOnlineStage('idle');
    setOnlineMessage(null);
    setActiveOrderMeta(null);
    setPendingVerificationPayload(null);
  }, [cartSignature]);

  const shipping = cartSubtotal >= 5000 || cartSubtotal === 0 ? 0 : 250;
  const isBusy =
    submitting ||
    onlineStage === 'creating_order' ||
    onlineStage === 'awaiting_payment' ||
    onlineStage === 'verifying';

  const runServerVerification = async (
    payload: VerifyOnlinePaymentRequest,
    fullAddress: string,
    customerName: string
  ) => {
    setOnlineStage('verifying');
    setOnlineMessage('Verifying Razorpay signature and capture status with NOHAJ server...');
    setPendingVerificationPayload(payload);

    try {
      const verifyResult = await paymentProvider.verifyPayment(payload);

      if (verifyResult.verified && verifyResult.paymentStatus === 'captured') {
        clearCart();
        await refreshLiveState();
        setOnlineStage('idle');
        setOnlineMessage(null);
        setPendingVerificationPayload(null);
        setConfirmedOrder({
          id: activeOrderMeta?.orderNumber || payload.orderId,
          customerName,
          total: paiseToInr(verifyResult.amountPaise),
          shippingAddress: fullAddress,
          paymentMethod: 'online',
          isDemo: false,
        });
        showToast('Online payment verified and order confirmed.');
        return;
      }

      if (verifyResult.paymentStatus === 'authorized' || verifyResult.paymentStatus === 'pending') {
        setOnlineStage('verification_pending');
        setOnlineMessage(
          'Payment is authorized and awaiting capture confirmation. Your order will confirm once Razorpay capture completes.'
        );
        showToast('Payment awaiting capture verification.', 'info');
        return;
      }

      setOnlineStage('failed');
      setOnlineMessage(
        'Payment was not captured by Razorpay. Please retry payment while your inventory reservation is still active.'
      );
      showToast('Payment not captured. You can retry safely.', 'error');
    } catch (err) {
      setOnlineStage('verification_pending');
      setOnlineMessage(
        err instanceof Error
          ? `Verification could not be completed yet: ${err.message}. Click Re-check Verification below without paying again.`
          : 'Server verification is still pending. Click Re-check Verification below.'
      );
      showToast('Payment verification pending server check.', 'info');
    }
  };

  const startOnlineCheckout = async (retryAttempt: boolean) => {
    if (!user || user.is_demo) {
      showToast('Please sign in to place a live online payment order.', 'error');
      return;
    }

    if (!gatewayAvailability.onlineCheckoutReady) {
      showToast(
        gatewayAvailability.reason || 'Online checkout requires live Supabase and Razorpay configuration.',
        'error'
      );
      return;
    }

    const fullAddress = `${address.trim()}, ${city.trim()} - ${pincode.trim()} (Ph: ${phone.trim()})`;
    setSubmitting(true);
    setOnlineStage('creating_order');
    setOnlineMessage('Reserving inventory and preparing Razorpay checkout...');

    try {
      const normalizedItems = prepareCheckoutItems(
        cart.map((c) => ({
          product_id: c.product.id,
          variant_id: c.variantId || null,
          quantity: c.quantity,
        }))
      );

      const created = await paymentProvider.createPaymentOrder({
        shippingAddress: {
          full_name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          line1: address.trim(),
          city: city.trim(),
          postal_code: pincode.trim(),
        },
        items: normalizedItems,
        idempotencyKey: checkoutIdempotencyKey,
        retryAttempt,
      });

      setActiveOrderMeta({
        orderId: created.orderId,
        orderNumber: created.orderNumber,
        amountPaise: created.amountPaise,
        reservationExpiresAt: created.reservationExpiresAt,
      });

      setOnlineStage('awaiting_payment');
      setOnlineMessage(
        `Order ${created.orderNumber} reserved (${formatINR(paiseToInr(created.amountPaise))}). Complete payment in the Razorpay window.`
      );

      await openRazorpayCheckoutModal(
        {
          key: created.publicKeyId,
          amount: created.amountPaise,
          currency: created.currency,
          name: 'NOHAJ',
          description: `Order ${created.orderNumber}`,
          order_id: created.providerOrderId,
          prefill: {
            name: name.trim(),
            email: email.trim(),
            contact: phone.trim(),
          },
          notes: {
            nohaj_order_id: created.orderId,
            order_number: created.orderNumber,
          },
          theme: {
            color: '#25231F',
          },
          handler: (response) => {
            setSubmitting(false);
            void runServerVerification(
              {
                orderId: created.orderId,
                providerOrderId: response.razorpay_order_id,
                providerPaymentId: response.razorpay_payment_id,
                providerSignature: response.razorpay_signature,
              },
              fullAddress,
              name.trim()
            );
          },
          modal: {
            ondismiss: () => {
              setSubmitting(false);
              setOnlineStage((prev) => (prev === 'awaiting_payment' ? 'idle' : prev));
              setOnlineMessage(
                `Payment window closed. Order ${created.orderNumber} remains reserved briefly — you can resume payment without creating a duplicate order.`
              );
            },
          },
        },
        (failure) => {
          setSubmitting(false);
          setOnlineStage('failed');
          const reason =
            failure.error?.description ||
            failure.error?.reason ||
            'Payment failed inside Razorpay checkout.';
          setOnlineMessage(`${reason} Click Retry Online Payment to try again.`);
          showToast(reason, 'error');
        }
      );
    } catch (err) {
      setSubmitting(false);
      const msg = err instanceof Error ? err.message : 'Unable to start Razorpay checkout.';
      if (msg.toLowerCase().includes('expired')) {
        setCheckoutIdempotencyKey(createIdempotencyKey());
        setActiveOrderMeta(null);
      }
      setOnlineStage('failed');
      setOnlineMessage(msg);
      showToast(msg, 'error');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;

    if (
      !name.trim() ||
      !email.trim() ||
      !phone.trim() ||
      !address.trim() ||
      !city.trim() ||
      !pincode.trim()
    ) {
      showToast('Please complete all required shipping fields.', 'error');
      return;
    }

    const fullAddress = `${address.trim()}, ${city.trim()} - ${pincode.trim()} (Ph: ${phone.trim()})`;
    const orderTotal = cartSubtotal + shipping;

    if (paymentMethod === 'online') {
      if (!isLiveMode || !gatewayAvailability.onlineCheckoutReady) {
        showToast(
          gatewayAvailability.reason ||
            'Online Razorpay checkout is not active yet. Please use Cash on Delivery.',
          'error'
        );
        return;
      }
      await startOnlineCheckout(onlineStage === 'failed');
      return;
    }

    if (isLiveMode) {
      if (!user || user.is_demo) {
        showToast('Please sign in to place a live order.', 'error');
        return;
      }
      setSubmitting(true);
      const res = await placeLiveOrder({
        customerName: name.trim(),
        customerEmail: email.trim(),
        phone: phone.trim(),
        line1: address.trim(),
        city: city.trim(),
        postalCode: pincode.trim(),
        paymentMethod: 'cod',
      });
      setSubmitting(false);

      if (res.error || !res.orderId) {
        showToast(res.error || 'Could not place order.', 'error');
        return;
      }

      setConfirmedOrder({
        id: res.orderId,
        customerName: name.trim(),
        total: orderTotal,
        shippingAddress: fullAddress,
        paymentMethod: 'cod',
        isDemo: false,
      });
      showToast('Cash on Delivery order placed successfully.');
      return;
    }

    const order = placeDemoOrder(name.trim(), email.trim(), fullAddress);
    setConfirmedOrder({
      id: order.order_number || order.id,
      customerName: order.customer_name,
      total: order.total,
      shippingAddress: order.shipping_address,
      paymentMethod: 'cod',
      isDemo: true,
    });
    showToast('COD Demo order placed successfully.');
  };

  if (confirmedOrder) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16">
        <div className="border border-[#D8CBB9] bg-[#FAF9F6] p-8 sm:p-10 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-[#78816A] mb-2">
            {confirmedOrder.isDemo
              ? 'Demo Checkout Confirmation'
              : confirmedOrder.paymentMethod === 'online'
                ? 'Payment Verified & Order Confirmed'
                : 'Order Confirmed (Cash on Delivery)'}
          </p>
          <h1 className="font-serif text-3xl text-[#25231F]">
            Thank you, {confirmedOrder.customerName}.
          </h1>
          <p className="mt-3 text-sm text-[#514B43]">
            Order <strong className="text-[#25231F] tabular-nums">{confirmedOrder.id}</strong>{' '}
            {confirmedOrder.isDemo
              ? 'has been recorded in demo mode. No real payment was processed.'
              : confirmedOrder.paymentMethod === 'online'
                ? 'payment has been verified with Razorpay and your order is confirmed for seller fulfilment.'
                : 'has been created via Cash on Delivery and split per seller for fulfilment.'}
          </p>
          <div className="mt-6 p-4 bg-[#F2EDE4] border border-[#D8CBB9] text-left text-sm space-y-1">
            <p>
              <span className="text-[#777168]">Total:</span>{' '}
              <strong className="tabular-nums">{formatINR(confirmedOrder.total)}</strong>
            </p>
            <p>
              <span className="text-[#777168]">Payment Method:</span>{' '}
              {confirmedOrder.paymentMethod === 'online'
                ? 'Online Payment — Razorpay (Captured)'
                : 'Cash on Delivery (COD)'}
            </p>
            <p>
              <span className="text-[#777168]">Shipping to:</span> {confirmedOrder.shippingAddress}
            </p>
          </div>
          <div className="mt-8 flex justify-center gap-4">
            <Link
              to="/shop"
              className="px-6 py-3 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest"
            >
              Continue Shopping
            </Link>
            <Link
              to="/account/orders"
              className="px-6 py-3 border border-[#25231F] text-[#25231F] text-xs uppercase tracking-widest"
            >
              View Orders
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (cart.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <h1 className="font-serif text-3xl text-[#25231F]">Your bag is empty</h1>
        <Link
          to="/shop"
          className="inline-block mt-6 px-6 py-3 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest"
        >
          Explore Collection
        </Link>
      </div>
    );
  }

  const fullAddress = `${address.trim()}, ${city.trim()} - ${pincode.trim()} (Ph: ${phone.trim()})`;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <div className="mb-8 pb-4 border-b border-[#D8CBB9]">
        <p className="text-xs uppercase tracking-widest text-[#A65F46]">
          {isLiveMode
            ? 'Multi-Vendor Checkout · Razorpay & Cash on Delivery'
            : 'Demo Checkout — Cash on Delivery Preview'}
        </p>
        <h1 className="font-serif text-3xl sm:text-4xl text-[#25231F] mt-1">
          Checkout
        </h1>
      </div>

      {isLiveMode && (!user || user.is_demo) && (
        <div className="mb-8 p-5 border border-[#A65F46] bg-[#FAF9F6] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <p className="text-sm text-[#25231F]">
            Please sign in with your NOHAJ account before placing a live order.
          </p>
          <Link
            to="/login"
            state={{ from: '/checkout' }}
            className="px-5 py-2.5 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest shrink-0 text-center"
          >
            Sign In to Checkout
          </Link>
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        <div className="lg:col-span-7 space-y-6">
          <h2 className="font-serif text-xl text-[#25231F]">Customer & Shipping Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Full Name *</label>
              <input
                type="text"
                required
                disabled={isBusy}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#FAF9F6] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none focus:border-[#25231F] disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Email *</label>
              <input
                type="email"
                required
                disabled={isBusy}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#FAF9F6] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none focus:border-[#25231F] disabled:opacity-60"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Phone Number *</label>
            <input
              type="tel"
              required
              disabled={isBusy}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[#FAF9F6] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none focus:border-[#25231F] disabled:opacity-60"
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Street Address *</label>
            <input
              type="text"
              required
              disabled={isBusy}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[#FAF9F6] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none focus:border-[#25231F] disabled:opacity-60"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">City & State *</label>
              <input
                type="text"
                required
                disabled={isBusy}
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#FAF9F6] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none focus:border-[#25231F] disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">PIN Code *</label>
              <input
                type="text"
                required
                disabled={isBusy}
                value={pincode}
                onChange={(e) => setPincode(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#FAF9F6] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none focus:border-[#25231F] disabled:opacity-60"
              />
            </div>
          </div>
        </div>

        <div className="lg:col-span-5">
          <div className="border border-[#D8CBB9] bg-[#FAF9F6] p-6 space-y-4">
            <h2 className="font-serif text-xl text-[#25231F]">Order Summary</h2>
            <div className="divide-y divide-[#E6DED2] text-sm">
              {cart.map((item) => {
                const itemKey = getCartItemKey(
                  item.product.id,
                  item.variantId,
                  item.selectedSize,
                  item.selectedColour
                );
                const unitPrice = item.unitPrice ?? item.product.price;
                return (
                  <div key={itemKey} className="py-2.5 flex justify-between gap-4">
                    <div>
                      <span className="text-[#514B43]">
                        {item.product.name} × {item.quantity}
                      </span>
                      <p className="text-[11px] text-[#777168]">
                        {item.selectedSize} · {item.selectedColour}
                      </p>
                    </div>
                    <span className="text-[#25231F] tabular-nums">
                      {formatINR(unitPrice * item.quantity)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-[#D8CBB9] pt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[#514B43]">Shipping</span>
                <span className="tabular-nums">{shipping === 0 ? 'Complimentary' : formatINR(shipping)}</span>
              </div>
              <div className="flex justify-between font-medium text-base text-[#25231F]">
                <span>Total</span>
                <span className="tabular-nums">
                  {activeOrderMeta
                    ? formatINR(paiseToInr(activeOrderMeta.amountPaise))
                    : formatINR(cartSubtotal + shipping)}
                </span>
              </div>
            </div>

            <div className="border-t border-[#D8CBB9] pt-4 space-y-2.5">
              <p className="text-xs uppercase tracking-wider text-[#777168]">Payment Method</p>
              <label
                className={`flex items-start gap-2.5 text-sm ${
                  gatewayAvailability.onlineCheckoutReady
                    ? 'text-[#25231F] cursor-pointer'
                    : 'text-[#777168] cursor-not-allowed opacity-75'
                }`}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  disabled={isBusy || !gatewayAvailability.onlineCheckoutReady}
                  checked={paymentMethod === 'online'}
                  onChange={() => {
                    if (gatewayAvailability.onlineCheckoutReady) {
                      setPaymentMethod('online');
                    }
                  }}
                  className="accent-[#A65F46] mt-1"
                />
                <span>
                  <span className="block font-medium">Online Payment — Razorpay</span>
                  <span className="block text-[11px] text-[#777168]">
                    {gatewayAvailability.onlineCheckoutReady
                      ? 'UPI, Cards & NetBanking · Verified server-side before confirmation'
                      : gatewayAvailability.reason ||
                        'Online payments are disabled pending Edge Function & staging verification'}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2.5 text-sm text-[#25231F] cursor-pointer">
                <input
                  type="radio"
                  name="paymentMethod"
                  disabled={isBusy}
                  checked={paymentMethod === 'cod'}
                  onChange={() => setPaymentMethod('cod')}
                  className="accent-[#A65F46] mt-1"
                />
                <span>
                  <span className="block font-medium">Cash on Delivery (COD)</span>
                  <span className="block text-[11px] text-[#777168]">
                    Pay in cash upon delivery across eligible pin codes
                  </span>
                </span>
              </label>
            </div>

            {paymentMethod === 'online' && onlineMessage && (
              <div
                className={`p-3.5 border text-xs space-y-2 ${
                  onlineStage === 'failed'
                    ? 'border-[#A65F46] bg-[#FAF4F1] text-[#6E3B2A]'
                    : 'border-[#D8CBB9] bg-[#F2EDE4] text-[#514B43]'
                }`}
              >
                <p>{onlineMessage}</p>
                {onlineStage === 'verification_pending' && pendingVerificationPayload && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() =>
                        void runServerVerification(
                          pendingVerificationPayload,
                          fullAddress,
                          name.trim()
                        )
                      }
                      className="px-3.5 py-2 bg-[#25231F] text-[#FAF9F6] text-[11px] uppercase tracking-wider"
                    >
                      Re-check Verification Status
                    </button>
                    <Link
                      to="/account/orders"
                      className="px-3.5 py-2 border border-[#25231F] text-[#25231F] text-[11px] uppercase tracking-wider"
                    >
                      View Orders
                    </Link>
                  </div>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={isBusy || (isLiveMode && (!user || user.is_demo))}
              className="w-full py-3.5 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest hover:bg-[#A65F46] transition-colors disabled:opacity-60"
            >
              {onlineStage === 'creating_order'
                ? 'Reserving Inventory...'
                : onlineStage === 'awaiting_payment'
                  ? 'Complete Payment in Razorpay...'
                  : onlineStage === 'verifying'
                    ? 'Verifying Payment with Server...'
                    : submitting
                      ? 'Placing Order...'
                      : paymentMethod === 'online'
                        ? onlineStage === 'failed'
                          ? 'Retry Online Payment'
                          : `Pay ${formatINR(cartSubtotal + shipping)} via Razorpay`
                        : isLiveMode
                          ? 'Place COD Order'
                          : 'Place COD Demo Order'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
