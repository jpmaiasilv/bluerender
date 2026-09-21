import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getSupabaseAdmin, isSupabaseAdminConfigured } from '../lib/supabaseAdmin';
import { serverLogger } from '../lib/logger';
import { LOCAL_FALLBACK_BANNER, isLocalDevFallbackAllowed, isProduction } from '../config/runtimeEnvironment';

/**
 * Private file storage for Planta Humanizada — original plan, optional style
 * reference and the final result (PNG + JPG).
 *
 * Production/normal: a PRIVATE Supabase Storage bucket. Objects live at
 * "<user_id>/<generation_id>/<original|style-reference|result>.<ext>"; nothing
 * has a public URL, and the browser only ever receives short-lived signed
 * URLs minted after an ownership check. Paths are built ONLY from validated
 * ids and a server-chosen extension — never from a client-supplied name.
 *
 * The local-disk backend exists solely for tests and the explicit dev
 * fallback and refuses to construct in production.
 */

export const HUMANIZED_BUCKET = 'humanized-floorplans';
export const SIGNED_URL_TTL_SECONDS = 10 * 60;
export const MAX_STORED_FILE_BYTES = 20 * 1024 * 1024;

export type HumanizedFileKind = 'original' | 'style-reference' | 'result' | 'candidate-1' | 'candidate-2';
export type StorableMime = 'image/png' | 'image/jpeg' | 'image/webp';

const EXTENSIONS: Record<StorableMime, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const SAFE_SEGMENT = /^[A-Za-z0-9-]{8,64}$/;

export function isSafePathSegment(value: string): boolean {
  return SAFE_SEGMENT.test(value);
}

/** The only way an object path is ever produced. Throws on anything unsafe. */
export function buildObjectPath(userId: string, generationId: string, kind: HumanizedFileKind, mime: string): string {
  if (!isSafePathSegment(userId) || !isSafePathSegment(generationId)) throw new Error('Unsafe storage path segment.');
  const ext = EXTENSIONS[mime as StorableMime];
  if (!ext) throw new Error(`Unsupported storage MIME type: ${mime}`);
  return `${userId}/${generationId}/${kind}.${ext}`;
}

