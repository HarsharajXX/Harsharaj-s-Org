import React, { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { authService } from '../services/auth';
import { useCatalogue } from '../hooks/useCatalogue';
import { ProductCard } from '../components/ProductCard';
import { formatINR } from '../utils/format';
import { canCustomerCancelOrder } from '../utils/commerceRules';
import { canRequestCustomerRefund, getRefundStatusLabel } from '../services/payments/paymentStatus';
import { formatInrFromPaise, inrToPaise } from '../services/payments/paymentTypes';

export const LoginPage: React.FC = () => {
  const { isLiveMode, setSessionUser, loginDemo, showToast } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as { from?: string } | null)?.from || '/account';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await authService.signIn({ email, password });
    setLoading(false);

    if (res.error || !res.user) {
      showToast(res.error || 'Unable to sign in.', 'error');
      return;
    }

    if (res.user.isDemo) {
      loginDemo(res.user.email, res.user.fullName, res.user.roles);
    } else {
      setSessionUser(res.user);
      showToast(`Signed in as ${res.user.fullName}.`);
    }
    navigate(redirectTo, { replace: true });
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <div className="border border-[#D8CBB9] bg-[#FAF9F6] p-8">
        <p className="text-xs uppercase tracking-widest text-[#A65F46] mb-2">
          {isLiveMode ? 'NOHAJ Member Account' : 'Demo Mode · Local Session Only'}
        </p>
        <h1 className="font-serif text-3xl text-[#25231F] mb-6">Sign In</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F]"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F]"
            />
          </div>
          <div className="text-right">
            <Link to="/forgot-password" className="text-xs text-[#777168] hover:text-[#25231F] underline">
              Forgot password?
            </Link>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest hover:bg-[#A65F46] transition-colors disabled:opacity-60"
          >
            {loading ? 'Signing In...' : isLiveMode ? 'Sign In' : 'Sign In (Demo)'}
          </button>
        </form>
        <p className="mt-5 text-xs text-[#777168] text-center">
          New to NOHAJ?{' '}
          <Link to="/register" className="text-[#25231F] underline">Create an account</Link>
        </p>
      </div>
    </div>
  );
};

export const RegisterPage: React.FC = () => {
  const { isLiveMode, setSessionUser, loginDemo, showToast } = useStore();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await authService.signUpCustomer({
      email,
      password,
      fullName: name || 'NOHAJ Patron',
    });
    setLoading(false);

    if (res.error) {
      showToast(res.error, 'error');
      return;
    }

    if (res.needsVerification) {
      showToast('Account created. Please verify your email.');
      navigate(`/verify-email?email=${encodeURIComponent(email)}&role=customer`);
      return;
    }

    if (res.user) {
      if (res.user.isDemo) {
        loginDemo(res.user.email, res.user.fullName, res.user.roles);
      } else {
        setSessionUser(res.user);
      }
    }
    navigate('/account');
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <div className="border border-[#D8CBB9] bg-[#FAF9F6] p-8">
        <p className="text-xs uppercase tracking-widest text-[#A65F46] mb-2">
          {isLiveMode ? 'Customer Registration' : 'Demo Mode · Not Persisted to Live DB'}
        </p>
        <h1 className="font-serif text-3xl text-[#25231F] mb-6">Create Account</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Full Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F]"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F]"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 6 characters"
              className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F]"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest hover:bg-[#A65F46] transition-colors disabled:opacity-60"
          >
            {loading ? 'Creating Account...' : isLiveMode ? 'Create Account' : 'Register (Demo)'}
          </button>
        </form>
        <p className="mt-5 text-xs text-[#777168] text-center">
          Already have an account?{' '}
          <Link to="/login" className="text-[#25231F] underline">Sign In</Link>
        </p>
      </div>
    </div>
  );
};

