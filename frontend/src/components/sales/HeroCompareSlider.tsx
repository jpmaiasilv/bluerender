import { ReactNode, useCallback, useRef, useState } from 'react';

interface Props {
  /** Base layer — always fully visible, revealed on the left of the divider. */
  original: ReactNode;
  /** Top layer — clipped to the area right of the divider via clip-path, so it's revealed as the handle moves right. */
  render: ReactNode;
  originalLabel: string;
  renderLabel: string;
  onInteract?: () => void;
  /** Real width/height ratio of the loaded image (see SalesArt's onNaturalSize) — sizes the container to match instead of forcing 16:10, so `object-contain` never needs to letterbox. Null/undefined falls back to a 16:10 box (e.g. before the image has loaded). */
  aspectRatio?: number | null;
}

const LABEL_BG = 'rgba(8, 25, 50, 0.85)';

/**
 * Hero-only Original/Blue Render comparator. Deliberately NOT the shared
 * BeforeAfterSlider (components/sales/BeforeAfterSlider.tsx, still used
 * as-is by InteractiveDemo/PreservationSection/FeatureStory) — this one has
 * its own container, handle and label styling per the hero redesign,
 * without touching any other section's comparator.
 *
 * Images render with object-fit: contain (via SalesArt's `fit` prop) so the
 * whole photo is always visible, never cropped. The container defaults to a
 * 16:10 box but switches to the real image's aspect ratio the moment it
 * loads (see the `aspectRatio` prop / SalesArt's `onNaturalSize`), so once
 * matched original/render photos are in place there's no letterboxing at
 * all — any visible bars today are just the current placeholder photos not
 * sharing one ratio yet.
 *
 * Both layers are absolutely positioned, inset-0, 100%/100%, object-cover,
 * object-center — identical framing — so the only visual difference between
 * them is the image content itself, and the two stay pixel-aligned while
 * dragging.
 */
export function HeroCompareSlider({ original, render, originalLabel, renderLabel, onInteract, aspectRatio }: Props) {
  const [position, setPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const firedInteractRef = useRef(false);

  const applyPositionFromClientX = useCallback(
    (clientX: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
      setPosition(Math.min(100, Math.max(0, ratio * 100)));
      if (!firedInteractRef.current) {
        firedInteractRef.current = true;
        onInteract?.();
      }
    },
    [onInteract]
  );

  const scheduleUpdate = useCallback(
    (clientX: number) => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        applyPositionFromClientX(clientX);
      });
    },
    [applyPositionFromClientX]
  );

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Suppresses native image-drag-ghost and text selection from the same gesture.
    e.preventDefault();
    applyPositionFromClientX(e.clientX);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    scheduleUpdate(e.clientX);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setPosition((p) => Math.max(0, p - 3));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setPosition((p) => Math.min(100, p + 3));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setPosition(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setPosition(100);
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative mx-auto w-[calc(100%-24px)] touch-none select-none overflow-hidden rounded-2xl bg-surface-secondary shadow-[0_24px_80px_-24px_rgba(17,24,39,0.25)] sm:w-[calc(100%-40px)] sm:rounded-[22px] aspect-[16/10]"
      style={{ maxWidth: 730, aspectRatio: aspectRatio ? String(aspectRatio) : undefined }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="absolute inset-0 h-full w-full">{original}</div>
      <div className="absolute inset-0 h-full w-full" style={{ clipPath: `inset(0 0 0 ${position}%)` }}>
        {render}
      </div>

      <div className="pointer-events-none absolute inset-y-0 w-px bg-white/80" style={{ left: `${position}%` }} />

      <div
        role="slider"
        tabIndex={0}
        aria-label={`${originalLabel} / ${renderLabel}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(position)}
        onKeyDown={handleKeyDown}
        className="absolute top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 cursor-col-resize items-center justify-center rounded-full bg-white shadow-[0_4px_14px_rgba(17,24,39,0.3)] outline-none focus-visible:ring-2 focus-visible:ring-sapphire sm:h-11 sm:w-11"
        style={{ left: `${position}%` }}
      >
        <svg width="16" height="10" viewBox="0 0 16 10" fill="none" aria-hidden="true">
          <path d="M6 1L1 5l5 4" stroke="#111827" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M10 1l5 4-5 4" stroke="#111827" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <span
        className="pointer-events-none absolute left-4 top-4 rounded-full px-2.5 py-1 text-[12px] font-semibold text-white"
        style={{ background: LABEL_BG }}
      >
        {originalLabel}
      </span>
      <span
        className="pointer-events-none absolute right-4 top-4 rounded-full px-2.5 py-1 text-[12px] font-semibold text-white"
        style={{ background: LABEL_BG }}
      >
        {renderLabel}
      </span>
    </div>
  );
}
