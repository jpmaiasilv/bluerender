import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getSupabaseAdmin, isSupabaseAdminConfigured } from '../lib/supabaseAdmin';
import { serverLogger } from '../lib/logger';
import { LOCAL_FALLBACK_BANNER, isLocalDevFallbackAllowed, isProduction } from '../config/runtimeEnvironment';

/**
 * Private file storage for Upscale IA — the original upload and the Topaz
 * result. Same shape as storage/humanizedFloorplanFiles.ts (see that file's
 * own comments for the full rationale), simplified to Topaz's own accepted
 * types: PNG and JPEG only (Topaz does not accept webp — see config/topaz.ts).
 *
 * Objects live at "<user_id>/<job_id>/<original|result>.<ext>" in the
 * PRIVATE "upscale-images" bucket; nothing has a public URL, the browser
 * only ever receives short-lived signed URLs after an ownership check.
 */

export const UPSCALE_BUCKET = 'upscale-images';
export const SIGNED_URL_TTL_SECONDS = 10 * 60;
export const MAX_STORED_FILE_BYTES = 500 * 1024 * 1024; // matches Topaz's own 500MB request cap

export type UpscaleFileKind = 'original' | 'result';
export type UpscaleStorableMime = 'image/png' | 'image/jpeg';

const EXTENSIONS: Record<UpscaleStorableMime, string> = { 'image/png': 'png', 'image/jpeg': 'jpg' };
const SAFE_SEGMENT = /^[A-Za-z0-9-]{8,64}$/;

export function isSafePathSegment(value: string): boolean {
  return SAFE_SEGMENT.test(value);
}

/** The only way an object path is ever produced. Throws on anything unsafe. */
export function buildUpscaleObjectPath(userId: string, jobId: string, kind: UpscaleFileKind, mime: string): string {
  if (!isSafePathSegment(userId) || !isSafePathSegment(jobId)) throw new Error('Unsafe storage path segment.');
  const ext = EXTENSIONS[mime as UpscaleStorableMime];
  if (!ext) throw new Error(`Unsupported storage MIME type: ${mime}`);
  return `${userId}/${jobId}/${kind}.${ext}`;
}

export function upscaleContentTypeForPath(objectPath: string): UpscaleStorableMime {
  const ext = path.extname(objectPath).toLowerCase();
  return ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
}

export interface UpscaleFileStorage {
  readonly backend: 'supabase' | 'local';
  save(userId: string, jobId: string, kind: UpscaleFileKind, buffer: Buffer, mime: UpscaleStorableMime): Promise<string>;
  read(objectPath: string): Promise<Buffer | null>;
  removeJob(userId: string, jobId: string): Promise<void>;
  /** Short-lived signed URL, or null when the object is missing. `downloadName` makes the browser save it under that name. */
  signedUrl(objectPath: string, downloadName?: string): Promise<string | null>;
}

// --- Supabase Storage ------------------------------------------------------------

export class SupabaseUpscaleFileStorage implements UpscaleFileStorage {
  readonly backend = 'supabase' as const;

  private bucket() {
    return getSupabaseAdmin().storage.from(UPSCALE_BUCKET);
  }

  async save(userId: string, jobId: string, kind: UpscaleFileKind, buffer: Buffer, mime: UpscaleStorableMime): Promise<string> {
    if (buffer.length === 0 || buffer.length > MAX_STORED_FILE_BYTES) throw new Error('File size is outside the allowed range.');
    const objectPath = buildUpscaleObjectPath(userId, jobId, kind, mime);
    const { error } = await this.bucket().upload(objectPath, buffer, { contentType: mime, upsert: true });
    if (error) throw new Error(`storage upload failed: ${error.message}`);
    return objectPath;
  }

  async read(objectPath: string): Promise<Buffer | null> {
    const { data, error } = await this.bucket().download(objectPath);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  }

  async removeJob(userId: string, jobId: string): Promise<void> {
    if (!isSafePathSegment(userId) || !isSafePathSegment(jobId)) return;
    const dir = `${userId}/${jobId}`;
    const { data, error } = await this.bucket().list(dir, { limit: 10 });
    if (error) throw new Error(`storage list failed: ${error.message}`);
    const paths = (data ?? []).map((o) => `${dir}/${o.name}`);
    if (paths.length === 0) return;
    const removed = await this.bucket().remove(paths);
    if (removed.error) throw new Error(`storage remove failed: ${removed.error.message}`);
  }

  async signedUrl(objectPath: string, downloadName?: string): Promise<string | null> {
    const { data, error } = await this.bucket().createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS, downloadName ? { download: downloadName } : undefined);
    if (error || !data) return null;
    return data.signedUrl;
  }
}

// --- Local disk (tests / explicit dev fallback only) -----------------------------

