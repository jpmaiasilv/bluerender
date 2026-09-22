import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../i18n';

interface Props {
  beforeSrc: string;
  afterSrc: string;
  /** Defaults to Render IA's own labels ("Original" / "AI Render") — pass overrides for other tools (e.g. "Antes" / "Ideia"). */
  beforeLabel?: string;
  afterLabel?: string;
}

/** Placeholder shape before the real "after" image reports its own natural size. */
const DEFAULT_RATIO = 1536 / 1024;
/** Share of the viewport height budgeted to the image itself, leaving room for the header above and the action buttons/history below. The viewport is the one dimension no ancestor's flex/overflow rules can quietly override. */
const VIEWPORT_HEIGHT_SHARE = 0.62;
const MIN_AVAILABLE_HEIGHT = 320;

function viewportAvailableHeight(): number {
  if (typeof window === 'undefined') return MIN_AVAILABLE_HEIGHT;
  return Math.max(MIN_AVAILABLE_HEIGHT, window.innerHeight * VIEWPORT_HEIGHT_SHARE);
}

/** width and height are always derived from the SAME ratio in the SAME calculation — never set independently. */
function calculateContainSize(ratio: number, availableWidth: number, availableHeight: number): { width: number; height: number } {
  if (availableWidth <= 0 || availableHeight <= 0) return { width: 0, height: 0 };
  if (availableWidth / availableHeight > ratio) {
    return { width: availableHeight * ratio, height: availableHeight };
  }
  return { width: availableWidth, height: availableWidth / ratio };
}

/**
 * Before/after slider used everywhere the app compares an original photo
 * against an AI result (Render IA, Planta Humanizada, Gerador de Ideias'
 * "compare with original"). One shared component so every tool gets the
 * same fix at once.
 *
 * Width and height are computed TOGETHER in JS from the after-image's real
 * naturalWidth/naturalHeight and the actually available width (measured via
 * ResizeObserver) and height (a share of window.innerHeight) — never from
 * independent CSS rules that can drift apart under flexbox. The resulting
 * box is `flex-none` so no ancestor's flex-shrink can crush it below that
 * computed size; if there isn't room, the page scrolls instead.
 *
 * Both images are absolutely positioned layers inside that one box, with
 * identical width/height/object-fit(contain)/object-position — neither is
 * ever sized, cropped or moved independently of the other. The divider only
 * ever changes a clip-path percentage on the overlay; it never sets the
 * overlay's width, so the image inside it is never resized or misaligned.
 */
export function CompareSlider({ beforeSrc, afterSrc, beforeLabel, afterLabel }: Props) {
  const { messages } = useLanguage();
  const previewAreaRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(50);
  const [ratio, setRatio] = useState(DEFAULT_RATIO);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [availableHeight, setAvailableHeight] = useState(viewportAvailableHeight);
  const [afterLoaded, setAfterLoaded] = useState(false);
  const [beforeLoaded, setBeforeLoaded] = useState(false);
  const [afterError, setAfterError] = useState(false);
  const [beforeError, setBeforeError] = useState(false);

  // Real width of the column this sits in — reacts to the sidebar opening/
  // closing, the right settings panel resizing, and the window resizing,
  // without depending on any ancestor's flex math being well-behaved.
  useEffect(() => {
    const el = previewAreaRef.current;
    if (!el) return;
    setAvailableWidth(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === 'number') setAvailableWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function updateHeight() {
      setAvailableHeight(viewportAvailableHeight());
    }
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  // A new image pair (new job, different history entry) forgets the previous
  // pair's measured ratio and puts the divider back in the middle.
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
  const { width: displayWidth, height: displayHeight } = calculateContainSize(ratio, availableWidth, availableHeight);
  const hasSize = displayWidth > 0 && displayHeight > 0;

  // Shared by both layers on purpose: identical sizing/fit/position, so
  // neither image is ever cropped, scaled or placed differently from the other.
  const layerClass = 'absolute inset-0 block h-full w-full object-contain object-center';

  return (
    <div ref={previewAreaRef} className="flex w-full items-start justify-center">
      <div
        className="relative flex-none select-none overflow-hidden rounded-2xl border border-border bg-surface-secondary shadow-card"
        style={hasSize ? { width: displayWidth, height: displayHeight } : { width: '100%', visibility: 'hidden' }}
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
        {/* Overlay always stays at 100%/100% (inset-0) — the divider is drawn
            ONLY via clip-path below. Sizing the overlay itself by the slider
            percentage would resize the image inside it and break alignment
            with the layer underneath. */}
        <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
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
    </div>
  );
}
