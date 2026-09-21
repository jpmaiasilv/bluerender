import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Raw media the user drops into the Video Editor (uploaded videos/images/music) —
 * kept separate from `public/results` (AI-generated outputs) so the two can be
 * reasoned about and cleaned up independently. */
export const UPLOADS_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');

const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

function ensureDir(): void {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function extensionFor(mimeType: string): string {
  if (mimeType === 'video/mp4') return 'mp4';
  if (mimeType === 'video/webm') return 'webm';
  if (mimeType === 'video/quicktime') return 'mov';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'audio/mpeg') return 'mp3';
  if (mimeType === 'audio/wav') return 'wav';
  if (mimeType === 'audio/mp4') return 'm4a';
  return 'bin';
}

/** Persists an uploaded media file and returns its public URL path (served under /uploads). */
export function saveUploadedMedia(buffer: Buffer, mimeType: string): string {
  ensureDir();
  const id = crypto.randomUUID();
  const filename = `${id}.${extensionFor(mimeType)}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  return `/uploads/${filename}`;
}

/** Best-effort sweep of stale uploads (editor sessions abandoned without exporting). Mirrors the job-TTL sweep pattern used elsewhere in the backend. */
export function sweepStaleUploads(): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(UPLOADS_DIR);
  } catch {
    return;
  }
  const now = Date.now();
  for (const entry of entries) {
    const filePath = path.join(UPLOADS_DIR, entry);
    try {
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > UPLOAD_TTL_MS) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // File may have been removed concurrently — safe to ignore.
    }
  }
}
