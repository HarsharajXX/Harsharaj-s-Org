import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Heart, ArrowLeft } from 'lucide-react';
import { useCatalogue } from '../hooks/useCatalogue';
import { formatINR } from '../utils/format';
import { useStore } from '../context/StoreContext';
import { ProductCard } from '../components/ProductCard';
import { CareInstructionsModal } from '../components/CareInstructionsModal';

export const ProductDetailPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { addToCart, toggleWishlist, isInWishlist } = useStore();
  const { products, loading, mode, error } = useCatalogue();

  const [activeImage, setActiveImage] = useState(0);
  const [careModalOpen, setCareModalOpen] = useState(false);
  const [selectedSizeState, setSelectedSizeState] = useState<string | null>(null);
  const [selectedColourState, setSelectedColourState] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <p className="text-sm text-[#777168]">Loading piece details...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <h1 className="font-serif text-3xl text-[#25231F]">Unable to load piece</h1>
        <p className="mt-3 text-sm text-[#A65F46]">{error}</p>
        <Link
          to="/shop"
          className="inline-block mt-6 px-6 py-3 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest"
        >
          Return to Shop
        </Link>
      </div>
    );
  }

  const product = products.find((p) => p.slug === slug);

  if (!product) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <h1 className="font-serif text-3xl text-[#25231F]">Piece not found</h1>
        <Link
          to="/shop"
          className="inline-block mt-6 px-6 py-3 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest"
        >
          Return to Shop
        </Link>
      </div>
    );
  }

  const saved = isInWishlist(product.id);
  const related = products
    .filter((p) => p.id !== product.id && (p.community_id === product.community_id || p.is_featured))
    .slice(0, 3);

  const variants = product.variants || [];
  const selectedSize =
    selectedSizeState && product.sizes.includes(selectedSizeState)
      ? selectedSizeState
      : product.sizes[0] || 'Free Size';
  const selectedColour =
    selectedColourState && product.colours.includes(selectedColourState)
      ? selectedColourState
      : product.colours[0] || 'Natural';

  const matchedVariant =
    variants.length > 0
      ? variants.find((v) => v.size === selectedSize && v.colour === selectedColour) ||
        variants.find((v) => v.size === selectedSize) ||
        variants.find((v) => v.colour === selectedColour) ||
        variants[0]
      : undefined;

  const effectivePrice = matchedVariant?.price_override ?? product.price;
  const effectiveStock = matchedVariant ? matchedVariant.stock_quantity : product.stock_quantity;
  const isOutOfStock =
    (variants.length === 0 && product.availability === 'Out of Stock') ||
    (typeof effectiveStock === 'number' && effectiveStock <= 0);

  const handleAddToBag = () => {
    addToCart(
      product,
      1,
      matchedVariant?.size ?? selectedSize,
      matchedVariant?.colour ?? selectedColour,
      matchedVariant?.id,
      effectivePrice
    );
  };

  const handleBuyNow = () => {
    if (isOutOfStock) return;
    handleAddToBag();
    navigate('/checkout');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-16">
      <Link
        to="/shop"
        className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-[#777168] hover:text-[#25231F] mb-8"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Collection
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        {/* Left: Image Gallery */}
        <div className="lg:col-span-7 space-y-4">
          <div className="aspect-[3/4] bg-[#E6DED2] border border-[#D8CBB9] overflow-hidden">
            <img
              src={product.images[activeImage] || product.images[0]}
              alt={product.name}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>
          {product.images.length > 1 && (
            <div className="flex gap-3">
              {product.images.map((img, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setActiveImage(idx)}
                  className={`w-20 aspect-[3/4] border overflow-hidden ${
                    activeImage === idx ? 'border-[#25231F]' : 'border-[#D8CBB9] opacity-70'
                  }`}
                >
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Contiguous Purchase Module */}
        <div className="lg:col-span-5">
          <div className="lg:sticky lg:top-28 space-y-6">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#777168]">
                <Link to={`/community/${product.community_slug}`} className="hover:text-[#A65F46]">
                  {product.community_name}
                </Link>
                <span aria-hidden="true">·</span>
                <span>{product.category_name}</span>
              </div>
              <h1 className="font-serif text-3xl sm:text-4xl text-[#25231F] mt-2 leading-tight">
                {product.name}
              </h1>
              <p className="mt-3 text-xl font-medium text-[#25231F] tabular-nums">
                {formatINR(effectivePrice)}
              </p>
              <p className="mt-1 text-xs text-[#777168]">
                {isOutOfStock ? 'Out of Stock' : product.availability} · {product.dispatch_time}
                {typeof effectiveStock === 'number' && effectiveStock > 0 && effectiveStock <= 5
                  ? ` · Only ${effectiveStock} left`
                  : ''}
              </p>
            </div>

            <p className="text-sm sm:text-base text-[#514B43] leading-relaxed border-t border-[#D8CBB9] pt-5">
              {product.description}
            </p>

            {/* Variant Selectors */}
            {(product.sizes.length > 1 || product.colours.length > 1 || variants.length > 0) && (
              <div className="space-y-4 border-t border-[#D8CBB9] pt-4">
                {product.sizes.length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-[#777168] mb-2">
                      Size: <span className="text-[#25231F]">{selectedSize}</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {product.sizes.map((size) => (
                        <button
                          key={size}
                          type="button"
                          onClick={() => setSelectedSizeState(size)}
                          className={`px-3 py-1.5 text-xs border transition-colors ${
                            selectedSize === size
                              ? 'border-[#25231F] bg-[#25231F] text-[#FAF9F6]'
                              : 'border-[#D8CBB9] bg-[#FAF9F6] text-[#25231F] hover:border-[#25231F]'
                          }`}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {product.colours.length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-[#777168] mb-2">
                      Colour: <span className="text-[#25231F]">{selectedColour}</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {product.colours.map((colour) => (
                        <button
                          key={colour}
                          type="button"
                          onClick={() => setSelectedColourState(colour)}
                          className={`px-3 py-1.5 text-xs border transition-colors ${
                            selectedColour === colour
                              ? 'border-[#25231F] bg-[#25231F] text-[#FAF9F6]'
                              : 'border-[#D8CBB9] bg-[#FAF9F6] text-[#25231F] hover:border-[#25231F]'
                          }`}
                        >
                          {colour}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Primary Actions */}
            <div className="space-y-3 pt-2">
              <button
                type="button"
                disabled={isOutOfStock}
                onClick={handleAddToBag}
                className="w-full py-3.5 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest hover:bg-[#A65F46] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isOutOfStock ? 'Out of Stock' : 'Add to Bag'}
              </button>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={isOutOfStock}
                  onClick={handleBuyNow}
                  className="py-3 border border-[#25231F] text-[#25231F] text-xs uppercase tracking-widest hover:bg-[#25231F] hover:text-[#FAF9F6] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Buy Now
                </button>
                <button
                  type="button"
                  onClick={() => toggleWishlist(product.id)}
                  className="py-3 border border-[#D8CBB9] text-[#25231F] text-xs uppercase tracking-widest hover:border-[#25231F] transition-colors inline-flex items-center justify-center gap-2"
                >
                  <Heart className={`w-3.5 h-3.5 ${saved ? 'fill-[#A65F46] text-[#A65F46]' : ''}`} />
                  {saved ? 'Saved' : 'Add to Wishlist'}
                </button>
              </div>
            </div>

            {/* Craftsmanship & Details */}
            <div className="border-t border-[#D8CBB9] pt-6 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-[#777168]">Material</span>
                <span className="text-[#25231F] text-right">{product.material}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[#777168]">Production Method</span>
                <span className="text-[#25231F] text-right">{product.production_method}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[#777168]">Size</span>
                <span className="text-[#25231F] text-right">{selectedSize}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[#777168]">Measurements</span>
                <span className="text-[#25231F] text-right max-w-xs">{product.measurements}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[#777168]">Colour</span>
                <span className="text-[#25231F] text-right">{selectedColour}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[#777168]">Seller</span>
                <span className="text-[#25231F] text-right">{product.seller_name}</span>
              </div>
            </div>

            {/* Care & Shipping */}
            <div className="border-t border-[#D8CBB9] pt-5 space-y-3 text-xs text-[#514B43] leading-relaxed">
              <div>
                <p>
                  <strong className="text-[#25231F] uppercase tracking-wider">Care Instructions:</strong>{' '}
                  {product.care_instructions}
                </p>
                <button
                  type="button"
                  onClick={() => setCareModalOpen(true)}
                  className="mt-1.5 text-xs uppercase tracking-widest text-[#A65F46] hover:text-[#25231F] underline underline-offset-4 transition-colors"
                >
                  View Fabric Care Guide (Muga, Eri & Pat Silk)
                </button>
              </div>
              <p>
                <strong className="text-[#25231F] uppercase tracking-wider">Shipping & Returns:</strong>{' '}
                {mode === 'live'
                  ? 'Complimentary shipping on orders above ₹5,000. Cash on Delivery available; online payment gateway pending configuration.'
                  : 'Complimentary shipping on orders above ₹5,000. Sample demo listing — no live payment or dispatch.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <CareInstructionsModal
        isOpen={careModalOpen}
        onClose={() => setCareModalOpen(false)}
        material={product.material}
      />

      {/* Related Products */}
      <section className="mt-20 pt-14 border-t border-[#D8CBB9]">
        <h2 className="font-serif text-2xl sm:text-3xl text-[#25231F] mb-8">
          You may also appreciate
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
          {related.map((item) => (
            <ProductCard key={item.id} product={item} />
          ))}
        </div>
      </section>
    </div>
  );
};
