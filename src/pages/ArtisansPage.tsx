import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ARTISANS } from '../data/mockData';
import { useCatalogue } from '../hooks/useCatalogue';
import { ProductCard } from '../components/ProductCard';

export const ArtisansPage: React.FC = () => {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <div className="max-w-2xl mb-12">
        <p className="text-xs uppercase tracking-[0.2em] text-[#78816A] mb-2">
          Artisan Directory · Demo Profiles
        </p>
        <h1 className="font-serif text-3xl sm:text-5xl text-[#25231F]">
          The hands behind the heritage.
        </h1>
        <p className="mt-4 text-base text-[#514B43] leading-relaxed">
          Meet the weavers and artisans preserving Northeast India's textile traditions. Profiles below are demo placeholders until real artisan consent is published.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {ARTISANS.map((artisan) => (
          <Link
            key={artisan.id}
            to={`/artisan/${artisan.slug}`}
            className="group border border-[#D8CBB9] bg-[#FAF9F6] overflow-hidden flex flex-col"
          >
            <div className="aspect-[4/3] overflow-hidden bg-[#E6DED2]">
              <img
                src={artisan.portrait_image}
                alt={artisan.name}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
            </div>
            <div className="p-6 flex-1 flex flex-col justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-widest text-[#777168]">
                  {artisan.location}
                </p>
                <h2 className="font-serif text-2xl text-[#25231F] mt-1 group-hover:text-[#A65F46]">
                  {artisan.name}
                </h2>
                <p className="text-sm text-[#514B43] mt-2">{artisan.craft_specialisation}</p>
                {artisan.community_association && (
                  <p className="text-xs text-[#777168] mt-1">
                    Community: {artisan.community_association}
                  </p>
                )}
              </div>
              <span className="inline-flex items-center gap-2 mt-5 text-xs uppercase tracking-widest text-[#25231F]">
                View Profile <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
};

export const ArtisanDetailPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const { products } = useCatalogue();
  const artisan = ARTISANS.find((a) => a.slug === slug);

  if (!artisan) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <h1 className="font-serif text-3xl text-[#25231F]">Artisan profile not found</h1>
        <Link
          to="/artisans"
          className="inline-block mt-6 px-6 py-3 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest"
        >
          Back to Artisans
        </Link>
      </div>
    );
  }

  const artisanProducts = products.filter((p) => artisan.product_ids.includes(p.id));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center pb-14 border-b border-[#D8CBB9]">
        <div className="aspect-[4/3] border border-[#D8CBB9] overflow-hidden bg-[#E6DED2]">
          <img
            src={artisan.portrait_image}
            alt={artisan.name}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
        </div>
        <div>
          <p className="text-xs uppercase tracking-widest text-[#777168] mb-2">
            {artisan.location}
          </p>
          <h1 className="font-serif text-3xl sm:text-4xl text-[#25231F]">{artisan.name}</h1>
          <p className="mt-2 text-sm text-[#A65F46]">{artisan.craft_specialisation}</p>
          <p className="mt-5 text-base text-[#514B43] leading-relaxed">{artisan.biography}</p>
          <p className="mt-4 text-sm text-[#514B43] leading-relaxed">{artisan.craft_story}</p>
        </div>
      </div>

      {artisanProducts.length > 0 && (
        <section className="mt-14">
          <h2 className="font-serif text-2xl sm:text-3xl text-[#25231F] mb-8">
            Sample Creations
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
            {artisanProducts.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
