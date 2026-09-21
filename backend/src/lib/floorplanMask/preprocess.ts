import { getOpenCv, OpenCv } from './opencvRuntime';

type Mat = InstanceType<OpenCv['Mat']>;

/**
 * Detection runs on a downscaled "working" copy for speed (Hough/contour
 * passes over a multi-megapixel source are slow and gain nothing — wall
 * lines are still perfectly detectable well below native resolution). The
 * final mask is resized back to the ORIGINAL dimensions at the very end of
 * the pipeline (see buildMask.ts), so this never affects the "keep exact
 * original dimensions" requirement — it only affects intermediate
 * processing cost.
 */
const MAX_WORKING_DIMENSION = 1600;

export interface WorkingImage {
  gray: Mat;
  enhanced: Mat;
  /** Multiply a coordinate/length measured on the working image by this to get it back in original-image pixels. */
  scaleToOriginal: number;
}

export async function buildWorkingImage(rgba: Mat, originalWidth: number, originalHeight: number): Promise<WorkingImage> {
  const cv = await getOpenCv();

  const longSide = Math.max(originalWidth, originalHeight);
  const scale = longSide > MAX_WORKING_DIMENSION ? MAX_WORKING_DIMENSION / longSide : 1;
  const workingWidth = Math.round(originalWidth * scale);
  const workingHeight = Math.round(originalHeight * scale);

  const resized = new cv.Mat();
  if (scale < 1) {
    cv.resize(rgba, resized, new cv.Size(workingWidth, workingHeight), 0, 0, cv.INTER_AREA);
  } else {
    rgba.copyTo(resized);
  }

  const gray = new cv.Mat();
  cv.cvtColor(resized, gray, cv.COLOR_RGBA2GRAY);

  // Contrast enhancement: CLAHE (adaptive) when the WASM build exposes it,
  // falling back to global histogram equalization otherwise — both are
  // standard OpenCV building blocks, never a hand-rolled substitute.
  const enhanced = new cv.Mat();
  const cvAny = cv as unknown as { CLAHE?: new (clipLimit?: number, tileGridSize?: InstanceType<OpenCv['Size']>) => { apply: (src: Mat, dst: Mat) => void } };
  if (typeof cvAny.CLAHE === 'function') {
    const clahe = new cvAny.CLAHE(2.0, new cv.Size(8, 8));
    clahe.apply(gray, enhanced);
  } else {
    cv.equalizeHist(gray, enhanced);
  }

  resized.delete();

  return { gray, enhanced, scaleToOriginal: 1 / scale };
}