export const AccountPage: React.FC = () => {
  const { user, isLiveMode, logout, orders, wishlistProducts } = useStore();
  const navigate = useNavigate();

  if (!user) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <h1 className="font-serif text-3xl text-[#25231F]">Customer Account</h1>
        <p className="mt-3 text-sm text-[#514B43]">
          {isLiveMode ? 'Please sign in to view your account.' : 'Please sign in to view your demo account.'}
        </p>
        <Link
          to="/login"
          className="inline-block mt-6 px-7 py-3 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest"
        >
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-8 border-b border-[#D8CBB9]">
        <div>
          <p className="text-xs uppercase tracking-widest text-[#A65F46]">
            {user.is_demo ? 'Demo Account' : 'NOHAJ Member'} · {user.roles.map((r) => r.replace(/_/g, ' ')).join(', ')}
          </p>
          <h1 className="font-serif text-3xl text-[#25231F] mt-1">{user.name}</h1>
          <p className="text-sm text-[#777168]">{user.email}</p>
        </div>
        <button
          type="button"
          onClick={async () => {
            await logout();
            navigate('/');
          }}
          className="px-5 py-2.5 border border-[#25231F] text-xs uppercase tracking-widest text-[#25231F]"
        >
          Sign Out
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-10">
        <Link to="/account/orders" className="p-6 border border-[#D8CBB9] bg-[#FAF9F6] hover:border-[#25231F]">
          <h2 className="font-serif text-xl text-[#25231F]">Order History</h2>
          <p className="mt-2 text-sm text-[#777168] tabular-nums">
            {orders.length} {user.is_demo ? 'demo orders' : orders.length === 1 ? 'order' : 'orders'}
          </p>
        </Link>
        <Link to="/wishlist" className="p-6 border border-[#D8CBB9] bg-[#FAF9F6] hover:border-[#25231F]">
          <h2 className="font-serif text-xl text-[#25231F]">Saved Wishlist</h2>
          <p className="mt-2 text-sm text-[#777168] tabular-nums">{wishlistProducts.length} saved pieces</p>
        </Link>
        <div className="p-6 border border-[#D8CBB9] bg-[#FAF9F6]">
          <h2 className="font-serif text-xl text-[#25231F]">Saved Addresses</h2>
          <p className="mt-2 text-sm text-[#514B43]">
            {user.saved_addresses[0] || 'Provided at checkout'}
          </p>
        </div>
      </div>
    </div>
  );
};

