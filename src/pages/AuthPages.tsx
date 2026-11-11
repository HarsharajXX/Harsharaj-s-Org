import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authService } from '../services/auth';
import { useStore } from '../context/StoreContext';

export const SellerLoginPage: React.FC = () => {
  const { loginDemo, showToast } = useStore();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await authService.signIn({ email, password, expectedRole: 'seller' });
    setLoading(false);
    if (res.error || !res.user) {
      showToast(res.error || 'Unable to sign in.', 'error');
      return;
    }
    loginDemo(res.user.email, res.user.fullName);
    navigate('/seller/dashboard');
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <div className="border border-[#D8CBB9] bg-[#FAF9F6] p-8">
        <p className="text-xs uppercase tracking-widest text-[#A65F46] mb-2">
          {authService.isLive() ? 'Seller Portal' : 'Seller Portal · Demo Mode'}
        </p>
        <h1 className="font-serif text-3xl text-[#25231F] mb-6">Seller Sign In</h1>
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
            {loading ? 'Signing in...' : 'Sign In to Seller Portal'}
          </button>
        </form>
        <p className="mt-5 text-xs text-[#777168] text-center">
          New artisan or store?{' '}
          <Link to="/seller/register" className="text-[#25231F] underline">Register as a Seller</Link>
        </p>
      </div>
    </div>
  );
};

export const SellerRegisterPage: React.FC = () => {
  const { showToast } = useStore();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    storeName: '',
    fullName: '',
    email: '',
    password: '',
    phone: '',
    state: 'Assam',
    district: '',
    sellerType: 'Weaver',
    categories: '',
    description: '',
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await authService.signUpSeller(form);
    setLoading(false);
    if (res.error) {
      showToast(res.error, 'error');
      return;
    }
    showToast('Seller registration submitted. Please verify your email.');
    navigate(`/verify-email?email=${encodeURIComponent(form.email)}&role=seller`);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-12 sm:py-16">
      <div className="border border-[#D8CBB9] bg-[#FAF9F6] p-6 sm:p-10">
        <p className="text-xs uppercase tracking-widest text-[#A65F46] mb-2">
          {authService.isLive() ? 'Seller Onboarding' : 'Seller Onboarding · Demo Mode'}
        </p>
        <h1 className="font-serif text-3xl text-[#25231F]">Register Your Store</h1>
        <p className="mt-2 text-sm text-[#514B43]">
          Your seller account activates automatically after email verification. Payout eligibility is verified separately.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Store / Business Name *</label>
              <input
                type="text"
                required
                value={form.storeName}
                onChange={(e) => setForm({ ...form, storeName: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F]"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Contact Person *</label>
              <input
                type="text"
                required
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F]"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Email *</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F]"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Password *</label>
              <input
                type="password"
                required
                minLength={6}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F]"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Phone *</label>
              <input
                type="tel"
                required
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F]"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Seller Type *</label>
              <select
                value={form.sellerType}
                onChange={(e) => setForm({ ...form, sellerType: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F]"
              >
                <option value="Weaver">Weaver</option>
                <option value="Artisan">Artisan</option>
                <option value="Individual Seller">Individual Seller</option>
                <option value="Collective">Weaver Collective</option>
                <option value="Business">Traditional Fashion Business</option>
              </select>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">State *</label>
              <input
                type="text"
                required
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F]"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">District *</label>
              <input
                type="text"
                required
                value={form.district}
                onChange={(e) => setForm({ ...form, district: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Product Categories</label>
            <input
              type="text"
              placeholder="e.g. Mekhela Sador, Dokhona, Eri Silk Shawls"
              value={form.categories}
              onChange={(e) => setForm({ ...form, categories: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F]"
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Store Description *</label>
            <textarea
              rows={3}
              required
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F]"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest hover:bg-[#A65F46] transition-colors disabled:opacity-60"
          >
            {loading ? 'Creating Seller Account...' : 'Create Seller Account'}
          </button>
        </form>
      </div>
    </div>
  );
};

export const VerifyEmailPage: React.FC = () => {
  const [verified, setVerified] = useState(false);
  const { showToast } = useStore();

  return (
    <div className="max-w-lg mx-auto px-4 py-16">
      <div className="border border-[#D8CBB9] bg-[#FAF9F6] p-8 text-center">
        <p className="text-xs uppercase tracking-widest text-[#78816A] mb-2">
          Email Verification
        </p>
        <h1 className="font-serif text-3xl text-[#25231F]">
          {verified ? 'Email Verified' : 'Check Your Inbox'}
        </h1>
        <p className="mt-3 text-sm text-[#514B43] leading-relaxed">
          {verified
            ? 'Your account is now active. You may sign in to continue.'
            : 'We have sent a verification link to your email address. Once verified, your account will be activated automatically.'}
        </p>
        {!authService.isLive() && !verified && (
          <button
            type="button"
            onClick={() => {
              setVerified(true);
              showToast('Email verified (Demo Mode).');
            }}
            className="mt-6 px-6 py-3 bg-[#A65F46] text-[#FAF9F6] text-xs uppercase tracking-widest"
          >
            Simulate Verification (Demo Mode)
          </button>
        )}
        <div className="mt-6">
          <Link
            to="/login"
            className="inline-block px-6 py-3 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest"
          >
            Proceed to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
};

export const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { showToast } = useStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await authService.requestPasswordReset(email);
    if (!res.ok) {
      showToast(res.error || 'Could not send reset email.', 'error');
      return;
    }
    setSent(true);
    showToast('Password reset instructions sent.');
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <div className="border border-[#D8CBB9] bg-[#FAF9F6] p-8">
        <h1 className="font-serif text-3xl text-[#25231F] mb-3">Forgot Password</h1>
        {sent ? (
          <p className="text-sm text-[#514B43]">
            If an account exists for <strong>{email}</strong>, password reset instructions have been sent.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-[#514B43]">Enter your email to receive a password reset link.</p>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F]"
            />
            <button
              type="submit"
              className="w-full py-3 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest"
            >
              Send Reset Link
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export const ResetPasswordPage: React.FC = () => {
  const [password, setPassword] = useState('');
  const { showToast } = useStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await authService.updatePassword(password);
    if (!res.ok) {
      showToast(res.error || 'Could not update password.', 'error');
      return;
    }
    showToast('Password updated.');
    navigate('/login');
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <div className="border border-[#D8CBB9] bg-[#FAF9F6] p-8">
        <h1 className="font-serif text-3xl text-[#25231F] mb-4">Reset Password</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password (min 6 characters)"
            className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F]"
          />
          <button
            type="submit"
            className="w-full py-3 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest"
          >
            Update Password
          </button>
        </form>
      </div>
    </div>
  );
};

export const UnauthorizedPage: React.FC = () => (
  <div className="max-w-lg mx-auto px-4 py-20 text-center">
    <p className="text-xs uppercase tracking-widest text-[#A65F46] mb-2">Access Restricted</p>
    <h1 className="font-serif text-3xl text-[#25231F]">Unauthorized</h1>
    <p className="mt-3 text-sm text-[#514B43]">
      You do not have permission to view this page.
    </p>
    <Link
      to="/"
      className="inline-block mt-6 px-6 py-3 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest"
    >
      Return Home
    </Link>
  </div>
);
