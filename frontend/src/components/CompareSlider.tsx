import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n';

interface Props {
  beforeSrc: string;
  afterSrc: string;
  /** Defaults to Render IA's own labels ("Original" / "AI Render") — pass overrides for other tools (e.g. "Antes" / "Ideia"). */
  beforeLabel?: string;
  afterLabel?: string;
}

/** Matches the platform's typical render output (1536 x 1024) — only used as a placeholder shape before the real image reports its own natural size. */
const DEFAULT_RATIO = 1536 / 1024;
/** Coherent max width for a 3:2-ish comparison card — keeps it from turning into a wall-wide strip on large monitors, per the same logic as every other result card in the app. */
const MAX_WIDTH_PX = 880;

/**
 * Before/after slider used everywhere the app compares an original photo
 * against an AI result (Render IA, Planta Humanizada, Gerador de Ideias'
 * "compare with original"). One shared component so every tool gets the
 * same fix at once instead of drifting apart:
 *
 * - The container's shape comes from the AFTER image's own measured
 *   naturalWidth/naturalHeight (via CSS aspect-ratio), not from viewport
 *   width — so it never stretches into an oversized strip on a big monitor.
 * - Both layers are absolutely positioned inside that SAME box, with
 *   identical width/height/object-fit/object-position — neither image is
 *   ever sized, cropped or positioned independently of the other.
 * - object-contain (never object-cover): when before/after don't share an
 *   exact aspect ratio, each is letterboxed inside the shared box instead of
 *   being cropped to fill it — no content is ever thrown away to force a fit.
 * - Dragging the divider only ever changes a clip-path percentage; it never
 *   touches either image's size or position.
 */
export function CompareSlider({ beforeSrc, afterSrc, beforeLabel, afterLabel }: Props) {
  const { messages } = useLanguage();
  const [position, setPosition] = useState(50);
  const [ratio, setRatio] = useState(DEFAULT_RATIO);
  const [afterLoaded, setAfterLoaded] = useState(false);
  const [beforeLoaded, setBeforeLoaded] = useState(false);
  const [afterError, setAfterError] = useState(false);
  const [beforeError, setBeforeError] = useState(false);

  // A new image pair (new job, different history entry) always starts the
  // divider back at the middle and forgets the previous pair's measured ratio.
  useEffect(() => {
    setPosition(50);
    setRatio(DEFAULT_RATIO);
    setAfterLoaded(false);
    setBeforeLoaded(false);
    setAfterError(false);
    setBeforeError(false);
  }, [beforeSrc, afterSrc]);

  const resolvedBeforeLabel = beforeLabel ?? messages.result.original;
  const resolvedAfterLabel = afterLabel ?? messages.result.aiRender;
  const ready = afterLoaded && beforeLoaded;
  const hasError = afterError || beforeError;

  // Shared by both layers on purpose: identical sizing/fit/position rules, so
  // neither image can ever end up cropped, scaled or placed differently from the other.
  const layerClass = 'absolute inset-0 h-full w-full object-contain object-center';

  return (
    <div
      className="relative mx-auto w-full select-none overflow-hidden rounded-2xl border border-border bg-surface-secondary shadow-card"
      style={{ aspectRatio: String(ratio), maxWidth: MAX_WIDTH_PX }}
    >
      {!ready && !hasError && <div className="absolute inset-0 animate-pulse bg-surface-secondary" aria-hidden="true" />}
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-ink-muted">
          {messages.errors.titles.RESULT_IMAGE_UNAVAILABLE}
        </div>
      )}

      <img
        src={afterSrc}
        alt={resolvedAfterLabel}
        className={layerClass}
        draggable={false}
        onLoad={(e) => {
          const { naturalWidth, naturalHeight } = e.currentTarget;
          if (naturalWidth > 0 && naturalHeight > 0) setRatio(naturalWidth / naturalHeight);
          setAfterLoaded(true);
        }}
        onError={() => setAfterError(true)}
      />
      {/* The divider reveals the "before" layer via clip-path only — the image
          itself never moves, resizes or gets recalculated as the divider moves. */}
      <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
        <img
          src={beforeSrc}
          alt={resolvedBeforeLabel}
          className={layerClass}
          draggable={false}
          onLoad={() => setBeforeLoaded(true)}
          onError={() => setBeforeError(true)}
        />
      </div>

      <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/80" style={{ left: `${position}%` }} />
      <input
        type="range"
        min={0}
        max={100}
        value={position}
        onChange={(e) => setPosition(Number(e.target.value))}
        aria-label={messages.result.compare}
        className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
      />
      <span className="pointer-events-none absolute left-3 top-3 rounded bg-black/60 px-2 py-1 text-xs text-white">
        {resolvedBeforeLabel}
      </span>
      <span className="pointer-events-none absolute right-3 top-3 rounded bg-black/60 px-2 py-1 text-xs text-white">
        {resolvedAfterLabel}
      </span>
    </div>
  );
}
