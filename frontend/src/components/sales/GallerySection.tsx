import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { ArtMood } from './PlaceholderArt';
import { SalesArt } from './SalesArt';
import { Reveal } from './Reveal';

type FilterKey = 'all' | 'interior' | 'exterior' | 'residential' | 'commercial' | 'landscape';

interface GalleryItem {
  id: string;
  mood: ArtMood;
  tags: FilterKey[];
  span?: string;
  /** /images/sales/gallery-01.jpg .. gallery-09.jpg — one distinct real photo per tile, independent of `mood` (only used for the illustrated fallback). */
  src: string;
}

// Mood/tags below reflect what's actually in each real photo (checked each
// one directly) — not arbitrary placeholders. 16 real photos total
// (gallery-01..16 — the two former one-off UUID-named files are now
// properly slotted in as gallery-10/gallery-11, nothing duplicated).
// Layout leads with the most striking exterior shots (gallery-15's tropical
// house gets the big tile, gallery-06's night pool and gallery-16's
// commercial building the wide ones).
const ITEMS: GalleryItem[] = [
  { id: 'g1', mood: 'facade', tags: ['exterior', 'residential', 'landscape'], span: 'sm:col-span-2 sm:row-span-2', src: '/images/sales/gallery-15.jpg' },
  { id: 'g2', mood: 'interior', tags: ['interior', 'residential'], src: '/images/sales/gallery-01.jpg' },
  { id: 'g3', mood: 'facade', tags: ['exterior', 'commercial'], src: '/images/sales/gallery-16.jpg' },
  { id: 'g4', mood: 'landscape', tags: ['landscape', 'exterior', 'residential'], span: 'sm:col-span-2', src: '/images/sales/gallery-06.jpg' },
  { id: 'g5', mood: 'interior', tags: ['interior', 'commercial'], src: '/images/sales/gallery-07.jpg' },
  { id: 'g6', mood: 'facade', tags: ['exterior', 'residential'], src: '/images/sales/gallery-09.jpg' },
  { id: 'g7', mood: 'interior', tags: ['interior', 'residential'], src: '/images/sales/gallery-04.jpg' },
  { id: 'g8', mood: 'interior', tags: ['interior', 'residential'], src: '/images/sales/gallery-05.jpg' },
  { id: 'g9', mood: 'interior', tags: ['interior', 'residential'], src: '/images/sales/gallery-02.jpg' },
  { id: 'g10', mood: 'facade', tags: ['exterior', 'residential'], src: '/images/sales/gallery-08.jpg' },
  { id: 'g11', mood: 'facade', tags: ['exterior', 'residential'], src: '/images/sales/gallery-12.jpg' },
  { id: 'g12', mood: 'interior', tags: ['interior', 'residential'], src: '/images/sales/gallery-03.jpg' },
  { id: 'g13', mood: 'interior', tags: ['interior', 'residential'], src: '/images/sales/gallery-13.jpg' },
  { id: 'g14', mood: 'landscape', tags: ['landscape', 'exterior', 'residential'], src: '/images/sales/gallery-14.jpg' },
  { id: 'g15', mood: 'landscape', tags: ['landscape', 'exterior', 'residential'], src: '/images/sales/gallery-11.jpg' },
  { id: 'g16', mood: 'interior', tags: ['interior', 'residential'], src: '/images/sales/gallery-10.jpg' },
];

const FILTERS: FilterKey[] = ['all', 'interior', 'exterior', 'residential', 'commercial', 'landscape'];

export function GallerySection() {
  const { messages } = useLanguage();
  const t = messages.sales.gallery;
  const [filter, setFilter] = useState<FilterKey>('all');
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const visible = filter === 'all' ? ITEMS : ITEMS.filter((item) => item.tags.includes(filter));

  useEffect(() => {
    if (openIndex === null) return;
    // Every real photo has its own native size (some square, some tall
    // portraits — checked directly) — this dialog no longer forces a fixed
    // crop box.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenIndex(null);
      if (e.key === 'ArrowRight') setOpenIndex((i) => (i === null ? null : (i + 1) % visible.length));
      if (e.key === 'ArrowLeft') setOpenIndex((i) => (i === null ? null : (i - 1 + visible.length) % visible.length));
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openIndex, visible.length]);

  return (
    <section id="galeria" className="bg-surface py-14 sm:py-20">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{t.title}</h2>
          <p className="mt-3 text-base text-ink-secondary">{t.subtitle}</p>
        </Reveal>

        <Reveal delayMs={80} className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                filter === key ? 'bg-sapphire text-white' : 'border border-border text-ink-secondary hover:border-sapphire/40 hover:text-ink'
              }`}
            >
              {t.filters[key]}
            </button>
          ))}
        </Reveal>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3 sm:auto-rows-[180px]">
          {visible.map((item, index) => (
            <Reveal key={item.id} delayMs={(index % 6) * 60} className={item.span ?? ''}>
              <button
                type="button"
                onClick={() => setOpenIndex(index)}
                aria-label={t.openLabel}
                className="group h-full w-full overflow-hidden rounded-2xl border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sapphire"
              >
                <SalesArt
                  mood={item.mood}
                  variant="render"
                  srcOverride={item.src}
                  className="h-full w-full transition duration-500 group-hover:scale-105"
                />
              </button>
            </Reveal>
          ))}
        </div>
      </div>

      {openIndex !== null &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/85 p-5" role="dialog" aria-modal="true">
            <button
              type="button"
              onClick={() => setOpenIndex(null)}
              aria-label={t.closeLabel}
              className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full text-white/80 transition hover:bg-white/10 hover:text-white"
            >
              <X size={20} />
            </button>
            <button
              type="button"
              onClick={() => setOpenIndex((i) => (i === null ? null : (i - 1 + visible.length) % visible.length))}
              aria-label="Previous"
              className="absolute left-3 flex h-11 w-11 items-center justify-center rounded-full text-white/80 transition hover:bg-white/10 hover:text-white sm:left-6"
            >
              <ChevronLeft size={22} />
            </button>
            {/* No fixed box: the image sizes itself from its own natural
                aspect ratio (plain <img> auto width/height), only capped by
                the viewport — so the whole photo is always visible, at any
                orientation, with zero cropping. */}
            <SalesArt
              key={visible[openIndex].id}
              mood={visible[openIndex].mood}
              variant="render"
              srcOverride={visible[openIndex].src}
              fit="contain"
              className="block max-h-[85vh] max-w-[92vw] w-auto h-auto rounded-2xl bg-surface-secondary shadow-2xl sm:max-w-[85vw]"
            />
            <button
              type="button"
              onClick={() => setOpenIndex((i) => (i === null ? null : (i + 1) % visible.length))}
              aria-label="Next"
              className="absolute right-3 flex h-11 w-11 items-center justify-center rounded-full text-white/80 transition hover:bg-white/10 hover:text-white sm:right-6"
            >
              <ChevronRight size={22} />
            </button>
          </div>,
          document.body
        )}
    </section>
  );
}
