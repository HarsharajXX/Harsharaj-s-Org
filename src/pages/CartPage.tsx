import React from 'react';
import { Link } from 'react-router-dom';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { formatINR } from '../utils/format';

export const CartPage: React.FC = () => {
  const { cart, cartSubtotal, updateQuantity, removeFromCart } = useStore();
  const shipping = cartSubtotal >= 5000 || cartSubtotal === 0 ? 0 : 250;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <h1 className="font-serif text-3xl sm:text-4xl text-[#25231F] mb-8">
        Shopping Bag
      </h1>

      {cart.length === 0 ? (
        <div className="border border-[#D8CBB9] bg-[#FAF9F6] p-12 text-center">
          <p className="font-serif text-xl text-[#25231F]">Your bag is currently empty.</p>
          <p className="mt-2 text-sm text-[#777168]">
            Discover handwoven textiles and traditional attire from Northeast India.
          </p>
          <Link
            to="/shop"
            className="inline-block mt-6 px-7 py-3 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest hover:bg-[#A65F46] transition-colors"
          >
            Continue Shopping
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-8 divide-y divide-[#D8CBB9] border-t border-b border-[#D8CBB9]">
            {cart.map((item) => (
              <div key={item.product.id} className="py-6 flex gap-5">
                <Link to={`/product/${item.product.slug}`} className="w-24 aspect-[3/4] shrink-0 border border-[#D8CBB9] bg-[#E6DED2]">
                  <img
                    src={item.product.images[0]}
                    alt={item.product.name}
                    className="w-full h-full object-cover"
                  />
                </Link>
                <div className="flex-1 flex flex-col justify-between">
                  <div className="flex justify-between gap-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-[#777168]">
                        {item.product.community_name}
                      </p>
                      <Link
                        to={`/product/${item.product.slug}`}
                        className="font-serif text-lg text-[#25231F] hover:text-[#A65F46]"
                      >
                        {item.product.name}
                      </Link>
                      <p className="text-xs text-[#777168] mt-1">
                        {item.selectedSize} · {item.selectedColour}
                      </p>
                    </div>
                    <span className="text-sm font-medium text-[#25231F] tabular-nums">
                      {formatINR(item.product.price * item.quantity)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between mt-4">
                    <div className="inline-flex items-center border border-[#D8CBB9] bg-[#FAF9F6]">
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                        className="p-2 text-[#25231F] hover:bg-[#E6DED2]"
                        aria-label="Decrease quantity"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="px-4 text-xs tabular-nums text-[#25231F]">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                        className="p-2 text-[#25231F] hover:bg-[#E6DED2]"
                        aria-label="Increase quantity"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeFromCart(item.product.id)}
                      className="inline-flex items-center gap-1.5 text-xs text-[#777168] hover:text-[#A65F46]"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="lg:col-span-4">
            <div className="border border-[#D8CBB9] bg-[#FAF9F6] p-6 space-y-4">
              <h2 className="font-serif text-xl text-[#25231F]">Order Summary</h2>
              <div className="space-y-2 text-sm border-b border-[#D8CBB9] pb-4">
                <div className="flex justify-between">
                  <span className="text-[#514B43]">Subtotal</span>
                  <span className="text-[#25231F] tabular-nums">{formatINR(cartSubtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#514B43]">Estimated Shipping</span>
                  <span className="text-[#25231F] tabular-nums">
                    {shipping === 0 ? 'Complimentary' : formatINR(shipping)}
                  </span>
                </div>
              </div>
              <div className="flex justify-between font-medium text-base text-[#25231F]">
                <span>Total</span>
                <span className="tabular-nums">{formatINR(cartSubtotal + shipping)}</span>
              </div>
              <Link
                to="/checkout"
                className="block w-full text-center py-3.5 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest hover:bg-[#A65F46] transition-colors"
              >
                Proceed to Checkout
              </Link>
              <Link
                to="/shop"
                className="block w-full text-center py-2.5 text-xs uppercase tracking-widest text-[#514B43] hover:text-[#25231F]"
              >
                Continue Shopping
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
