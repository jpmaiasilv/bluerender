import { getOpenCv, OpenCv } from './opencvRuntime';
import { decodeToMat } from './imageIO';

type Mat = InstanceType<OpenCv['Mat']>;

/**
 * Decodes ANY black/white mask PNG — whether it's the auto-generated one
 * from buildFloorplanMask, or one the user hand-edited in the frontend's
 * brush editor (Proteger/Permitir alteração) — into the same internal
 * `protected=255` Mat convention used everywhere else in this pipeline.
 * Used by both the auto-mask path and the manual-edit path, so there is
 * exactly one place that defines what a valid mask looks like.
 */
export async function decodeMaskToProtectedMat(maskPngBuffer: Buffer, expectedWidth: number, expectedHeight: number): Promise<Mat> {
  const cv = await getOpenCv();
  const { mat: rgba, width, height } = await decodeToMat(maskPngBuffer);

  if (width !== expectedWidth || height !== expectedHeight) {
    rgba.delete();
    throw new Error(`Mask dimensions (${width}x${height}) do not match the source image (${expectedWidth}x${expectedHeight}).`);
  }

  const gray = new cv.Mat();
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);

  // The mask PNG follows BFL Fill's own convention (black=preserve,
  // white=edit); our internal convention is the inverse (protected=255) —
  // threshold at the midpoint so anti-aliased edges from a hand-drawn brush
  // stroke still resolve to a clean binary mask instead of gray fringing.
  const binary = new cv.Mat();
  cv.threshold(gray, binary, 127, 255, cv.THRESH_BINARY);
  const protectedMask = new cv.Mat();
  cv.bitwise_not(binary, protectedMask);

  rgba.delete();
  gray.delete();
  binary.delete();

  return protectedMask;
}
