import { useState } from 'react';
import { useLanguage } from '../i18n';

interface Props {
  beforeSrc: string;
  afterSrc: string;
  /** Defaults to Render IA's own labels ("Original" / "AI Render") — pass overrides for other tools (e.g. "Antes" / "Ideia"). */
  beforeLabel?: string;
  afterLabel?: string;
}

export function CompareSlider({ beforeSrc, afterSrc, beforeLabel, afterLabel }: Props) {
  const { messages } = useLanguage();
  const [position, setPosition] = useState(50);
  const resolvedBeforeLabel = beforeLabel ?? messages.result.original;
  const resolvedAfterLabel = afterLabel ?? messages.result.aiRender;

  return (
    <div className="relative w-full select-none overflow-hidden rounded-2xl border border-border bg-surface-secondary shadow-card">
      <img src={afterSrc} alt={resolvedAfterLabel} className="block w-full h-auto" draggable={false} />
      <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
        {/* object-contain, never object-cover: the original photo and the AI
            render rarely share an aspect ratio, and cropping the original to
            match the render's shape hides real content instead of just
            letterboxing it. */}
        <img
          src={beforeSrc}
          alt={resolvedBeforeLabel}
          className="absolute inset-0 h-full w-full object-contain"
          draggable={false}
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
