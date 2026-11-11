import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SlidersHorizontal, X } from 'lucide-react';
import { COMMUNITIES, PRODUCTS } from '../data/mockData';
import { ProductCard } from '../components/ProductCard';

export const ShopPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialOccasion = searchParams.get('occasion') || '';
  const initialSort = searchParams.get('sort') || 'featured';

  const [search, setSearch] = useState('');
  const [selectedCommunity, setSelectedCommunity] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedMaterial, setSelectedMaterial] = useState<string>('all');
  const [selectedMethod, setSelectedMethod] = useState<string>('all');
  const [selectedAvailability, setSelectedAvailability] = useState<string>('all');
  const [maxPrice, setMaxPrice] = useState<number>(20000);
  const [sortBy, setSortBy] = useState<string>(initialSort);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const categories = Array.from(new Set(PRODUCTS.map((p) => p.category_name)));
  const materials = Array.from(new Set(PRODUCTS.map((p) => p.material)));
  const methods = Array.from(new Set(PRODUCTS.map((p) => p.production_method)));
  const availabilities = Array.from(new Set(PRODUCTS.map((p) => p.availability)));

  const filtered = useMemo(() => {
    let list = [...PRODUCTS];

    if (initialOccasion) {
      list = list.filter((p) => p.occasion.includes(initialOccasion));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.community_name.toLowerCase().includes(q) ||
          p.material.toLowerCase().includes(q) ||
          p.seller_name.toLowerCase().includes(q)
      );
    }
    if (selectedCommunity !== 'all') {
      list = list.filter((p) => p.community_slug === selectedCommunity);
    }
    if (selectedCategory !== 'all') {
      list = list.filter((p) => p.category_name === selectedCategory);
    }
    if (selectedMaterial !== 'all') {
      list = list.filter((p) => p.material === selectedMaterial);
    }
    if (selectedMethod !== 'all') {
      list = list.filter((p) => p.production_method === selectedMethod);
    }
    if (selectedAvailability !== 'all') {
      list = list.filter((p) => p.availability === selectedAvailability);
    }
    list = list.filter((p) => p.price <= maxPrice);

    if (sortBy === 'newest') {
      list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    } else if (sortBy === 'price-asc') {
      list.sort((a, b) => a.price - b.price);
    } else if (sortBy === 'price-desc') {
      list.sort((a, b) => b.price - a.price);
    }
    return list;
  }, [
    initialOccasion,
    search,
    selectedCommunity,
    selectedCategory,
    selectedMaterial,
    selectedMethod,
    selectedAvailability,
    maxPrice,
    sortBy,
  ]);

  const resetFilters = () => {
    setSearch('');
    setSelectedCommunity('all');
    setSelectedCategory('all');
    setSelectedMaterial('all');
    setSelectedMethod('all');
    setSelectedAvailability('all');
    setMaxPrice(20000);
  };

  const FilterControls = () => (
    <div className="space-y-6">
      <div>
        <label className="block text-xs uppercase tracking-widest text-[#777168] mb-2">
          Search
        </label>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name, material, seller..."
          className="w-full px-3 py-2 bg-[#FAF9F6] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none focus:border-[#25231F]"
        />
      </div>

      <div>
        <label className="block text-xs uppercase tracking-widest text-[#777168] mb-2">
          Community
        </label>
        <select
          value={selectedCommunity}
          onChange={(e) => setSelectedCommunity(e.target.value)}
          className="w-full px-3 py-2 bg-[#FAF9F6] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none"
        >
          <option value="all">All Communities</option>
          {COMMUNITIES.map((c) => (
            <option key={c.id} value={c.slug}>{c.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-widest text-[#777168] mb-2">
          Category
        </label>
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="w-full px-3 py-2 bg-[#FAF9F6] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none"
        >
          <option value="all">All Categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-widest text-[#777168] mb-2">
          Material
        </label>
        <select
          value={selectedMaterial}
          onChange={(e) => setSelectedMaterial(e.target.value)}
          className="w-full px-3 py-2 bg-[#FAF9F6] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none"
        >
          <option value="all">All Materials</option>
          {materials.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-widest text-[#777168] mb-2">
          Production Method
        </label>
        <select
          value={selectedMethod}
          onChange={(e) => setSelectedMethod(e.target.value)}
          className="w-full px-3 py-2 bg-[#FAF9F6] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none"
        >
          <option value="all">All Methods</option>
          {methods.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-widest text-[#777168] mb-2">
          Availability
        </label>
        <select
          value={selectedAvailability}
          onChange={(e) => setSelectedAvailability(e.target.value)}
          className="w-full px-3 py-2 bg-[#FAF9F6] border border-[#D8CBB9] text-sm text-[#25231F] focus:outline-none"
        >
          <option value="all">All</option>
          {availabilities.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex justify-between text-xs uppercase tracking-widest text-[#777168] mb-2">
          <span>Max Price</span>
          <span className="tabular-nums text-[#25231F]">₹{maxPrice.toLocaleString('en-IN')}</span>
        </div>
        <input
          type="range"
          min={1000}
          max={20000}
          step={500}
          value={maxPrice}
          onChange={(e) => setMaxPrice(Number(e.target.value))}
          className="w-full accent-[#A65F46]"
        />
      </div>

      <button
        type="button"
        onClick={resetFilters}
        className="w-full py-2.5 border border-[#25231F] text-xs uppercase tracking-widest text-[#25231F] hover:bg-[#25231F] hover:text-[#FAF9F6] transition-colors"
      >
        Reset Filters
      </button>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <div className="border-b border-[#D8CBB9] pb-8 mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[#777168] mb-2">
            NOHAJ Marketplace · Sample Catalogue
          </p>
          <h1 className="font-serif text-3xl sm:text-4xl text-[#25231F]">
            Explore the Collection.
          </h1>
          {initialOccasion && (
            <p className="mt-2 text-sm text-[#A65F46]">Occasion: {initialOccasion}</p>
          )}
        </div>

        <div className="flex items-center gap-4">
          <span className="text-xs text-[#777168] tabular-nums">
            {filtered.length} {filtered.length === 1 ? 'piece' : 'pieces'}
          </span>

          <button
            type="button"
            onClick={() => setMobileFiltersOpen(true)}
            className="lg:hidden inline-flex items-center gap-2 px-4 py-2 border border-[#25231F] text-xs uppercase tracking-wider text-[#25231F]"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" /> Filters
          </button>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            aria-label="Sort products"
            className="px-3 py-2 bg-[#FAF9F6] border border-[#D8CBB9] text-xs uppercase tracking-wider text-[#25231F] focus:outline-none"
          >
            <option value="featured">Sort: Featured</option>
            <option value="newest">Sort: Newest</option>
            <option value="price-asc">Price: Low to High</option>
            <option value="price-desc">Price: High to Low</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-10">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:block lg:col-span-1">
          <FilterControls />
        </aside>

        {/* Product Grid */}
        <div className="lg:col-span-3">
          {filtered.length === 0 ? (
            <div className="py-16 text-center border border-[#D8CBB9] bg-[#FAF9F6] p-8">
              <p className="font-serif text-xl text-[#25231F]">No matching pieces found.</p>
              <p className="mt-2 text-sm text-[#777168]">
                Try adjusting your filters or search criteria.
              </p>
              <button
                type="button"
                onClick={resetFilters}
                className="mt-6 px-6 py-2.5 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest"
              >
                Clear All Filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-10 sm:gap-x-6 sm:gap-y-12">
              {filtered.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Mobile Filter Drawer */}
      {mobileFiltersOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex justify-end">
          <div
            className="fixed inset-0 bg-[#25231F]/40"
            onClick={() => setMobileFiltersOpen(false)}
          />
          <div className="relative w-80 max-w-[85vw] bg-[#F2EDE4] h-full p-6 overflow-y-auto z-10">
            <div className="flex items-center justify-between pb-4 mb-6 border-b border-[#D8CBB9]">
              <span className="font-serif text-lg text-[#25231F]">Filters</span>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                aria-label="Close filters"
              >
                <X className="w-5 h-5 text-[#25231F]" />
              </button>
            </div>
            <FilterControls />
          </div>
        </div>
      )}
    </div>
  );
};
