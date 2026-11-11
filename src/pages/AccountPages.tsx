import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { PRODUCTS } from '../data/mockData';
import { ProductCard } from '../components/ProductCard';
import { formatINR } from '../utils/format';

export const LoginPage: React.FC = () => {
  const { loginDemo } = useStore();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginDemo(email || 'patron@nohaj.com', 'Guest Patron');
    navigate('/account');
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <div className="border border-[#D8CBB9] bg-[#FAF9F6] p-8">
        <p className="text-xs uppercase tracking-widest text-[#A65F46] mb-2">
          Demo Mode · Local Session Only
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
          <button
            type="submit"
            className="w-full py-3 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest hover:bg-[#A65F46] transition-colors"
          >
            Sign In (Demo)
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
  const { loginDemo } = useStore();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginDemo(email, name || 'New Patron');
    navigate('/account');
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <div className="border border-[#D8CBB9] bg-[#FAF9F6] p-8">
        <p className="text-xs uppercase tracking-widest text-[#A65F46] mb-2">
          Demo Mode · Not Persisted to Live DB
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
          <button
            type="submit"
            className="w-full py-3 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest hover:bg-[#A65F46] transition-colors"
          >
            Register (Demo)
          </button>
        </form>
      </div>
    </div>
  );
};

export const AccountPage: React.FC = () => {
  const { user, logoutDemo, orders, wishlistProducts } = useStore();
  const navigate = useNavigate();

  if (!user) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <h1 className="font-serif text-3xl text-[#25231F]">Customer Account</h1>
        <p className="mt-3 text-sm text-[#514B43]">Please sign in to view your demo account.</p>
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
          <p className="text-xs uppercase tracking-widest text-[#A65F46]">Demo Account</p>
          <h1 className="font-serif text-3xl text-[#25231F] mt-1">{user.name}</h1>
          <p className="text-sm text-[#777168]">{user.email}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            logoutDemo();
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
          <p className="mt-2 text-sm text-[#777168] tabular-nums">{orders.length} demo orders</p>
        </Link>
        <Link to="/wishlist" className="p-6 border border-[#D8CBB9] bg-[#FAF9F6] hover:border-[#25231F]">
          <h2 className="font-serif text-xl text-[#25231F]">Saved Wishlist</h2>
          <p className="mt-2 text-sm text-[#777168] tabular-nums">{wishlistProducts.length} saved pieces</p>
        </Link>
        <div className="p-6 border border-[#D8CBB9] bg-[#FAF9F6]">
          <h2 className="font-serif text-xl text-[#25231F]">Saved Addresses</h2>
          <p className="mt-2 text-sm text-[#514B43]">{user.saved_addresses[0]}</p>
        </div>
      </div>
    </div>
  );
};

export const OrdersPage: React.FC = () => {
  const { orders } = useStore();
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <h1 className="font-serif text-3xl text-[#25231F] mb-8">Order History (Demo)</h1>
      {orders.length === 0 ? (
        <div className="p-10 border border-[#D8CBB9] bg-[#FAF9F6] text-center">
          <p className="text-sm text-[#514B43]">No demo orders placed yet.</p>
          <Link to="/shop" className="inline-block mt-4 px-6 py-2.5 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest">
            Explore Collection
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => (
            <div key={order.id} className="p-6 border border-[#D8CBB9] bg-[#FAF9F6]">
              <div className="flex flex-wrap justify-between gap-2 pb-3 border-b border-[#E6DED2]">
                <span className="font-medium text-sm text-[#25231F] tabular-nums">{order.id}</span>
                <span className="text-xs uppercase tracking-wider text-[#78816A]">{order.status}</span>
                <span className="font-medium text-sm text-[#25231F] tabular-nums">{formatINR(order.total)}</span>
              </div>
              <p className="mt-3 text-xs text-[#777168]">Shipping to: {order.shipping_address}</p>
            </div>
          ))}
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
  const q = (searchParams.get('q') || '').trim().toLowerCase();
  const results = q
    ? PRODUCTS.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.community_name.toLowerCase().includes(q) ||
          p.category_name.toLowerCase().includes(q) ||
          p.material.toLowerCase().includes(q) ||
          p.seller_name.toLowerCase().includes(q)
      )
    : PRODUCTS;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <h1 className="font-serif text-3xl text-[#25231F] mb-2">
        Search Results {q ? `for "${searchParams.get('q')}"` : ''}
      </h1>
      <p className="text-sm text-[#777168] mb-8 tabular-nums">{results.length} pieces found</p>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
        {results.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
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
