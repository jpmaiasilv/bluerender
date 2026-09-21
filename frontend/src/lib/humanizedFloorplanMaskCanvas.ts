/**
 * Canvas helpers for the Planta Humanizada mask review screen
 * (MaskReviewScreen.tsx). Everything here operates at the image's NATIVE
 * resolution — zoom/pan is purely a CSS transform applied on top by the
 * component, so nothing in this file ever needs to know about it, and the
 * exported mask always keeps the exact original pixel dimensions.
 *
 * Mask convention (matches the backend exactly — see
 * backend/src/lib/floorplanMask/buildMask.ts): black = protected, white =
 * editable.
 */

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

/** A same-size mask canvas filled fully editable (white) — used only as a last-resort fallback if the auto mask ever failed to load. */
export function createBlankEditableMask(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

/** Draws a mask image (data URL or object URL) onto a fresh canvas at its own natural size. */
export async function loadMaskIntoCanvas(src: string): Promise<HTMLCanvasElement> {
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return canvas;
}

/** Replaces a canvas's contents with a data URL's image, keeping the canvas's own dimensions (used for undo/redo/restore). */
export async function paintDataUrlOntoCanvas(canvas: HTMLCanvasElement, dataUrl: string): Promise<void> {
  const img = await loadImage(dataUrl);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
}

export function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to export mask canvas to PNG.'));
    }, 'image/png');
  });
}

export interface MaskCoverage {
  protectedPercent: number;
  editablePercent: number;
}

/** Grayscale luminance threshold at the midpoint — matches the backend's own decodeMaskToProtectedMat threshold (127), so both the on-screen percentage and the visible overlay always agree with what the server will actually enforce. */
function isProtectedPixel(r: number, g: number, b: number): boolean {
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

/** Samples the mask's pixels to report how much is protected vs editable — recomputed after each completed brush stroke, not on every pointer move (reading full ImageData is not free on large plans). */
export function computeMaskCoverage(canvas: HTMLCanvasElement): MaskCoverage {
  const ctx = canvas.getContext('2d')!;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let protectedCount = 0;
  const totalPixels = canvas.width * canvas.height;
  for (let i = 0; i < data.length; i += 4) {
    if (isProtectedPixel(data[i], data[i + 1], data[i + 2])) protectedCount++;
  }
  const protectedPercent = totalPixels > 0 ? (protectedCount / totalPixels) * 100 : 0;
  return { protectedPercent, editablePercent: 100 - protectedPercent };
}

/**
 * Rebuilds the on-screen blue-overlay canvas from the raw black/white mask
 * canvas (protected -> opaque blue, editable -> fully transparent) in a
 * single pass, also returning the coverage stats from that same pass. Used
 * whenever the mask "jumps" to a different state as a whole (initial load,
 * restore-auto-mask, undo, redo) — a live brush stroke instead paints both
 * canvases incrementally for responsiveness (see MaskReviewScreen), so this
 * full remap is only ever a few times per session, not per frame.
 */
export function deriveOverlayFromMask(rawCanvas: HTMLCanvasElement, overlayCanvas: HTMLCanvasElement): MaskCoverage {
  const rawCtx = rawCanvas.getContext('2d')!;
  const { data, width, height } = rawCtx.getImageData(0, 0, rawCanvas.width, rawCanvas.height);
  const out = new ImageData(width, height);
  let protectedCount = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (isProtectedPixel(data[i], data[i + 1], data[i + 2])) {
      out.data[i] = 37;
      out.data[i + 1] = 99;
      out.data[i + 2] = 235;
      out.data[i + 3] = 255;
      protectedCount++;
    } else {
      out.data[i + 3] = 0;
    }
  }
  overlayCanvas.width = width;
  overlayCanvas.height = height;
  overlayCanvas.getContext('2d')!.putImageData(out, 0, 0);

  const totalPixels = width * height;
  const protectedPercent = totalPixels > 0 ? (protectedCount / totalPixels) * 100 : 0;
  return { protectedPercent, editablePercent: 100 - protectedPercent };
}
