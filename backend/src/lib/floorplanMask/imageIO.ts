import { Jimp } from 'jimp';
import { getOpenCv, OpenCv } from './opencvRuntime';

export interface DecodedImage {
  mat: InstanceType<OpenCv['Mat']>;
  width: number;
  height: number;
}

/**
 * Decodes an image buffer into an RGBA cv.Mat. Jimp (pure JS, no native
 * deps — same portability reasoning as the OpenCV WASM choice) handles the
 * PNG/JPEG decode and, per its own EXIF-aware read path, orientation
 * correction — by the time `bitmap` is read here the pixel data is already
 * upright, satisfying the "corrigir orientação" requirement without any
 * extra step.
 */
export async function decodeToMat(buffer: Buffer): Promise<DecodedImage> {
  const image = await Jimp.read(buffer);
  const { width, height, data } = image.bitmap;
  const cv = await getOpenCv();
  const mat = cv.matFromArray(height, width, cv.CV_8UC4, data);
  return { mat, width, height };
}

/** Encodes an RGBA (or grayscale, auto-converted) cv.Mat back to a PNG buffer. */
export async function encodeMatToPng(mat: InstanceType<OpenCv['Mat']>): Promise<Buffer> {
  const cv = await getOpenCv();
  let rgba: InstanceType<OpenCv['Mat']> | null = null;
  let source = mat;
  if (mat.channels() === 1) {
    rgba = new cv.Mat();
    cv.cvtColor(mat, rgba, cv.COLOR_GRAY2RGBA);
    source = rgba;
  } else if (mat.channels() === 3) {
    rgba = new cv.Mat();
    cv.cvtColor(mat, rgba, cv.COLOR_RGB2RGBA);
    source = rgba;
  }

  const width = source.cols;
  const height = source.rows;
  const image = new Jimp({ width, height, data: Buffer.from(source.data) });
  const png = await image.getBuffer('image/png');

  rgba?.delete();
  return png;
}
