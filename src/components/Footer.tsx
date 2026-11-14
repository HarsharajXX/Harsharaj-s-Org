import React from 'react';
import { Link } from 'react-router-dom';
import { NohajLogo } from './NohajLogo';
import { getBackendStatus } from '../lib/supabase';

export const Footer: React.FC = () => {
  const status = getBackendStatus();
  return (
    <footer className="bg-[#25231F] text-[#E6DED2] pt-16 pb-10 border-t border-[#3A3630]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10 pb-12 border-b border-[#3A3630]">
          {/* Brand */}
          <div className="lg:col-span-2 pr-4">
            <NohajLogo variant="full" light />
            <p className="mt-4 text-sm text-[#D8CBB9] leading-relaxed max-w-sm">
              A dedicated marketplace for authentic traditional clothing, handwoven textiles, and wearable cultural heritage from Northeast India.
            </p>
            <p className="mt-3 text-xs text-[#777168] tracking-wide">
              Tradition deserves a wider world.
            </p>
          </div>

          {/* Explore */}
          <div>
            <h3 className="text-xs font-sans uppercase tracking-widest text-[#FAF9F6] mb-4">
              Explore
            </h3>
            <ul className="space-y-2.5 text-sm text-[#D8CBB9]">
              <li><Link to="/shop" className="hover:text-[#FAF9F6] transition-colors">Shop All</Link></li>
              <li><Link to="/communities" className="hover:text-[#FAF9F6] transition-colors">Communities</Link></li>
              <li><Link to="/collections" className="hover:text-[#FAF9F6] transition-colors">Collections</Link></li>
              <li><Link to="/shop?sort=newest" className="hover:text-[#FAF9F6] transition-colors">New Arrivals</Link></li>
            </ul>
          </div>

          {/* About */}
          <div>
            <h3 className="text-xs font-sans uppercase tracking-widest text-[#FAF9F6] mb-4">
              About
            </h3>
            <ul className="space-y-2.5 text-sm text-[#D8CBB9]">
              <li><Link to="/our-story" className="hover:text-[#FAF9F6] transition-colors">Our Story</Link></li>
              <li><Link to="/artisans" className="hover:text-[#FAF9F6] transition-colors">Our Artisans</Link></li>
              <li><Link to="/become-a-seller" className="hover:text-[#FAF9F6] transition-colors">Become a Seller</Link></li>
              <li><Link to="/contact" className="hover:text-[#FAF9F6] transition-colors">Contact</Link></li>
            </ul>
          </div>

          {/* Support & Social */}
          <div>
            <h3 className="text-xs font-sans uppercase tracking-widest text-[#FAF9F6] mb-4">
              Support
            </h3>
            <ul className="space-y-2.5 text-sm text-[#D8CBB9]">
              <li><Link to="/contact" className="hover:text-[#FAF9F6] transition-colors">FAQs</Link></li>
              <li><Link to="/contact" className="hover:text-[#FAF9F6] transition-colors">Shipping</Link></li>
              <li><Link to="/contact" className="hover:text-[#FAF9F6] transition-colors">Returns</Link></li>
              <li><Link to="/contact" className="hover:text-[#FAF9F6] transition-colors">Privacy & Terms</Link></li>
            </ul>
            <div className="mt-6 flex items-center gap-4 text-xs text-[#D8CBB9]">
              <a href="https://instagram.com" target="_blank" rel="noreferrer" className="hover:text-[#FAF9F6]">Instagram</a>
              <a href="https://facebook.com" target="_blank" rel="noreferrer" className="hover:text-[#FAF9F6]">Facebook</a>
              <a href="https://youtube.com" target="_blank" rel="noreferrer" className="hover:text-[#FAF9F6]">YouTube</a>
            </div>
          </div>
        </div>

        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#777168]">
          <p>© 2026 NOHAJ. All rights reserved.</p>
          <p>
            {status.mode === 'live'
              ? 'Environment: Live Supabase PostgreSQL & Auth'
              : 'Environment: Demo Mode (Sample listings shown — Supabase credentials not configured)'}
          </p>
        </div>
      </div>
    </footer>
  );
};
