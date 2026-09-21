import { EditorMotionIntensity, EditorMotionType } from '../../types';

/** Mirrors backend/src/lib/motionFilter.ts's INTENSITY table so the preview
 * looks like a close approximation of the exported result. `pan`/`zoom` here
 * are expressed directly as CSS scale/translate deltas rather than zoompan's
 * own expression variables, but describe the same visual movement. */
const INTENSITY: Record<EditorMotionIntensity, { baseScale: number; pan: number; zoom: number }> = {
  soft: { baseScale: 1.12, pan: 4, zoom: 0.1 },
  medium: { baseScale: 1.2, pan: 7, zoom: 0.18 },
};

/** Ease-in-out (smoothstep): gentle acceleration/deceleration instead of a
 * mechanical linear ramp. Mirrors the same polynomial used in the backend's
 * zoompan expressions (motionFilter.ts) so preview and export move alike. */
function smoothstep(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

/**
 * Eased, windowed progress (0..1) for a clip's movement at `withinClipTime`
 * seconds into the clip. Before `start` this is 0 (initial framing held);
 * after `start + duration` it's 1 (final framing held); in between it eases
 * smoothly — matching the same before/during/after behavior FFmpeg produces
 * on export (see motionFilter.ts's `clip(...)`-based expression).
 */
export function motionProgress(withinClipTime: number, start: number, duration: number): number {
  const raw = duration > 0 ? (withinClipTime - start) / duration : 0;
  return smoothstep(raw);
}

/**
 * CSS `transform` string for a motion type at a given (already eased and
 * windowed) progress value. This is a lightweight visual approximation —
 * the exported MP4's zoompan-based filter chain (motionFilter.ts) is the
 * source of truth for the final result.
 */
export function motionTransform(motion: EditorMotionType, intensity: EditorMotionIntensity, progress: number): string {
  if (motion === 'none') return '';
  const { baseScale, pan, zoom } = INTENSITY[intensity];
  const p = Math.min(1, Math.max(0, progress));

  switch (motion) {
    case 'zoomIn':
      return `scale(${1 + zoom * p})`;
    case 'zoomOut':
      return `scale(${1 + zoom * (1 - p)})`;
    case 'panLeft':
      return `scale(${baseScale}) translateX(${pan - 2 * pan * p}%)`;
    case 'panRight':
      return `scale(${baseScale}) translateX(${-pan + 2 * pan * p}%)`;
    case 'panUp':
      return `scale(${baseScale}) translateY(${pan - 2 * pan * p}%)`;
    case 'panDown':
      return `scale(${baseScale}) translateY(${-pan + 2 * pan * p}%)`;
    case 'kenBurns':
      return `scale(${1 + zoom * 0.6 * p + (baseScale - 1)}) translate(${pan * 0.4 * (1 - 2 * p)}%, ${pan * 0.25 * (1 - 2 * p)}%)`;
    default:
      return '';
  }
}
