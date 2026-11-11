import React from 'react';
import { Link } from 'react-router-dom';
import { ARTISAN_LOOM_IMAGE, COCOON_IMAGE } from '../data/mockData';

export const OurStoryPage: React.FC = () => {
  return (
    <div>
      <section className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8 bg-[#F2EDE4] border-b border-[#D8CBB9]">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-[#A65F46] mb-3">
            No (New) · Haj (Cloth)
          </p>
          <h1 className="font-serif text-4xl sm:text-5xl text-[#25231F] leading-tight">
            Tradition deserves a wider world.
          </h1>
          <p className="mt-6 text-base sm:text-lg text-[#514B43] leading-relaxed">
            NOHAJ is a dedicated digital destination for discovering and purchasing authentic traditional clothing, handwoven textiles, and wearable cultural products from Northeast India.
          </p>
        </div>
      </section>

      <section className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8 bg-[#FAF9F6]">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="aspect-[4/3] border border-[#D8CBB9] overflow-hidden bg-[#E6DED2]">
            <img
              src={COCOON_IMAGE}
              alt="Muga silk cocoons and handspun threads"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="space-y-5 text-[#514B43] leading-relaxed">
            <h2 className="font-serif text-3xl text-[#25231F]">From cocoon to creation.</h2>
            <p>
              Our emblem is inspired by the silk cocoon — a quiet symbol of Northeast India's Muga, Eri, and Pat silk heritage, and of transformation: from cocoon to thread, thread to fabric, and fabric to clothing.
            </p>
            <p>
              Beginning in Assam and expanding across all eight Northeastern states, NOHAJ bridges the gap between independent weavers, indigenous clothing makers, and patrons who value authentic craftsmanship.
            </p>
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8 bg-[#F2EDE4] border-t border-[#D8CBB9]">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-5 text-[#514B43] leading-relaxed">
            <h2 className="font-serif text-3xl text-[#25231F]">A multi-vendor heritage marketplace.</h2>
            <p>
              Unlike conventional single-brand stores, NOHAJ brings together verified weavers, artisans, and local handloom businesses on one curated platform — ensuring cultural accuracy and fair visibility.
            </p>
            <div className="pt-2 flex flex-wrap gap-4">
              <Link
                to="/shop"
                className="px-6 py-3 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest hover:bg-[#A65F46] transition-colors"
              >
                Explore Collection
              </Link>
              <Link
                to="/become-a-seller"
                className="px-6 py-3 border border-[#25231F] text-[#25231F] text-xs uppercase tracking-widest hover:bg-[#25231F] hover:text-[#FAF9F6] transition-colors"
              >
                Become a Seller
              </Link>
            </div>
          </div>
          <div className="aspect-[4/3] border border-[#D8CBB9] overflow-hidden bg-[#E6DED2]">
            <img
              src={ARTISAN_LOOM_IMAGE}
              alt="Traditional handloom weaving"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      </section>
    </div>
  );
};
