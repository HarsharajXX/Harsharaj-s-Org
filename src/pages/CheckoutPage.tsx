import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { formatINR } from '../utils/format';
import { Order } from '../types';

export const CheckoutPage: React.FC = () => {
  const { cart, cartSubtotal, user, placeDemoOrder, showToast } = useStore();
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'online'>('cod');
  const [confirmedOrder, setConfirmedOrder] = useState<Order | null>(null);

  const shipping = cartSubtotal >= 5000 || cartSubtotal === 0 ? 0 : 250;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !phone.trim() || !address.trim() || !city.trim() || !pincode.trim()) {
      showToast('Please complete all required shipping fields.', 'error');
      return;
    }
    if (paymentMethod === 'online') {
      showToast('Online payment gateway is not yet configured. Please select Cash on Delivery (Demo).', 'error');
      return;
    }
    const fullAddress = `${address}, ${city} - ${pincode} (Ph: ${phone})`;
    const order = placeDemoOrder(name.trim(), email.trim(), fullAddress);
    setConfirmedOrder(order);
    showToast('COD Demo order placed successfully.');
  };

  if (confirmedOrder) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16">
        <div className="border border-[#D8CBB9] bg-[#FAF9F6] p-8 sm:p-10 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-[#78816A] mb-2">
            Demo Checkout Confirmation
          </p>
          <h1 className="font-serif text-3xl text-[#25231F]">
            Thank you, {confirmedOrder.customer_name}.
          </h1>
          <p className="mt-3 text-sm text-[#514B43]">
            Order <strong className="text-[#25231F] tabular-nums">{confirmedOrder.id}</strong> has been recorded in demo mode. No real payment was processed.
          </p>
          <div className="mt-6 p-4 bg-[#F2EDE4] border border-[#D8CBB9] text-left text-sm space-y-1">
            <p><span className="text-[#777168]">Total:</span> <strong className="tabular-nums">{formatINR(confirmedOrder.total)}</strong></p>
            <p><span className="text-[#777168]">Shipping to:</span> {confirmedOrder.shipping_address}</p>
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

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <div className="mb-8 pb-4 border-b border-[#D8CBB9]">
        <p className="text-xs uppercase tracking-widest text-[#A65F46]">
          Demo Checkout — No Live Payment Processed
        </p>
        <h1 className="font-serif text-3xl sm:text-4xl text-[#25231F] mt-1">
          Checkout
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        <div className="lg:col-span-7 space-y-6">
          <h2 className="font-serif text-xl text-[#25231F]">Customer & Shipping Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Full Name *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#FAF9F6] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none focus:border-[#25231F]"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Email *</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#FAF9F6] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none focus:border-[#25231F]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Phone Number *</label>
            <input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[#FAF9F6] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none focus:border-[#25231F]"
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Street Address *</label>
            <input
              type="text"
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[#FAF9F6] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none focus:border-[#25231F]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">City & State *</label>
              <input
                type="text"
                required
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#FAF9F6] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none focus:border-[#25231F]"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">PIN Code *</label>
              <input
                type="text"
                required
                value={pincode}
                onChange={(e) => setPincode(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#FAF9F6] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none focus:border-[#25231F]"
              />
            </div>
          </div>
        </div>

        <div className="lg:col-span-5">
          <div className="border border-[#D8CBB9] bg-[#FAF9F6] p-6 space-y-4">
            <h2 className="font-serif text-xl text-[#25231F]">Order Summary</h2>
            <div className="divide-y divide-[#E6DED2] text-sm">
              {cart.map((item) => (
                <div key={item.product.id} className="py-2.5 flex justify-between gap-4">
                  <span className="text-[#514B43]">
                    {item.product.name} × {item.quantity}
                  </span>
                  <span className="text-[#25231F] tabular-nums">
                    {formatINR(item.product.price * item.quantity)}
                  </span>
                </div>
              ))}
            </div>
            <div className="border-t border-[#D8CBB9] pt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[#514B43]">Shipping</span>
                <span className="tabular-nums">{shipping === 0 ? 'Complimentary' : formatINR(shipping)}</span>
              </div>
              <div className="flex justify-between font-medium text-base text-[#25231F]">
                <span>Total</span>
                <span className="tabular-nums">{formatINR(cartSubtotal + shipping)}</span>
              </div>
            </div>
            <div className="border-t border-[#D8CBB9] pt-4 space-y-2.5">
              <p className="text-xs uppercase tracking-wider text-[#777168]">Payment Method</p>
              <label className="flex items-center gap-2.5 text-sm text-[#25231F] cursor-pointer">
                <input
                  type="radio"
                  name="paymentMethod"
                  checked={paymentMethod === 'cod'}
                  onChange={() => setPaymentMethod('cod')}
                  className="accent-[#A65F46]"
                />
                <span>Cash on Delivery (COD)</span>
              </label>
              <label className="flex items-center gap-2.5 text-sm text-[#777168] cursor-pointer">
                <input
                  type="radio"
                  name="paymentMethod"
                  checked={paymentMethod === 'online'}
                  onChange={() => setPaymentMethod('online')}
                  className="accent-[#A65F46]"
                />
                <span>Online Payment (Gateway Pending)</span>
              </label>
            </div>
            <button
              type="submit"
              className="w-full py-3.5 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest hover:bg-[#A65F46] transition-colors"
            >
              {paymentMethod === 'cod' ? 'Place COD Demo Order' : 'Online Payment (Not Configured)'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
