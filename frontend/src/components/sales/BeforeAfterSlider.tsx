import { ReactNode, useRef, useState } from 'react';

interface Props {
  before: ReactNode;
  after: ReactNode;
  beforeLabel: string;
  afterLabel: string;
  onInteract?: () => void;
  className?: string;
  /** Taller ratio for the hero's large comparator vs. the compact demo tabs. */
  aspect?: 'wide' | 'tall';
}

/**
 * Large, keyboard/touch/mouse-accessible before/after comparator. Same
 * clip-path + native range-input technique as the app's existing
 * CompareSlider (components/CompareSlider.tsx) — reused conceptually rather
 * than imported directly, since that component is `<img>`-only and this one
 * needs to render either a real image or a PlaceholderArt illustration.
 */
export function BeforeAfterSlider({ before, after, beforeLabel, afterLabel, onInteract, className = '', aspect = 'wide' }: Props) {
  const [position, setPosition] = useState(50);
  const firedInteract = useRef(false);

  function handleChange(value: number) {
    setPosition(value);
    if (!firedInteract.current) {
      firedInteract.current = true;
      onInteract?.();
    }
  }

  return (
    <div
      className={`relative w-full select-none overflow-hidden rounded-3xl border border-border bg-surface-secondary shadow-[0_24px_80px_-24px_rgba(17,24,39,0.25)] ${
        aspect === 'wide' ? 'aspect-[16/10]' : 'aspect-[4/5]'
      } ${className}`}
    >
      <div className="absolute inset-0">{after}</div>
      <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
        {before}
      </div>
      <div className="pointer-events-none absolute inset-y-0 w-px bg-white/70 shadow-[0_0_0_1px_rgba(17,24,39,0.08)]" style={{ left: `${position}%` }}>
        <div className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-card">
          <div className="h-3 w-3 rounded-full bg-sapphire" />
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={position}
        onChange={(e) => handleChange(Number(e.target.value))}
        aria-label={`${beforeLabel} / ${afterLabel}`}
        className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
      />
      <span className="pointer-events-none absolute left-4 top-4 rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
        {beforeLabel}
      </span>
      <span className="pointer-events-none absolute right-4 top-4 rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
        {afterLabel}
      </span>
    </div>
  );
}
