import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useCatalogue } from '../hooks/useCatalogue';

export const CommunitiesPage: React.FC = () => {
  const { communities, loading, error } = useCatalogue();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <div className="max-w-2xl mb-12">
        <p className="text-xs uppercase tracking-[0.2em] text-[#777168] mb-2">
          Cultural Heritage
        </p>
        <h1 className="font-serif text-3xl sm:text-5xl text-[#25231F]">
          Communities of Northeast India.
        </h1>
        <p className="mt-4 text-base text-[#514B43] leading-relaxed">
          Beginning with Assam and expanding across all eight Northeastern states, NOHAJ honours the distinct weaving traditions of each community.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-[#777168]">Loading communities...</p>
      ) : error ? (
        <p className="text-sm text-[#A65F46]">{error}</p>
      ) : communities.length === 0 ? (
        <p className="text-sm text-[#777168]">No communities found.</p>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {communities.map((comm) => (
          <Link
            key={comm.id}
            to={`/community/${comm.slug}`}
            className="group flex flex-col border border-[#D8CBB9] bg-[#FAF9F6] overflow-hidden"
          >
            <div className="aspect-[4/3] overflow-hidden bg-[#E6DED2]">
              <img
                src={comm.cover_image}
                alt={comm.name}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
            </div>
            <div className="p-6 flex-1 flex flex-col justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-widest text-[#777168]">
                  {comm.state}
                </p>
                <h2 className="font-serif text-2xl text-[#25231F] mt-1 group-hover:text-[#A65F46] transition-colors">
                  {comm.name}
                </h2>
                <p className="mt-3 text-sm text-[#514B43] leading-relaxed">
                  {comm.description}
                </p>
              </div>
              <span className="inline-flex items-center gap-2 mt-5 text-xs uppercase tracking-widest text-[#25231F]">
                Explore Collection <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </div>
          </Link>
        ))}
      </div>
      )}
    </div>
  );
};