export const OrdersPage: React.FC = () => {
  const { orders, isLiveMode, cancelOrder, requestOrderRefund, showToast } = useStore();
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [openRefundOrderId, setOpenRefundOrderId] = useState<string | null>(null);
  const [refundMode, setRefundMode] = useState<'full' | 'items'>('full');
  const [itemQuantities, setItemQuantities] = useState<Record<string, number>>({});
  const [refundReason, setRefundReason] = useState('');
  const [submittingRefundId, setSubmittingRefundId] = useState<string | null>(null);

  const canCancelOrder = (order: (typeof orders)[number]) => canCustomerCancelOrder(order);

  const handleConfirmCancel = async (orderId: string) => {
    setCancellingId(orderId);
    await cancelOrder(orderId, 'Cancelled by customer');
    setCancellingId(null);
    setConfirmCancelId(null);
  };

  const openRefundForm = (order: (typeof orders)[number]) => {
    setOpenRefundOrderId(order.id);
    setRefundMode('full');
    setRefundReason('');
    const initialQty: Record<string, number> = {};
    for (const item of order.items || []) {
      const remaining = Math.max(0, item.quantity - (item.refunded_quantity ?? 0));
      initialQty[item.id] = remaining > 0 ? remaining : 0;
    }
    setItemQuantities(initialQty);
  };

  const handleSubmitRefund = async (order: (typeof orders)[number]) => {
    if (!refundReason.trim()) {
      showToast('Please provide a reason for your refund request.', 'error');
      return;
    }

    let selectedItems: Array<{ order_item_id: string; quantity: number }> | null = null;
    let requestedAmountPaise: number | null = null;

    if (refundMode === 'items' && order.items && order.items.length > 0) {
      selectedItems = order.items
        .map((item) => ({
          order_item_id: item.id,
          quantity: itemQuantities[item.id] || 0,
        }))
        .filter((entry) => entry.quantity > 0);

      if (selectedItems.length === 0) {
        showToast('Select at least one item quantity to refund.', 'error');
        return;
      }

      requestedAmountPaise = order.items.reduce((sum, item) => {
        const qty = itemQuantities[item.id] || 0;
        if (qty <= 0) return sum;
        const unitPaise = item.unit_price_paise ?? inrToPaise(item.unit_price);
        return sum + unitPaise * qty;
      }, 0);
    }

    setSubmittingRefundId(order.id);
    const res = await requestOrderRefund({
      orderId: order.id,
      items: selectedItems,
      amountPaise: requestedAmountPaise,
      reason: refundReason.trim(),
    });
    setSubmittingRefundId(null);

    if (res.ok) {
      setOpenRefundOrderId(null);
      setRefundReason('');
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <h1 className="font-serif text-3xl text-[#25231F] mb-8">
        {isLiveMode ? 'Order History' : 'Order History (Demo)'}
      </h1>
      {orders.length === 0 ? (
        <div className="p-10 border border-[#D8CBB9] bg-[#FAF9F6] text-center">
          <p className="text-sm text-[#514B43]">
            {isLiveMode ? 'No orders placed yet.' : 'No demo orders placed yet.'}
          </p>
          <Link to="/shop" className="inline-block mt-4 px-6 py-2.5 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest">
            Explore Collection
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => {
            const refundEligible = canRequestCustomerRefund({
              paymentMethod: order.payment_method,
              paymentStatus: order.payment_status,
              orderStatus: order.status,
            });

            return (
              <div key={order.id} className="p-6 border border-[#D8CBB9] bg-[#FAF9F6] space-y-2">
                <div className="flex flex-wrap justify-between gap-2 pb-3 border-b border-[#E6DED2]">
                  <span className="font-medium text-sm text-[#25231F] tabular-nums">
                    {order.order_number || order.id}
                  </span>
                  <span
                    className={`text-xs uppercase tracking-wider ${
                      order.status.includes('cancelled') || order.status === 'expired'
                        ? 'text-[#A65F46]'
                        : order.status === 'pending_payment'
                          ? 'text-[#8C6D46]'
                          : 'text-[#78816A]'
                    }`}
                  >
                    {order.status.replace(/_/g, ' ')}{' '}
                    {order.payment_status ? `· ${order.payment_status.replace(/_/g, ' ')}` : ''}
                  </span>
                  <span className="font-medium text-sm text-[#25231F] tabular-nums">{formatINR(order.total)}</span>
                </div>
                {order.status === 'pending_payment' && (
                  <p className="text-xs text-[#8C6D46]">
                    {order.payment_status === 'authorized'
                      ? 'Payment authorized — awaiting capture verification before fulfilment begins.'
                      : 'Online checkout reservation active — order will confirm once payment capture is verified.'}
                  </p>
                )}
                <p className="text-xs text-[#777168]">Shipping to: {order.shipping_address}</p>
                {order.cancellation_reason && (
                  <p className="text-xs text-[#A65F46]">Cancellation note: {order.cancellation_reason}</p>
                )}
                {order.seller_orders && order.seller_orders.length > 0 && (
                  <div className="pt-2 border-t border-[#E6DED2] text-xs text-[#514B43] space-y-1">
                    {order.seller_orders.map((so) => (
                      <p key={so.id}>
                        Fulfilment split: <strong>{so.fulfilment_status.replace(/_/g, ' ')}</strong> ·{' '}
                        <span className="tabular-nums">{formatINR(Number(so.subtotal))}</span>
                      </p>
                    ))}
                  </div>
                )}

                {order.refunds && order.refunds.length > 0 && (
                  <div className="pt-3 border-t border-[#E6DED2] space-y-2">
                    <p className="text-[11px] uppercase tracking-wider text-[#777168]">Refund Status</p>
                    {order.refunds.map((rf) => (
                      <div
                        key={rf.refundId}
                        className="p-3 bg-[#F2EDE4] border border-[#D8CBB9] text-xs space-y-1"
                      >
                        <div className="flex flex-wrap justify-between gap-2">
                          <span className="font-medium text-[#25231F]">
                            {getRefundStatusLabel(rf.status, rf.requestStatus)}
                          </span>
                          <span className="tabular-nums font-medium text-[#25231F]">
                            {formatInrFromPaise(rf.amountPaise)}
                          </span>
                        </div>
                        <p className="text-[#514B43]">
                          Channel: {rf.refundChannel === 'razorpay' ? 'Online (Razorpay)' : 'COD Manual Transfer'} · Type:{' '}
                          {rf.refundType.replace(/_/g, ' ')}
                        </p>
                        <p className="text-[#514B43]">Reason: {rf.reason}</p>
                        {rf.providerRefundId && (
                          <p className="text-[#777168] tabular-nums">Refund Ref: {rf.providerRefundId}</p>
                        )}
                        {rf.manualReference && (
                          <p className="text-[#777168] tabular-nums">
                            Transfer Ref: {rf.manualReference}
                            {rf.refundMethod ? ` (${rf.refundMethod})` : ''}
                          </p>
                        )}
                        {rf.rejectionReason && (
                          <p className="text-[#A65F46]">Decision note: {rf.rejectionReason}</p>
                        )}
                        {rf.restockStatus !== 'not_applicable' && (
                          <p className="text-[#777168] capitalize">
                            Return Inspection: {rf.restockStatus.replace(/_/g, ' ')}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {(canCancelOrder(order) || refundEligible) && (
                  <div className="pt-3 border-t border-[#E6DED2] flex flex-wrap items-center gap-2">
                    {canCancelOrder(order) &&
                      (confirmCancelId === order.id ? (
                        <>
                          <span className="text-xs text-[#514B43]">
                            Cancel this order and restore inventory?
                          </span>
                          <button
                            type="button"
                            disabled={cancellingId === order.id}
                            onClick={() => handleConfirmCancel(order.id)}
                            className="px-3.5 py-1.5 bg-[#A65F46] text-[#FAF9F6] text-xs uppercase tracking-wider disabled:opacity-60"
                          >
                            {cancellingId === order.id ? 'Cancelling...' : 'Confirm Cancel'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmCancelId(null)}
                            className="px-3 py-1.5 border border-[#D8CBB9] text-xs uppercase tracking-wider text-[#514B43]"
                          >
                            Keep Order
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmCancelId(order.id)}
                          className="px-3.5 py-1.5 border border-[#A65F46] text-[#A65F46] text-xs uppercase tracking-wider hover:bg-[#A65F46] hover:text-[#FAF9F6] transition-colors"
                        >
                          Cancel Order
                        </button>
                      ))}

                    {refundEligible && (
                      <button
                        type="button"
                        onClick={() =>
                          openRefundOrderId === order.id ? setOpenRefundOrderId(null) : openRefundForm(order)
                        }
                        className="px-3.5 py-1.5 border border-[#25231F] text-[#25231F] text-xs uppercase tracking-wider hover:bg-[#25231F] hover:text-[#FAF9F6] transition-colors"
                      >
                        {openRefundOrderId === order.id ? 'Close Refund Form' : 'Request Refund'}
                      </button>
                    )}
                  </div>
                )}

                {openRefundOrderId === order.id && (
                  <div className="mt-3 p-4 bg-[#F2EDE4] border border-[#D8CBB9] space-y-3">
                    <p className="text-xs uppercase tracking-wider text-[#25231F]">
                      Submit Refund Request
                    </p>
                    {order.items && order.items.length > 0 && (
                      <div className="flex flex-wrap gap-3 text-xs">
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name={`refund-mode-${order.id}`}
                            checked={refundMode === 'full'}
                            onChange={() => setRefundMode('full')}
                            className="accent-[#A65F46]"
                          />
                          <span>Full Remaining Order</span>
                        </label>
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name={`refund-mode-${order.id}`}
                            checked={refundMode === 'items'}
                            onChange={() => setRefundMode('items')}
                            className="accent-[#A65F46]"
                          />
                          <span>Select Specific Items</span>
                        </label>
                      </div>
                    )}

                    {refundMode === 'items' && order.items && (
                      <div className="space-y-2 border-t border-[#D8CBB9] pt-2">
                        {order.items.map((item) => {
                          const maxQty = Math.max(0, item.quantity - (item.refunded_quantity ?? 0));
                          return (
                            <div
                              key={item.id}
                              className="flex flex-wrap items-center justify-between gap-2 text-xs"
                            >
                              <span className="text-[#25231F]">
                                {item.product_name} ({formatINR(item.unit_price)} · max {maxQty})
                              </span>
                              <input
                                type="number"
                                min={0}
                                max={maxQty}
                                value={itemQuantities[item.id] ?? 0}
                                onChange={(e) => {
                                  const val = Math.max(0, Math.min(maxQty, Number(e.target.value) || 0));
                                  setItemQuantities((prev) => ({ ...prev, [item.id]: val }));
                                }}
                                className="w-20 px-2 py-1 bg-[#FAF9F6] border border-[#D8CBB9] tabular-nums"
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <textarea
                      rows={2}
                      placeholder="Reason for cancellation or refund request *"
                      value={refundReason}
                      onChange={(e) => setRefundReason(e.target.value)}
                      className="w-full px-3 py-2 bg-[#FAF9F6] border border-[#D8CBB9] text-xs"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={submittingRefundId === order.id}
                        onClick={() => handleSubmitRefund(order)}
                        className="px-4 py-2 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-wider disabled:opacity-60"
                      >
                        {submittingRefundId === order.id ? 'Submitting...' : 'Submit Refund Request'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setOpenRefundOrderId(null)}
                        className="px-3 py-2 border border-[#D8CBB9] text-xs uppercase tracking-wider text-[#514B43]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const WishlistPage: React.FC = () => {
  const { wishlistProducts } = useStore();
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <h1 className="font-serif text-3xl sm:text-4xl text-[#25231F] mb-8">Saved Wishlist</h1>
      {wishlistProducts.length === 0 ? (
        <div className="p-12 border border-[#D8CBB9] bg-[#FAF9F6] text-center">
          <p className="font-serif text-xl text-[#25231F]">Your wishlist is empty.</p>
          <Link to="/shop" className="inline-block mt-6 px-6 py-3 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest">
            Discover Pieces
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
          {wishlistProducts.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
};

export const SearchPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { products, loading, error } = useCatalogue();
  const q = (searchParams.get('q') || '').trim().toLowerCase();
  const results = q
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.community_name.toLowerCase().includes(q) ||
          p.category_name.toLowerCase().includes(q) ||
          p.material.toLowerCase().includes(q) ||
          p.seller_name.toLowerCase().includes(q)
      )
    : products;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <h1 className="font-serif text-3xl text-[#25231F] mb-2">
        Search Results {q ? `for "${searchParams.get('q')}"` : ''}
      </h1>
      {loading ? (
        <p className="text-sm text-[#777168] py-8">Searching collection...</p>
      ) : error ? (
        <p className="text-sm text-[#A65F46] py-8">{error}</p>
      ) : (
        <>
          <p className="text-sm text-[#777168] mb-8 tabular-nums">{results.length} pieces found</p>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
            {results.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export const ContactPage: React.FC = () => {
  const { showToast } = useStore();
  const [sent, setSent] = useState(false);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <h1 className="font-serif text-3xl sm:text-4xl text-[#25231F] mb-4">Contact NOHAJ</h1>
      <p className="text-sm sm:text-base text-[#514B43] mb-8">
        Questions about authenticity, seller onboarding, or orders? Write to us.
      </p>
      {sent ? (
        <div className="p-8 border border-[#D8CBB9] bg-[#FAF9F6] text-center">
          <p className="font-serif text-xl text-[#25231F]">Message received (Demo Mode).</p>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSent(true);
            showToast('Message sent (Demo Mode).');
          }}
          className="space-y-4 bg-[#FAF9F6] border border-[#D8CBB9] p-6 sm:p-8"
        >
          <input type="text" required placeholder="Your Name" className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm" />
          <input type="email" required placeholder="Email Address" className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm" />
          <textarea rows={4} required placeholder="Your Message" className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm" />
          <button type="submit" className="px-7 py-3 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest">
            Send Message
          </button>
        </form>
      )}
    </div>
  );
};
