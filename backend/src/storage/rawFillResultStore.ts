import fs from 'node:fs';
import path from 'node:path';
import { serverLogger } from '../lib/logger';

/**
 * Private, temporary storage for the RAW FLUX.1 Fill output — the image
 * exactly as BFL returned it, BEFORE forceOriginalDimensions/
 * overlayOriginalWallLines/validateAndFinalizeResult ever touch it. Saved
 * unconditionally (both an eventual accept AND an eventual reject), since
 * this is the one pipeline artifact that was otherwise never persisted
 * anywhere — requirement: authorized real-run reports must be able to show
 * "resultado bruto do FLUX" distinct from "resultado final" (the corrected,
 * wall-line-fixed image already saved by saveResultImage on accept, or by
 * storage/privateDiagnosticsStore.ts on reject).
 *
 * Deliberately its own tiny store (not folded into privateDiagnosticsStore.ts,
 * which is reject-only and image+report bundle-shaped) — same conventions:
 * never under backend/public/, associated by jobId, TTL-swept.
 */
const RAW_RESULTS_DIR = path.join(__dirname, '..', '..', 'private-diagnostics', 'humanized-floorplan-raw-results');

const MIN_TTL_MS = 5 * 60 * 1000;
const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export function resolveRawFillResultTtlMs(raw: string | undefined): number {
  if (!raw) return DEFAULT_TTL_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_TTL_MS || value > MAX_TTL_MS) {
    throw new Error(`Invalid HUMANIZED_FLOORPLAN_RAW_RESULT_TTL_MS "${raw}" — must be a number between ${MIN_TTL_MS} and ${MAX_TTL_MS}.`);
  }
  return value;
}

export const RAW_FILL_RESULT_TTL_MS: number = resolveRawFillResultTtlMs(process.env.HUMANIZED_FLOORPLAN_RAW_RESULT_TTL_MS);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `extension` should match the actual bytes ('png' or 'jpeg') — the buffer is saved verbatim, exactly as the provider returned it, no re-encoding. */
export function saveRawFillResult(jobId: string, rawImageBuffer: Buffer, extension: 'png' | 'jpeg'): void {
  if (!UUID_PATTERN.test(jobId)) {
    throw new Error('saveRawFillResult: jobId must be a valid UUID.');
  }
  const dir = path.join(RAW_RESULTS_DIR, jobId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `raw.${extension}`), rawImageBuffer);
}

export function sweepExpiredRawFillResults(nowMs: number = Date.now(), ttlMs: number = RAW_FILL_RESULT_TTL_MS): number {
  if (!fs.existsSync(RAW_RESULTS_DIR)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(RAW_RESULTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(RAW_RESULTS_DIR, entry.name);
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(dir).mtimeMs;
    } catch {
      continue;
    }
    if (nowMs - mtimeMs > ttlMs) {
      fs.rmSync(dir, { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}

let sweepIntervalStarted = false;

export function startRawFillResultCleanup(): void {
  if (sweepIntervalStarted) return;
  sweepIntervalStarted = true;
  setInterval(() => {
    try {
      const removed = sweepExpiredRawFillResults();
      if (removed > 0) serverLogger.log(`Swept ${removed} expired raw Fill result folder(s).`);
    } catch (err) {
      serverLogger.error('Failed to sweep expired raw Fill results', err);
    }
  }, 15 * 60 * 1000).unref();
}
