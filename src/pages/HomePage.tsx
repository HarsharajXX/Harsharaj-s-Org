import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import {
  ARTISAN_LOOM_IMAGE,
  COCOON_IMAGE,
  HERO_IMAGE,
  OCCASIONS,
} from '../data/mockData';
import { ProductCard } from '../components/ProductCard';
import { useStore } from '../context/StoreContext';
import { useCatalogue } from '../hooks/useCatalogue';

export const HomePage: React.FC = () => {
  const [email, setEmail] = useState('');
  const { showToast } = useStore();
  const { communities, products, loading, mode } = useCatalogue();
  const featuredProducts = products.filter((p) => p.is_featured !== false).slice(0, 6);

  const handleNewsletter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !email.includes('@')) {
      showToast('Please enter a valid email address.', 'error');
      return;
    }
    showToast('Thank you for subscribing to NOHAJ.');
    setEmail('');
  };

  return (
    <div>
      {/* SECTION 3: HERO */}
      <section className="relative w-full min-h-[78vh] lg:min-h-[85vh] flex items-end bg-[#25231F] overflow-hidden">
        <img
          src={HERO_IMAGE}
          alt="Assamese woman wearing golden Muga silk Mekhela Sador"
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#25231F]/85 via-[#25231F]/35 to-transparent" />

        <div className="relative z-10 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pb-14 sm:pb-20 pt-32">
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.22em] text-[#E6DED2] mb-4">
              Northeast India · Handwoven Heritage
            </p>
            <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl text-[#FAF9F6] leading-[1.1] text-balance">
              Tradition deserves a wider world.
            </h1>
            <p className="mt-5 text-base sm:text-lg text-[#E6DED2] leading-relaxed max-w-xl">
              Discover the artistry, craftsmanship and heritage woven into traditional clothing from Northeast India.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                to="/shop"
                className="px-7 py-3.5 bg-[#FAF9F6] text-[#25231F] text-xs uppercase tracking-widest font-medium hover:bg-[#E6DED2] transition-colors"
              >
                Explore Collections
              </Link>
              <Link
                to="/our-story"
                className="px-7 py-3.5 border border-[#FAF9F6]/70 text-[#FAF9F6] text-xs uppercase tracking-widest font-medium hover:bg-[#FAF9F6]/10 transition-colors"
              >
                Our Story
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 4: BRAND INTRODUCTION */}
      <section className="py-20 sm:py-24 px-4 sm:px-6 lg:px-8 bg-[#F2EDE4]">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-[#777168] mb-4">
            No (New) · Haj (Cloth)
          </p>
          <h2 className="font-serif text-3xl sm:text-4xl text-[#25231F] leading-snug text-balance">
            More than clothing. A story woven through generations.
          </h2>
          <p className="mt-6 text-base sm:text-lg text-[#514B43] leading-relaxed">
            Every thread carries a story. Every garment reflects a tradition. Nohaj brings together the craftsmanship, cultural identity and timeless artistry of Northeast India.
          </p>
        </div>
      </section>

      {/* SECTION 5: SHOP BY COMMUNITY */}
      <section className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8 bg-[#FAF9F6] border-y border-[#D8CBB9]">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-12">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[#777168] mb-2">
                Shop by Community
              </p>
              <h2 className="font-serif text-3xl sm:text-4xl text-[#25231F]">
                Discover the traditions.
              </h2>
              <p className="mt-2 text-sm sm:text-base text-[#514B43] max-w-xl">
                Explore the clothing and textiles of Northeast India's diverse communities.
              </p>
            </div>
            <Link
              to="/communities"
              className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-[#25231F] hover:text-[#A65F46] transition-colors shrink-0"
            >
              All Communities <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {loading ? (
              <p className="text-sm text-[#777168] col-span-full py-6">Loading communities...</p>
            ) : communities.length === 0 ? (
              <p className="text-sm text-[#777168] col-span-full py-6">No communities published yet.</p>
            ) : (
              communities.map((comm) => (
              <Link
                key={comm.id}
                to={`/community/${comm.slug}`}
                className="group relative aspect-[4/3] overflow-hidden border border-[#D8CBB9] bg-[#E6DED2]"
              >
                <img
                  src={comm.cover_image}
                  alt={`${comm.name} traditional textiles`}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#25231F]/80 via-[#25231F]/20 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-6">
                  <p className="text-[11px] uppercase tracking-widest text-[#D8CBB9]">
                    {comm.state}
                  </p>
                  <h3 className="font-serif text-2xl text-[#FAF9F6] mt-1">
                    {comm.name}
                  </h3>
                  <span className="inline-flex items-center gap-1.5 mt-2 text-xs uppercase tracking-widest text-[#FAF9F6] group-hover:text-[#D8CBB9] transition-colors">
                    Explore Collection <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </Link>
            ))
            )}
          </div>
        </div>
      </section>

      {/* SECTION 6: FEATURED PRODUCTS */}
      <section className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8 bg-[#F2EDE4]">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-12">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[#777168] mb-2">
                {mode === 'live' ? 'Curated Collection' : 'Sample Catalogue (Demo Mode)'}
              </p>
              <h2 className="font-serif text-3xl sm:text-4xl text-[#25231F]">
                Curated for you.
              </h2>
            </div>
            <Link
              to="/shop"
              className="px-6 py-3 border border-[#25231F] text-[#25231F] text-xs uppercase tracking-widest hover:bg-[#25231F] hover:text-[#FAF9F6] transition-colors self-start sm:self-auto"
            >
              View All Products
            </Link>
          </div>

          {loading ? (
            <p className="text-sm text-[#777168] py-8">Loading featured collection...</p>
          ) : featuredProducts.length === 0 ? (
            <p className="text-sm text-[#777168] py-8">No published products available yet.</p>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-10 sm:gap-x-8 sm:gap-y-12">
              {featuredProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* SECTION 7: SHOP BY OCCASION */}
      <section className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8 bg-[#FAF9F6] border-t border-[#D8CBB9]">
        <div className="max-w-7xl mx-auto">
          <div className="mb-12">
            <p className="text-xs uppercase tracking-[0.2em] text-[#777168] mb-2">
              Shop by Occasion
            </p>
            <h2 className="font-serif text-3xl sm:text-4xl text-[#25231F]">
              Made for meaningful moments.
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {OCCASIONS.map((occ) => (
              <Link
                key={occ.title}
                to={`/shop?occasion=${encodeURIComponent(occ.filter)}`}
                className="group relative aspect-[3/4] overflow-hidden border border-[#D8CBB9] bg-[#E6DED2]"
              >
                <img
                  src={occ.image}
                  alt={occ.title}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#25231F]/85 via-[#25231F]/25 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-5">
                  <h3 className="font-serif text-xl text-[#FAF9F6] leading-snug">
                    {occ.title}
                  </h3>
                  <p className="mt-1 text-xs text-[#D8CBB9]">{occ.subtitle}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 8: THE NOHAJ STORY */}
      <section className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8 bg-[#F2EDE4] border-t border-[#D8CBB9]">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          <div className="aspect-[4/3] overflow-hidden border border-[#D8CBB9] bg-[#E6DED2]">
            <img
              src={COCOON_IMAGE}
              alt="Golden Muga silk cocoons and handspun threads"
              loading="lazy"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="max-w-lg">
            <p className="text-xs uppercase tracking-[0.2em] text-[#A65F46] mb-3">
              The NOHAJ Story
            </p>
            <h2 className="font-serif text-3xl sm:text-4xl text-[#25231F] leading-snug">
              From cocoon to creation.
            </h2>
            <div className="mt-6 space-y-4 text-base text-[#514B43] leading-relaxed">
              <p>
                Inspired by the humble cocoon and the rich silk traditions of Northeast India, Nohaj celebrates the journey of creation.
              </p>
              <p>
                From nature to thread, from thread to fabric, and from fabric to something meaningful.
              </p>
              <p>
                We believe every garment has a story worth sharing.
              </p>
            </div>
            <Link
              to="/our-story"
              className="inline-block mt-8 px-7 py-3.5 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest hover:bg-[#A65F46] transition-colors"
            >
              Discover Our Story
            </Link>
          </div>
        </div>
      </section>

      {/* SECTION 9: ARTISAN STORY */}
      <section className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8 bg-[#FAF9F6] border-t border-[#D8CBB9]">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          <div className="order-2 lg:order-1 max-w-lg">
            <p className="text-xs uppercase tracking-[0.2em] text-[#78816A] mb-3">
              Artisan Directory
            </p>
            <h2 className="font-serif text-3xl sm:text-4xl text-[#25231F] leading-snug">
              The hands behind the heritage.
            </h2>
            <p className="mt-5 text-base text-[#514B43] leading-relaxed">
              Meet the people who preserve traditions and turn threads into timeless creations.
            </p>
            <div className="mt-6 p-5 bg-[#F2EDE4] border border-[#D8CBB9]">
              <p className="text-xs uppercase tracking-wider text-[#777168]">
                Featured Demo Profile
              </p>
              <p className="font-serif text-lg text-[#25231F] mt-1">
                Bimala Basumatary — Kokrajhar, Assam
              </p>
              <p className="text-sm text-[#514B43] mt-1">
                Specialising in handwoven Bodo Dokhona and Aronai textiles on traditional wooden looms.
              </p>
            </div>
            <Link
              to="/artisans"
              className="inline-flex items-center gap-2 mt-8 text-xs uppercase tracking-widest text-[#25231F] hover:text-[#A65F46] transition-colors"
            >
              Meet Our Artisans <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="order-1 lg:order-2 aspect-[4/3] overflow-hidden border border-[#D8CBB9] bg-[#E6DED2]">
            <img
              src={ARTISAN_LOOM_IMAGE}
              alt="Northeast Indian weaver at a traditional wooden handloom"
              loading="lazy"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      </section>

      {/* SECTION 10: SELL WITH NOHAJ */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-[#25231F] text-[#FAF9F6]">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-[#D8CBB9] mb-3">
            Partner With Us
          </p>
          <h2 className="font-serif text-3xl sm:text-4xl text-[#FAF9F6] leading-snug text-balance">
            Your craftsmanship deserves a wider audience.
          </h2>
          <p className="mt-5 text-base text-[#D8CBB9] leading-relaxed max-w-2xl mx-auto">
            Are you a weaver, artisan or traditional clothing business? Bring your creations to Nohaj and connect with customers beyond your local market.
          </p>
          <Link
            to="/become-a-seller"
            className="inline-block mt-8 px-8 py-3.5 bg-[#A65F46] text-[#FAF9F6] text-xs uppercase tracking-widest hover:bg-[#8E4F39] transition-colors"
          >
            Become a Seller
          </Link>
        </div>
      </section>

      {/* SECTION 11: NEWSLETTER */}
      <section className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8 bg-[#F2EDE4]">
        <div className="max-w-xl mx-auto text-center">
          <h2 className="font-serif text-2xl sm:text-3xl text-[#25231F]">
            Stay connected to your roots.
          </h2>
          <p className="mt-3 text-sm sm:text-base text-[#514B43]">
            Discover new collections, artisan stories and the traditions behind every thread.
          </p>
          <form onSubmit={handleNewsletter} className="mt-7 flex flex-col sm:flex-row gap-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email address"
              aria-label="Email address"
              className="flex-1 px-4 py-3 bg-[#FAF9F6] border border-[#D8CBB9] text-sm text-[#25231F] placeholder-[#777168] focus:outline-none focus:border-[#25231F]"
            />
            <button
              type="submit"
              className="px-7 py-3 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest hover:bg-[#A65F46] transition-colors shrink-0"
            >
              Subscribe
            </button>
          </form>
        </div>
      </section>
    </div>
  );
};
