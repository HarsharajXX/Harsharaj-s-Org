import React, { useState } from 'react';
import { useStore } from '../context/StoreContext';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

export const BecomeSellerPage: React.FC = () => {
  const { isLiveMode, showToast } = useStore();
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    businessName: '',
    phone: '',
    email: '',
    location: '',
    categories: '',
    community: '',
    description: '',
    socialLink: '',
    additionalInfo: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fullName.trim() || !form.businessName.trim() || !form.phone.trim() || !form.email.trim() || !form.location.trim()) {
      showToast('Please fill in all required fields.', 'error');
      return;
    }

    if (isLiveMode && isSupabaseConfigured && supabase) {
      setSubmitting(true);
      const { error } = await supabase.from('seller_applications').insert({
        applicant_name: form.fullName.trim(),
        business_name: form.businessName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        location: form.location.trim(),
        categories: form.categories
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
        community_association: form.community.trim() || null,
        description: form.description.trim(),
        social_link: form.socialLink.trim() || null,
      });
      setSubmitting(false);

      if (error) {
        showToast(error.message, 'error');
        return;
      }
      setSubmitted(true);
      showToast('Seller application submitted.');
      return;
    }

    setSubmitted(true);
    showToast('Seller application submitted (Demo Mode).');
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <div className="max-w-2xl mb-12">
        <p className="text-xs uppercase tracking-[0.2em] text-[#A65F46] mb-2">
          Seller Recruitment
        </p>
        <h1 className="font-serif text-3xl sm:text-5xl text-[#25231F] leading-tight">
          Bring your craftsmanship to the world.
        </h1>
        <p className="mt-4 text-base text-[#514B43] leading-relaxed">
          Join Nohaj and introduce your traditional creations to customers beyond your local market.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-14 pb-12 border-b border-[#D8CBB9]">
        {[
          { title: 'Wider Reach', desc: 'Connect with customers across India who seek authentic Northeast Indian textiles.' },
          { title: 'Digital Showcasing', desc: 'Present your handwoven garments in a refined editorial storefront.' },
          { title: 'Presentation Support', desc: 'Guidance on product photography, sizing details, and storytelling.' },
          { title: 'Sustainable Growth', desc: 'Build a long-term digital presence for your weaving business.' },
        ].map((item) => (
          <div key={item.title} className="p-5 bg-[#FAF9F6] border border-[#D8CBB9]">
            <h2 className="font-serif text-lg text-[#25231F]">{item.title}</h2>
            <p className="mt-2 text-xs text-[#514B43] leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </div>

      {submitted ? (
        <div className="p-10 border border-[#D8CBB9] bg-[#FAF9F6] text-center max-w-2xl mx-auto">
          <h2 className="font-serif text-2xl text-[#25231F]">Application Received</h2>
          <p className="mt-3 text-sm text-[#514B43]">
            Thank you, {form.fullName}. Your application for <strong>{form.businessName}</strong>{' '}
            {isLiveMode ? 'has been recorded.' : 'has been recorded in demo mode.'} Our team reviews all seller applications carefully.
          </p>
          <button
            type="button"
            onClick={() => setSubmitted(false)}
            className="mt-6 px-6 py-2.5 border border-[#25231F] text-xs uppercase tracking-widest text-[#25231F]"
          >
            Submit Another Application
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="max-w-3xl space-y-6 bg-[#FAF9F6] border border-[#D8CBB9] p-6 sm:p-10">
          <h2 className="font-serif text-2xl text-[#25231F]">Seller Application Form</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Full Name *</label>
              <input
                type="text"
                required
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none focus:border-[#25231F]"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Business / Artisan Name *</label>
              <input
                type="text"
                required
                value={form.businessName}
                onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none focus:border-[#25231F]"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Phone *</label>
              <input
                type="tel"
                required
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none focus:border-[#25231F]"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Email *</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none focus:border-[#25231F]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Location (Town / District / State) *</label>
              <input
                type="text"
                required
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none focus:border-[#25231F]"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Community Association (Optional)</label>
              <input
                type="text"
                value={form.community}
                onChange={(e) => setForm({ ...form, community: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none focus:border-[#25231F]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Product Categories</label>
            <input
              type="text"
              placeholder="e.g., Mekhela Sador, Dokhona, Eri Silk Shawls, Gamosa"
              value={form.categories}
              onChange={(e) => setForm({ ...form, categories: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none focus:border-[#25231F]"
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Product Description *</label>
            <textarea
              rows={3}
              required
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none focus:border-[#25231F]"
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">Website or Instagram (Optional)</label>
            <input
              type="text"
              value={form.socialLink}
              onChange={(e) => setForm({ ...form, socialLink: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none focus:border-[#25231F]"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="px-8 py-3.5 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest hover:bg-[#A65F46] transition-colors disabled:opacity-60"
          >
            {submitting ? 'Submitting...' : 'Submit Application'}
          </button>
        </form>
      )}
    </div>
  );
};
