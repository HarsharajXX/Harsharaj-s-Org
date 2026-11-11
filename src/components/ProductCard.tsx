import React from 'react';
import { Link } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { Product } from '../types';
import { formatINR } from '../utils/format';
import { useStore } from '../context/StoreContext';

interface ProductCardProps {
  product: Product;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product }) => {
  const { isInWishlist, toggleWishlist } = useStore();
  const saved = isInWishlist(product.id);

  return (
    <article className="group flex flex-col">
      <div className="relative aspect-[3/4] bg-[#E6DED2] overflow-hidden border border-[#D8CBB9]">
        <Link to={`/product/${product.slug}`} className="block w-full h-full">
          <img
            src={product.images[0]}
            alt={product.name}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        </Link>
        <button
          type="button"
          onClick={() => toggleWishlist(product.id)}
          aria-label={saved ? 'Remove from wishlist' : 'Add to wishlist'}
          className="absolute top-3 right-3 p-2 bg-[#FAF9F6]/90 hover:bg-[#FAF9F6] text-[#25231F] border border-[#D8CBB9] transition-colors"
        >
          <Heart className={`w-4 h-4 ${saved ? 'fill-[#A65F46] text-[#A65F46]' : ''}`} />
        </button>
      </div>

      <div className="pt-3.5 flex flex-col flex-1 justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-[#777168]">
            <span>{product.community_name}</span>
            <span aria-hidden="true">·</span>
            <span>{product.production_method}</span>
          </div>
          <Link to={`/product/${product.slug}`} className="block mt-1">
            <h3 className="font-serif text-base text-[#25231F] group-hover:text-[#A65F46] transition-colors line-clamp-1">
              {product.name}
            </h3>
          </Link>
          <p className="mt-0.5 text-xs text-[#777168] truncate">{product.seller_name}</p>
        </div>

        <div className="mt-2.5 flex items-center justify-between pt-2 border-t border-[#E6DED2]">
          <span className="text-sm font-medium text-[#25231F] tabular-nums">
            {formatINR(product.price)}
          </span>
          <Link
            to={`/product/${product.slug}`}
            className="text-xs uppercase tracking-wider text-[#514B43] hover:text-[#A65F46] transition-colors"
          >
            View Product
          </Link>
        </div>
      </div>
    </article>
  );
};
