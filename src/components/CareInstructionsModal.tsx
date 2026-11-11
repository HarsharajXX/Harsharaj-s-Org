import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface CareInstructionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  material?: string;
}

const FABRIC_GUIDES = [
  {
    name: 'Muga Silk',
    origin: 'Golden Silk of Assam',
    wash: 'Dry clean only. Avoid soaking or harsh chemical detergents, which dull its natural golden sheen.',
    dry: 'Dry flat in shade. Never wring or expose to direct afternoon sunlight.',
    iron: 'Steam or iron on low heat from the reverse side using a thin cotton pressing cloth.',
    storage: 'Wrap in unbleached muslin or soft cotton. Refold every 3–4 months to prevent permanent creases.',
  },
  {
    name: 'Eri Silk (Peace Silk)',
    origin: 'Warm, Breathable Handspun Silk',
    wash: 'Gentle cold hand wash using a mild, pH-neutral silk detergent, or dry clean.',
    dry: 'Press excess water gently with a clean towel and dry flat in shade.',
    iron: 'Iron on medium-low heat while slightly damp, or steam lightly.',
    storage: 'Store folded in a breathable cotton bag away from moisture.',
  },
  {
    name: 'Pat Silk',
    origin: 'Lustrous Mulberry Silk',
    wash: 'Dry clean recommended, especially for pieces with intricate zari or border motifs.',
    dry: 'Air dry in shade; avoid hanging heavy wet silk on thin hangers.',
    iron: 'Low heat on the reverse side only; never spray water directly onto silk.',
    storage: 'Keep wrapped in pure cotton muslin, away from naphthalene balls (use dried neem leaves or cedar instead).',
  },
  {
    name: 'Handwoven Cotton',
    origin: 'Natural & Dyed Loom Cotton',
    wash: 'First wash separately in cold water with mild detergent to preserve natural dyes.',
    dry: 'Dry in shade to prevent fading of earthy or botanical pigments.',
    iron: 'Medium heat while slightly damp for a crisp finish.',
    storage: 'Store folded in a cool, dry wardrobe.',
  },
];

export const CareInstructionsModal: React.FC<CareInstructionsModalProps> = ({
  isOpen,
  onClose,
  material,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#25231F]/60 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="care-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-[#FAF9F6] border border-[#D8CBB9] p-6 sm:p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 pb-5 border-b border-[#D8CBB9]">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[#A65F46]">
              Textile Preservation
            </p>
            <h2 id="care-modal-title" className="font-serif text-2xl sm:text-3xl text-[#25231F] mt-1">
              Care Instructions
            </h2>
            {material && (
              <p className="text-xs text-[#777168] mt-1">
                This piece is crafted from <span className="text-[#25231F]">{material}</span>.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[#25231F] hover:text-[#A65F46] transition-colors"
            aria-label="Close care instructions"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-6 space-y-6 divide-y divide-[#E6DED2]">
          {FABRIC_GUIDES.map((guide) => (
            <div key={guide.name} className="pt-5 first:pt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2.5">
                <h3 className="font-serif text-lg text-[#25231F]">{guide.name}</h3>
                <span className="text-[11px] uppercase tracking-wider text-[#777168]">
                  {guide.origin}
                </span>
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs text-[#514B43] leading-relaxed">
                <div>
                  <dt className="font-medium text-[#25231F] uppercase tracking-wider text-[10px]">Washing</dt>
                  <dd className="mt-0.5">{guide.wash}</dd>
                </div>
                <div>
                  <dt className="font-medium text-[#25231F] uppercase tracking-wider text-[10px]">Drying</dt>
                  <dd className="mt-0.5">{guide.dry}</dd>
                </div>
                <div>
                  <dt className="font-medium text-[#25231F] uppercase tracking-wider text-[10px]">Ironing</dt>
                  <dd className="mt-0.5">{guide.iron}</dd>
                </div>
                <div>
                  <dt className="font-medium text-[#25231F] uppercase tracking-wider text-[10px]">Storage</dt>
                  <dd className="mt-0.5">{guide.storage}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>

        <div className="mt-8 pt-5 border-t border-[#D8CBB9] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest hover:bg-[#A65F46] transition-colors"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};
