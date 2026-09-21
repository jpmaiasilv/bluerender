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

const TEXT_TO_VIDEO_CLAUSE = 'Professional architectural cinematography. Smooth, natural camera movement.';

export function buildVideoPrompt(settings: VideoGeneratorSettings, options: { hasSourceImage: boolean }): string {
  const parts = [settings.prompt.trim()];
  parts.push(options.hasSourceImage ? IMAGE_TO_VIDEO_CLAUSE : TEXT_TO_VIDEO_CLAUSE);
  return parts.join('\n\n');
}