export function contentTypeForPath(objectPath: string): StorableMime {
  const ext = path.extname(objectPath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

export interface HumanizedFileStorage {
  readonly backend: 'supabase' | 'local';
  save(userId: string, generationId: string, kind: HumanizedFileKind, buffer: Buffer, mime: StorableMime): Promise<string>;
  read(objectPath: string): Promise<Buffer | null>;
  exists(objectPath: string): Promise<boolean>;
  /** Removes every file of one generation. */
  removeGeneration(userId: string, generationId: string): Promise<void>;
  /** Short-lived signed URL, or null when the object is missing. `downloadName` makes the browser save it under that name. */
  signedUrl(objectPath: string, downloadName?: string): Promise<string | null>;
}

// --- Supabase Storage ------------------------------------------------------------

export class SupabaseFileStorage implements HumanizedFileStorage {
  readonly backend = 'supabase' as const;

  private bucket() {
    return getSupabaseAdmin().storage.from(HUMANIZED_BUCKET);
  }

  async save(userId: string, generationId: string, kind: HumanizedFileKind, buffer: Buffer, mime: StorableMime): Promise<string> {
    if (buffer.length === 0 || buffer.length > MAX_STORED_FILE_BYTES) throw new Error('File size is outside the allowed range.');
    const objectPath = buildObjectPath(userId, generationId, kind, mime);
    const { error } = await this.bucket().upload(objectPath, buffer, { contentType: mime, upsert: true });
    if (error) throw new Error(`storage upload failed: ${error.message}`);
    return objectPath;
  }

  async read(objectPath: string): Promise<Buffer | null> {
    const { data, error } = await this.bucket().download(objectPath);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  }

  async exists(objectPath: string): Promise<boolean> {
    const dir = path.posix.dirname(objectPath);
    const name = path.posix.basename(objectPath);
    const { data, error } = await this.bucket().list(dir, { search: name, limit: 5 });
    if (error) throw new Error(`storage list failed: ${error.message}`);
    return (data ?? []).some((o) => o.name === name);
  }

  async removeGeneration(userId: string, generationId: string): Promise<void> {
    if (!isSafePathSegment(userId) || !isSafePathSegment(generationId)) return;
    const dir = `${userId}/${generationId}`;
    const { data, error } = await this.bucket().list(dir, { limit: 50 });
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

export const LOCAL_FILES_ROOT = path.join(__dirname, '..', '..', 'private-data', 'humanized-floorplans');
const SIGNING_SECRET = process.env.HUMANIZED_FILE_SIGNING_SECRET || crypto.randomBytes(32).toString('hex');
const LOCAL_FILE_ROUTE = '/api/generate-humanized-floorplan-simple/file';

function sign(payload: string): string {
  return crypto.createHmac('sha256', SIGNING_SECRET).update(payload).digest('base64url');
}

export interface SignedFileClaims {
  path: string;
  expiresAt: number;
  name?: string;
}

export function createFileToken(objectPath: string, ttlMs: number = SIGNED_URL_TTL_SECONDS * 1000, now: number = Date.now(), name?: string): string {
  const payload = Buffer.from(JSON.stringify({ path: objectPath, expiresAt: now + ttlMs, ...(name ? { name } : {}) } satisfies SignedFileClaims)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyFileToken(token: string, now: number = Date.now()): SignedFileClaims | null {
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

export class LocalFileStorage implements HumanizedFileStorage {
  readonly backend = 'local' as const;

  constructor(private readonly root: string = LOCAL_FILES_ROOT) {
    if (isProduction()) throw new Error('LocalFileStorage cannot be used in production.');
  }

  private resolve(objectPath: string): string | null {
    const full = path.resolve(this.root, objectPath);
    return full.startsWith(path.resolve(this.root) + path.sep) ? full : null;
  }

  async save(userId: string, generationId: string, kind: HumanizedFileKind, buffer: Buffer, mime: StorableMime): Promise<string> {
    if (buffer.length === 0 || buffer.length > MAX_STORED_FILE_BYTES) throw new Error('File size is outside the allowed range.');
    const objectPath = buildObjectPath(userId, generationId, kind, mime);
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

  async exists(objectPath: string): Promise<boolean> {
    const full = this.resolve(objectPath);
    return Boolean(full && fs.existsSync(full) && fs.statSync(full).isFile());
  }

  async removeGeneration(userId: string, generationId: string): Promise<void> {
    if (!isSafePathSegment(userId) || !isSafePathSegment(generationId)) return;
    const full = this.resolve(path.posix.join(userId, generationId));
    if (full && fs.existsSync(full)) fs.rmSync(full, { recursive: true, force: true });
  }

  async signedUrl(objectPath: string, downloadName?: string): Promise<string | null> {
    if (!(await this.exists(objectPath))) return null;
    return `${LOCAL_FILE_ROUTE}?token=${encodeURIComponent(createFileToken(objectPath, undefined, undefined, downloadName))}`;
  }
}

// --- Selection ---------------------------------------------------------------

let overrideStorage: HumanizedFileStorage | null = null;
let resolved: Promise<HumanizedFileStorage> | null = null;

async function resolveStorage(): Promise<HumanizedFileStorage> {
  if (overrideStorage) return overrideStorage;
  if (isSupabaseAdminConfigured()) {
    const { data, error } = await getSupabaseAdmin().storage.getBucket(HUMANIZED_BUCKET);
    if (!error && data) {
      if (data.public) throw new Error(`Storage bucket "${HUMANIZED_BUCKET}" is PUBLIC — refusing to store floor plans in a public bucket.`);
      serverLogger.log(`Humanized floor plan files: using private Supabase Storage bucket "${HUMANIZED_BUCKET}"`);
      return new SupabaseFileStorage();
    }
    if (isProduction()) throw new Error(`Storage bucket "${HUMANIZED_BUCKET}" is not available: apply the storage migration before starting production.`);
    if (!isLocalDevFallbackAllowed()) {
      throw new Error(`Storage bucket "${HUMANIZED_BUCKET}" is not available: apply supabase/migrations/20260920110000_humanized_floorplans_storage.sql, or set ALLOW_LOCAL_DEV_FALLBACK=true.`);
    }
  } else if (isProduction() || !isLocalDevFallbackAllowed()) {
    throw new Error('Supabase is not configured: floor plan files cannot be stored.');
  }
  serverLogger.error(`${LOCAL_FALLBACK_BANNER} — floor plan files are stored on LOCAL DISK`);
  return new LocalFileStorage();
}

export function getFileStorage(): Promise<HumanizedFileStorage> {
  if (!resolved) {
    resolved = resolveStorage().catch((err) => {
      resolved = null;
      throw err;
    });
  }
  return resolved;
}

export function setFileStorageForTests(storage: HumanizedFileStorage | null): void {
  overrideStorage = storage;
  resolved = null;
}
