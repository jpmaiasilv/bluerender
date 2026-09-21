/**
 * Minimal, OpenCV-free validation for the SIMPLE flow's generated floor plan
 * image — deliberately does NOT depend on lib/floorplanMask/opencvRuntime
 * (the simple flow must not pull in OpenCV at all, per explicit requirement).
 * Pure byte-level PNG signature/IHDR inspection, same technique as
 * lib/blockImage/pngValidation.ts's readPngColorType, but without any of
 * that module's transparency-specific checks (this image is expected to be
 * a normal opaque render, not a transparent cutout asset).
 */

export const DEFAULT_MAX_FLOORPLAN_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_REASONABLE_DIMENSION = 8192;

export interface FloorplanImageValidationResult {
  valid: boolean;
  reasons: string[];
  isPng: boolean;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  withinMaxSize: boolean;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function validateGeneratedFloorplanPng(buffer: Buffer, maxSizeBytes: number = DEFAULT_MAX_FLOORPLAN_IMAGE_BYTES): FloorplanImageValidationResult {
  const reasons: string[] = [];
  const sizeBytes = buffer.length;
  const withinMaxSize = sizeBytes <= maxSizeBytes;
  if (!withinMaxSize) reasons.push(`file size ${sizeBytes} bytes exceeds the maximum allowed ${maxSizeBytes} bytes`);

  const hasSignature = buffer.length >= 8 && PNG_SIGNATURE.every((b, i) => buffer[i] === b);
  const chunkType = buffer.length >= 16 ? buffer.toString('ascii', 12, 16) : '';
  const isPng = hasSignature && chunkType === 'IHDR';
  if (!isPng) {
    reasons.push('file is not a valid PNG (signature/IHDR check failed)');
    return { valid: false, reasons, isPng: false, width: null, height: null, sizeBytes, withinMaxSize };
  }

  // IHDR chunk: width and height are the first 8 bytes of chunk data, big-endian, starting right after the 4-byte length + 4-byte "IHDR" tag (offset 16).
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const dimensionsValid = width > 0 && height > 0 && width <= MAX_REASONABLE_DIMENSION && height <= MAX_REASONABLE_DIMENSION;
  if (!dimensionsValid) reasons.push(`dimensions ${width}x${height} are not valid (must be >0 and <=${MAX_REASONABLE_DIMENSION}px)`);

  const valid = isPng && dimensionsValid && withinMaxSize;
  return { valid, reasons, isPng, width, height, sizeBytes, withinMaxSize };
}
