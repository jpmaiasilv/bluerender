import { VideoGeneratorSettings } from '../types/videoGenerator';

/**
 * Centralized prompt builder for Vídeo IA — deliberately minimal compared to
 * the image tools' builders. A video-generation model's prompt describes
 * MOTION and camera behavior, not scene composition from scratch, so the
 * user's own wording is kept almost verbatim; this only adds a short framing
 * clause so the result stays a believable architectural presentation rather
 * than an arbitrary animation.
 */

const IMAGE_TO_VIDEO_CLAUSE =
  'Animate this architectural image into a smooth, professional walkthrough or camera movement. Keep the building, materials and composition consistent with the source image — do not redesign the architecture.';

/** Used when a final-frame image is also pinned (real first/last-frame interpolation, not simulated) — see providers/xaiVideo.ts. */
const START_END_VIDEO_CLAUSE =
  'The first provided image is the starting frame and the second provided image is the ending frame. Show a coherent, professional transition evolving from the first into the second, consistent with the described change.';

const TEXT_TO_VIDEO_CLAUSE = 'Professional architectural cinematography. Smooth, natural camera movement.';

export function buildVideoPrompt(settings: VideoGeneratorSettings, options: { hasSourceImage: boolean; hasEndImage?: boolean }): string {
  const parts = [settings.prompt.trim()];
  if (options.hasEndImage) parts.push(START_END_VIDEO_CLAUSE);
  else parts.push(options.hasSourceImage ? IMAGE_TO_VIDEO_CLAUSE : TEXT_TO_VIDEO_CLAUSE);
  return parts.join('\n\n');
}
