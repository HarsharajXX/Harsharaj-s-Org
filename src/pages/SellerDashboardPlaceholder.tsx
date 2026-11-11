import React from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../context/StoreContext';

export const SellerDashboardPlaceholder: React.FC = () => {
  const { user } = useStore();

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <div className="pb-6 border-b border-[#D8CBB9]">
        <p className="text-xs uppercase tracking-widest text-[#78816A]">
          Seller Portal · Account Active
        </p>
        <h1 className="font-serif text-3xl sm:text-4xl text-[#25231F] mt-1">
          Welcome, {user?.name || 'Seller'}
        </h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
        <div className="p-6 border border-[#D8CBB9] bg-[#FAF9F6]">
          <h2 className="font-serif text-xl text-[#25231F]">Store Status</h2>
          <p className="mt-2 text-sm text-[#514B43]">
            Account Status: <strong className="text-[#78816A]">Active</strong>
          </p>
          <p className="mt-1 text-sm text-[#514B43]">
            Payout Verification: <strong className="text-[#A65F46]">Pending Separate Verification</strong>
          </p>
        </div>

        <div className="p-6 border border-[#D8CBB9] bg-[#FAF9F6]">
          <h2 className="font-serif text-xl text-[#25231F]">Product Submissions</h2>
          <p className="mt-2 text-sm text-[#514B43]">
            Seller product management and admin approval workflows will be enabled in the next development stage.
          </p>
          <Link
            to="/shop"
            className="inline-block mt-4 text-xs uppercase tracking-widest text-[#25231F] underline"
          >
            View Public Storefront
          </Link>
        </div>
      </div>
    </div>
  );
};
