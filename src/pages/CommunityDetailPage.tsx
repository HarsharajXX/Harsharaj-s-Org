import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { COMMUNITIES, PRODUCTS } from '../data/mockData';
import { ProductCard } from '../components/ProductCard';

export const CommunityDetailPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [sortBy, setSortBy] = useState('featured');

  const community = COMMUNITIES.find((c) => c.slug === slug);

  if (!community) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <h1 className="font-serif text-3xl text-[#25231F]">Collection not found</h1>
        <Link
          to="/communities"
          className="inline-block mt-6 px-6 py-3 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest"
        >
          Browse Communities
        </Link>
      </div>
    );
  }

  const products = PRODUCTS.filter((p) => p.community_slug === community.slug).sort((a, b) => {
    if (sortBy === 'price-asc') return a.price - b.price;
    if (sortBy === 'price-desc') return b.price - a.price;
    return 0;
  });

  return (
    <div>
      {/* Community Banner */}
      <section className="relative h-72 sm:h-96 bg-[#25231F] overflow-hidden flex items-end">
        <img
          src={community.cover_image}
          alt={community.name}
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover opacity-70"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#25231F]/90 via-[#25231F]/40 to-transparent" />
        <div className="relative z-10 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pb-10">
          <p className="text-xs uppercase tracking-[0.2em] text-[#D8CBB9] mb-2">
            {community.state}
          </p>
          <h1 className="font-serif text-3xl sm:text-5xl text-[#FAF9F6]">
            {community.name} Collection
          </h1>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <div className="max-w-3xl mb-12 pb-8 border-b border-[#D8CBB9]">
          <p className="text-base sm:text-lg text-[#25231F] leading-relaxed">
            {community.description}
          </p>
          <p className="mt-3 text-sm text-[#514B43] leading-relaxed">
            {community.cultural_note}
          </p>
        </div>

        <div className="flex items-center justify-between mb-8">
          <span className="text-xs uppercase tracking-widest text-[#777168] tabular-nums">
            {products.length} {products.length === 1 ? 'piece' : 'pieces'}
          </span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            aria-label="Sort community products"
            className="px-3 py-2 bg-[#FAF9F6] border border-[#D8CBB9] text-xs uppercase tracking-wider text-[#25231F]"
          >
            <option value="featured">Sort: Featured</option>
            <option value="price-asc">Price: Low to High</option>
            <option value="price-desc">Price: High to Low</option>
          </select>
        </div>

        {products.length === 0 ? (
          <div className="p-12 border border-[#D8CBB9] bg-[#FAF9F6] text-center">
            <p className="font-serif text-xl text-[#25231F]">
              Sample listings for {community.name} are being curated.
            </p>
            <Link
              to="/shop"
              className="inline-block mt-5 px-6 py-2.5 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest"
            >
              Explore All Pieces
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-10 sm:gap-x-8 sm:gap-y-12">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
