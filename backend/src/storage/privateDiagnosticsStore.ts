import fs from 'node:fs';
import path from 'node:path';
import { serverLogger } from '../lib/logger';

/**
 * Private, temporary storage for a REJECTED Planta Humanizada generation's
 * artifacts (the generated image, the mask used, a JSON report, and a
 * marked-up debug image) — requirement: "Preserve temporariamente o
 * resultado rejeitado... Não coloque em public/... Associe tudo ao jobId...
 * Implemente limpeza automática."
 *
 * Deliberately NOT under backend/public/ — index.ts only ever serves
 * `/results` -> public/results and `/uploads` -> public/uploads as static
 * directories, so this directory (a sibling of public/, not inside it) is
 * never reachable over HTTP by construction, not just by convention. Never
 * referenced from any response sent to the frontend (see routes/
 * generateHumanizedFloorplan.ts — the job's error payload never includes
 * this path).
 */
const DIAGNOSTICS_DIR = path.join(__dirname, '..', '..', 'private-diagnostics', 'humanized-floorplan-rejections');

const MIN_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Same fail-fast validation pattern used elsewhere in this pipeline (e.g. resolveOpenAiVisionTimeoutMs) — an out-of-range value refuses to start rather than silently clamping. */
export function resolvePrivateDiagnosticsTtlMs(raw: string | undefined): number {
  if (!raw) return DEFAULT_TTL_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_TTL_MS || value > MAX_TTL_MS) {
    throw new Error(`Invalid HUMANIZED_FLOORPLAN_DIAGNOSTICS_TTL_MS "${raw}" — must be a number between ${MIN_TTL_MS} and ${MAX_TTL_MS}.`);
  }
  return value;
}

export const PRIVATE_DIAGNOSTICS_TTL_MS: number = resolvePrivateDiagnosticsTtlMs(process.env.HUMANIZED_FLOORPLAN_DIAGNOSTICS_TTL_MS);

// crypto.randomUUID() format — the only jobId shape this store ever receives (see routes/generateHumanizedFloorplan.ts), validated before being used to build a filesystem path.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PrivateRejectionDiagnostics {
  /** The (corrected) generated image that was rejected, or the raw candidate available at the point of a technical failure. */
  resultPng: Buffer;
  /** The protected mask (black=protected) used for this job — either the auto mask or the user's edited override. */
  maskPng: Buffer;
  /** Same result image with candidate/confirmed text regions drawn on top, for human review. */
  markedPng: Buffer;
  /** Everything non-sensitive about why this was rejected — deviation, heuristic candidate count, second-verification verdict if any. Never includes the API key, request headers, or any filesystem path. */
  reportJson: Record<string, unknown>;
}

/**
 * Saves one job's rejection artifacts under a jobId-named subfolder.
 * `jobId` must already be a valid UUID (always true here — it's always
 * `crypto.randomUUID()` from the same route that calls this) — defense in
 * depth against ever using this to write outside the diagnostics directory.
 */
export function savePrivateRejectionDiagnostics(jobId: string, artifacts: PrivateRejectionDiagnostics): void {
  if (!UUID_PATTERN.test(jobId)) {
    throw new Error('savePrivateRejectionDiagnostics: jobId must be a valid UUID.');
  }
  const dir = path.join(DIAGNOSTICS_DIR, jobId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'result.png'), artifacts.resultPng);
  fs.writeFileSync(path.join(dir, 'mask.png'), artifacts.maskPng);
  fs.writeFileSync(path.join(dir, 'marked.png'), artifacts.markedPng);
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(artifacts.reportJson, null, 2));
}

/** Deletes every per-job subfolder older than the configured TTL. Exported (not just wired to setInterval below) so tests can invoke it directly and deterministically, without waiting on a real timer. */
export function sweepExpiredPrivateDiagnostics(nowMs: number = Date.now(), ttlMs: number = PRIVATE_DIAGNOSTICS_TTL_MS): number {
  if (!fs.existsSync(DIAGNOSTICS_DIR)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(DIAGNOSTICS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(DIAGNOSTICS_DIR, entry.name);
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

/** Starts the recurring cleanup sweep — called once from the route module at import time (mirrors the existing `jobs` TTL sweep pattern in generateHumanizedFloorplan.ts), guarded so tests that import this module repeatedly never register duplicate timers. */
export function startPrivateDiagnosticsCleanup(): void {
  if (sweepIntervalStarted) return;
  sweepIntervalStarted = true;
  setInterval(() => {
    try {
      const removed = sweepExpiredPrivateDiagnostics();
      if (removed > 0) serverLogger.log(`Swept ${removed} expired private floor-plan diagnostics folder(s).`);
    } catch (err) {
      serverLogger.error('Failed to sweep expired private floor-plan diagnostics', err);
    }
  }, 15 * 60 * 1000).unref();
}
