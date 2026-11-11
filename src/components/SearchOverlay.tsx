import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { PRODUCTS, COMMUNITIES } from '../data/mockData';
import { formatINR } from '../utils/format';

export const SearchOverlay: React.FC = () => {
  const { isSearchOpen, setIsSearchOpen } = useStore();
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  if (!isSearchOpen) return null;

  const trimmed = query.trim().toLowerCase();
  const matches = trimmed
    ? PRODUCTS.filter(
        (p) =>
          p.name.toLowerCase().includes(trimmed) ||
          p.community_name.toLowerCase().includes(trimmed) ||
          p.category_name.toLowerCase().includes(trimmed) ||
          p.material.toLowerCase().includes(trimmed) ||
          p.seller_name.toLowerCase().includes(trimmed)
      )
    : [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed) return;
    setIsSearchOpen(false);
    navigate(`/search?q=${encodeURIComponent(query.trim())}`);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#25231F]/50 backdrop-blur-xs flex items-start justify-center pt-16 sm:pt-24 px-4">
      <div className="w-full max-w-2xl bg-[#FAF9F6] border border-[#D8CBB9] shadow-2xl p-6 sm:p-8">
        <div className="flex items-center justify-between pb-4 border-b border-[#D8CBB9]">
          <span className="text-xs uppercase tracking-widest text-[#777168]">Search NOHAJ</span>
          <button
            type="button"
            onClick={() => setIsSearchOpen(false)}
            className="p-1 text-[#25231F] hover:text-[#A65F46]"
            aria-label="Close search"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 flex items-center gap-3 border-b border-[#25231F] pb-2">
          <Search className="w-5 h-5 text-[#777168] shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Mekhela Sador, Dokhona, Muga silk, Bodo..."
            className="w-full bg-transparent text-[#25231F] placeholder-[#777168] focus:outline-none text-base"
          />
          {query && (
            <button
              type="submit"
              className="text-xs uppercase tracking-wider px-3 py-1.5 bg-[#25231F] text-[#FAF9F6] shrink-0"
            >
              Search
            </button>
          )}
        </form>

        {!trimmed ? (
          <div className="mt-6">
            <p className="text-xs uppercase tracking-widest text-[#777168] mb-3">
              Explore Communities
            </p>
            <div className="flex flex-wrap gap-2">
              {COMMUNITIES.map((c) => (
                <Link
                  key={c.id}
                  to={`/community/${c.slug}`}
                  onClick={() => setIsSearchOpen(false)}
                  className="px-3 py-1.5 text-xs border border-[#D8CBB9] text-[#514B43] hover:border-[#25231F] hover:text-[#25231F] transition-colors"
                >
                  {c.name}
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-6 max-h-80 overflow-y-auto divide-y divide-[#E6DED2]">
            {matches.length === 0 ? (
              <p className="text-sm text-[#777168] py-4">No matching pieces found for "{query}".</p>
            ) : (
              matches.map((p) => (
                <Link
                  key={p.id}
                  to={`/product/${p.slug}`}
                  onClick={() => setIsSearchOpen(false)}
                  className="flex items-center gap-4 py-3 hover:bg-[#F2EDE4] px-2 transition-colors"
                >
                  <img
                    src={p.images[0]}
                    alt={p.name}
                    className="w-12 h-16 object-cover border border-[#D8CBB9] shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-serif text-sm text-[#25231F] truncate">{p.name}</p>
                    <p className="text-xs text-[#777168]">
                      {p.community_name} · {p.material}
                    </p>
                  </div>
                  <span className="text-sm text-[#25231F] tabular-nums shrink-0">
                    {formatINR(p.price)}
                  </span>
                </Link>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
