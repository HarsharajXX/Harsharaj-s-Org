import React, { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Search, User, Heart, ShoppingBag, Menu, X } from 'lucide-react';
import { NohajLogo } from './NohajLogo';
import { useStore } from '../context/StoreContext';

export const Navbar: React.FC = () => {
  const { cartCount, wishlist, user, setIsSearchOpen } = useStore();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navLinks = [
    { to: '/', label: 'Home' },
    { to: '/shop', label: 'Shop' },
    { to: '/communities', label: 'Communities' },
    { to: '/our-story', label: 'Our Story' },
    { to: '/artisans', label: 'Our Artisans' },
  ];

  return (
    <header className="sticky top-0 z-40 w-full">
      {/* Section 1: Announcement Bar */}
      <div className="bg-[#25231F] text-[#FAF9F6] text-xs tracking-widest uppercase text-center py-2 px-4">
        Discover the heritage of Northeast India.
      </div>

      {/* Section 2: Main Navigation */}
      <div className="bg-[#F2EDE4]/95 backdrop-blur-sm border-b border-[#D8CBB9]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          {/* Mobile Menu Trigger */}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="lg:hidden p-2 -ml-2 text-[#25231F] hover:text-[#A65F46] transition-colors"
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Left: NOHAJ Logo */}
          <Link to="/" className="shrink-0" aria-label="NOHAJ Home">
            <NohajLogo variant="full" />
          </Link>

          {/* Centre: Desktop Navigation Links */}
          <nav className="hidden lg:flex items-center gap-8">
            {navLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `text-sm tracking-wide whitespace-nowrap shrink-0 transition-colors pb-0.5 border-b ${
                    isActive
                      ? 'text-[#25231F] border-[#25231F] font-medium'
                      : 'text-[#514B43] border-transparent hover:text-[#25231F] hover:border-[#D8CBB9]'
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          {/* Right: Utility Actions */}
          <div className="flex items-center gap-4 sm:gap-5 shrink-0">
            <button
              type="button"
              onClick={() => setIsSearchOpen(true)}
              className="p-1.5 text-[#25231F] hover:text-[#A65F46] transition-colors"
              aria-label="Search"
            >
              <Search className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            <Link
              to={user ? '/account' : '/login'}
              className="hidden sm:inline-flex p-1.5 text-[#25231F] hover:text-[#A65F46] transition-colors"
              aria-label="Account"
            >
              <User className="w-5 h-5" />
            </Link>

            <Link
              to="/wishlist"
              className="hidden sm:inline-flex relative p-1.5 text-[#25231F] hover:text-[#A65F46] transition-colors"
              aria-label="Wishlist"
            >
              <Heart className="w-5 h-5" />
              {wishlist.length > 0 && (
                <span className="absolute -top-0.5 -right-1 w-4 h-4 rounded-full bg-[#A65F46] text-[#FAF9F6] text-[10px] flex items-center justify-center tabular-nums">
                  {wishlist.length}
                </span>
              )}
            </Link>

            <Link
              to="/cart"
              className="relative p-1.5 text-[#25231F] hover:text-[#A65F46] transition-colors"
              aria-label="Shopping Bag"
            >
              <ShoppingBag className="w-5 h-5" />
              {cartCount > 0 && (
                <span className="absolute -top-0.5 -right-1 w-4 h-4 rounded-full bg-[#25231F] text-[#FAF9F6] text-[10px] flex items-center justify-center tabular-nums">
                  {cartCount}
                </span>
              )}
            </Link>
          </div>
        </div>
      </div>

      {/* Mobile Slide-out Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-[#25231F]/40 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative w-80 max-w-[85vw] bg-[#F2EDE4] h-full shadow-xl flex flex-col justify-between p-6 z-10">
            <div>
              <div className="flex items-center justify-between pb-6 border-b border-[#D8CBB9]">
                <NohajLogo variant="full" />
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="p-2 text-[#25231F]"
                  aria-label="Close menu"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav className="mt-6 flex flex-col gap-4">
                {navLinks.map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    onClick={() => setMobileOpen(false)}
                    className="text-lg font-serif text-[#25231F] hover:text-[#A65F46] py-1"
                  >
                    {link.label}
                  </Link>
                ))}
                <hr className="border-[#D8CBB9] my-2" />
                <Link
                  to="/become-a-seller"
                  onClick={() => setMobileOpen(false)}
                  className="text-sm text-[#514B43] hover:text-[#25231F] py-1"
                >
                  Become a Seller
                </Link>
                <Link
                  to="/wishlist"
                  onClick={() => setMobileOpen(false)}
                  className="text-sm text-[#514B43] hover:text-[#25231F] py-1"
                >
                  Wishlist ({wishlist.length})
                </Link>
                <Link
                  to={user ? '/account' : '/login'}
                  onClick={() => setMobileOpen(false)}
                  className="text-sm text-[#514B43] hover:text-[#25231F] py-1"
                >
                  {user ? 'My Account' : 'Sign In / Register'}
                </Link>
              </nav>
            </div>
            <p className="text-xs text-[#777168]">
              Tradition deserves a wider world.
            </p>
          </div>
        </div>
      )}
    </header>
  );
};
