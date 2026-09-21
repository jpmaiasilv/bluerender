import { EditorMotionIntensity, EditorMotionType } from '../types/videoEditor';

/** How strongly each intensity tier zooms/pans. `pan` is a fraction of the
 * zoomed viewport's own width/height (not the canvas), `zoom` is the extra
 * scale added over the clip's duration, `baseScale` is the constant zoom
 * margin used by pure-pan movements so they never reveal the frame edges. */
const INTENSITY: Record<EditorMotionIntensity, { baseScale: number; pan: number; zoom: number }> = {
  soft: { baseScale: 1.12, pan: 0.3, zoom: 0.1 },
  medium: { baseScale: 1.2, pan: 0.42, zoom: 0.18 },
};

function num(n: number, decimals = 4): string {
  const clamped = Number.isFinite(n) ? n : 0;
  return clamped.toFixed(decimals);
}

export interface ZoompanExpressions {
  z: string;
  x: string;
  y: string;
}

/**
 * Builds the zoompan filter's z/x/y expressions for a motion type. All
 * movement is driven by zoompan's own `time` variable (seconds elapsed
 * within THIS clip's already-PTS-reset stream — see ffmpegExport.ts), so it
 * always spans exactly the clip's effective duration regardless of speed or
 * trim, and is independent of the video's own playback speed.
 *
 * `movementStart`/`movementDuration` define the window (in the same
 * clip-relative seconds as `time`) during which the movement actually
 * happens — for "durante todo o clipe" this is simply [0, full duration].
 * Outside that window the progress expression clamps to 0 or 1, so the clip
 * holds its initial framing before the window and its final framing after
 * it, rather than resetting. `clip(...)` bounds the raw ratio to [0,1], and
 * the smoothstep polynomial (`p*p*(3-2*p)`) gives every movement a gentle
 * ease-in-out instead of a mechanical linear ramp.
 */
export function buildMotionExpressions(
  motion: EditorMotionType,
  intensity: EditorMotionIntensity,
  movementStart: number,
  movementDuration: number
): ZoompanExpressions | null {
  if (motion === 'none') return null;
  const { baseScale, pan, zoom } = INTENSITY[intensity];
  const start = Math.max(0, movementStart);
  const dur = Math.max(0.05, movementDuration);
  const raw = `clip((time-${num(start)})/${num(dur)},0,1)`;
  const p = `(${raw}*${raw}*(3-2*${raw}))`;
  const centerX = 'iw/2-(iw/zoom/2)';
  const centerY = 'ih/2-(ih/zoom/2)';

  switch (motion) {
    case 'zoomIn':
      return { z: `1+${num(zoom)}*${p}`, x: centerX, y: centerY };
    case 'zoomOut':
      return { z: `1+${num(zoom)}*(1-${p})`, x: centerX, y: centerY };
    case 'panLeft':
      return { z: `${num(baseScale)}`, x: `${centerX}+(iw/zoom)*${num(pan)}*(1-2*${p})`, y: centerY };
    case 'panRight':
      return { z: `${num(baseScale)}`, x: `${centerX}-(iw/zoom)*${num(pan)}*(1-2*${p})`, y: centerY };
    case 'panUp':
      return { z: `${num(baseScale)}`, x: centerX, y: `${centerY}+(ih/zoom)*${num(pan)}*(1-2*${p})` };
    case 'panDown':
      return { z: `${num(baseScale)}`, x: centerX, y: `${centerY}-(ih/zoom)*${num(pan)}*(1-2*${p})` };
    case 'kenBurns':
      return {
        z: `1+${num(zoom * 0.6)}*${p}`,
        x: `${centerX}+(iw/zoom)*${num(pan * 0.4)}*(1-2*${p})`,
        y: `${centerY}+(ih/zoom)*${num(pan * 0.25)}*(1-2*${p})`,
      };
    default:
      return null;
  }
}

/**
 * The zoompan stage — inserted AFTER the clip has already been normalized to
 * the exact canvas size (see ffmpegExport.ts), so input size === output size
 * and the motion can never reveal padding bars, distort, or escape the
 * target aspect ratio. `d` differs by clip type: video keeps its own frame
 * count (`d=1`, motion rides the existing frame timing); an image clip has
 * no frames of its own, so zoompan itself generates exactly
 * `fps * duration` of them — the classic Ken Burns pattern.
 */
export function buildMotionFilterStage(
  motion: EditorMotionType,
  intensity: EditorMotionIntensity,
  clipDurationSeconds: number,
  movementStart: number,
  movementDuration: number,
  canvasW: number,
  canvasH: number,
  fps: number,
  isImage: boolean
): string | null {
  const exprs = buildMotionExpressions(motion, intensity, movementStart, movementDuration);
  if (!exprs) return null;
  // `d` (and, for video, the frame count zoompan rides) always spans the
  // FULL clip — the movement window only affects the z/x/y expressions
  // above, so the clip plays at its normal length with the hold-then-move-
  // then-hold behavior baked into the progress curve itself.
  const d = isImage ? Math.max(1, Math.round(fps * clipDurationSeconds)) : 1;
  return `zoompan=z='${exprs.z}':x='${exprs.x}':y='${exprs.y}':d=${d}:s=${canvasW}x${canvasH}:fps=${fps}`;
}