export const LOCAL_FILES_ROOT = path.join(__dirname, '..', '..', 'private-data', 'upscale-images');
const SIGNING_SECRET = process.env.UPSCALE_FILE_SIGNING_SECRET || crypto.randomBytes(32).toString('hex');
const LOCAL_FILE_ROUTE = '/api/upscale/file';

function sign(payload: string): string {
  return crypto.createHmac('sha256', SIGNING_SECRET).update(payload).digest('base64url');
}

interface SignedFileClaims {
  path: string;
  expiresAt: number;
  name?: string;
}

function createFileToken(objectPath: string, ttlMs: number = SIGNED_URL_TTL_SECONDS * 1000, now: number = Date.now(), name?: string): string {
  const payload = Buffer.from(JSON.stringify({ path: objectPath, expiresAt: now + ttlMs, ...(name ? { name } : {}) } satisfies SignedFileClaims)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyUpscaleFileToken(token: string, now: number = Date.now()): SignedFileClaims | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const a = Buffer.from(signature);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SignedFileClaims;
    if (typeof claims.path !== 'string' || typeof claims.expiresAt !== 'number' || claims.expiresAt < now) return null;
    return claims;
  } catch {
    return null;
  }
}

export class LocalUpscaleFileStorage implements UpscaleFileStorage {
  readonly backend = 'local' as const;

  constructor(private readonly root: string = LOCAL_FILES_ROOT) {
    if (isProduction()) throw new Error('LocalUpscaleFileStorage cannot be used in production.');
  }

  private resolve(objectPath: string): string | null {
    const full = path.resolve(this.root, objectPath);
    return full.startsWith(path.resolve(this.root) + path.sep) ? full : null;
  }

  async save(userId: string, jobId: string, kind: UpscaleFileKind, buffer: Buffer, mime: UpscaleStorableMime): Promise<string> {
    if (buffer.length === 0 || buffer.length > MAX_STORED_FILE_BYTES) throw new Error('File size is outside the allowed range.');
    const objectPath = buildUpscaleObjectPath(userId, jobId, kind, mime);
    const full = this.resolve(objectPath);
    if (!full) throw new Error('Unsafe storage path.');
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buffer);
    return objectPath;
  }

  async read(objectPath: string): Promise<Buffer | null> {
    const full = this.resolve(objectPath);
    return full && fs.existsSync(full) && fs.statSync(full).isFile() ? fs.readFileSync(full) : null;
  }

  async removeJob(userId: string, jobId: string): Promise<void> {
    if (!isSafePathSegment(userId) || !isSafePathSegment(jobId)) return;
    const full = this.resolve(path.posix.join(userId, jobId));
    if (full && fs.existsSync(full)) fs.rmSync(full, { recursive: true, force: true });
  }

  async signedUrl(objectPath: string, downloadName?: string): Promise<string | null> {
    const full = this.resolve(objectPath);
    if (!full || !fs.existsSync(full)) return null;
    return `${LOCAL_FILE_ROUTE}?token=${encodeURIComponent(createFileToken(objectPath, undefined, undefined, downloadName))}`;
  }
}

// --- Selection ---------------------------------------------------------------

let overrideStorage: UpscaleFileStorage | null = null;
let resolved: Promise<UpscaleFileStorage> | null = null;

async function resolveStorage(): Promise<UpscaleFileStorage> {
  if (overrideStorage) return overrideStorage;
  if (isSupabaseAdminConfigured()) {
    const { data, error } = await getSupabaseAdmin().storage.getBucket(UPSCALE_BUCKET);
    if (!error && data) {
      if (data.public) throw new Error(`Storage bucket "${UPSCALE_BUCKET}" is PUBLIC — refusing to store upscale files in a public bucket.`);
      serverLogger.log(`Upscale files: using private Supabase Storage bucket "${UPSCALE_BUCKET}"`);
      return new SupabaseUpscaleFileStorage();
    }
    if (isProduction()) throw new Error(`Storage bucket "${UPSCALE_BUCKET}" is not available: apply the storage migration before starting production.`);
    if (!isLocalDevFallbackAllowed()) {
      throw new Error(`Storage bucket "${UPSCALE_BUCKET}" is not available: apply supabase/migrations/20260922100000_upscale_jobs.sql, or set ALLOW_LOCAL_DEV_FALLBACK=true.`);
    }
  } else if (isProduction() || !isLocalDevFallbackAllowed()) {
    throw new Error('Supabase is not configured: upscale files cannot be stored.');
  }
  serverLogger.error(`${LOCAL_FALLBACK_BANNER} — upscale files are stored on LOCAL DISK`);
  return new LocalUpscaleFileStorage();
}

export function getUpscaleFileStorage(): Promise<UpscaleFileStorage> {
  if (!resolved) {
    resolved = resolveStorage().catch((err) => {
      resolved = null;
      throw err;
    });
  }
  return resolved;
}

export function setUpscaleFileStorageForTests(storage: UpscaleFileStorage | null): void {
  overrideStorage = storage;
  resolved = null;
}
