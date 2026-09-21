import fs from 'node:fs';
import path from 'node:path';

export const RESULTS_DIR = path.join(__dirname, '..', '..', 'public', 'results');

function ensureDir(): void {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

function extensionFor(contentType: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('mp4')) return 'mp4';
  if (contentType.includes('webm')) return 'webm';
  return 'png';
}

function saveResultFile(id: string, buffer: Buffer, contentType: string): string {
  ensureDir();
  const filename = `${id}.${extensionFor(contentType)}`;
  fs.writeFileSync(path.join(RESULTS_DIR, filename), buffer);
  return `/results/${filename}`;
}

/** Persists a downloaded result image locally and returns its public URL path. */
export function saveResultImage(id: string, buffer: Buffer, contentType: string): string {
  return saveResultFile(id, buffer, contentType);
}

/** Persists a downloaded result video locally and returns its public URL path. Same storage, kept as its own named export for call-site clarity. */
export function saveResultVideo(id: string, buffer: Buffer, contentType: string): string {
  return saveResultFile(id, buffer, contentType);
}

function contentTypeFor(extension: string): string {
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  return 'application/octet-stream';
}

/**
 * Reads back a previously saved result by its id — used by actions that
 * operate on an already-generated image (e.g. Planta Humanizada's "Limpeza
 * Técnica") instead of generating a brand new one from a fresh upload. `id`
 * must already be a validated identifier (e.g. checked against a UUID
 * pattern by the caller) since it's used to build a filesystem path.
 */
export function readResultFile(id: string): { buffer: Buffer; contentType: string } | null {
  for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
    const filePath = path.join(RESULTS_DIR, `${id}.${ext}`);
    if (fs.existsSync(filePath)) {
      return { buffer: fs.readFileSync(filePath), contentType: contentTypeFor(ext) };
    }
  }
  return null;
}
