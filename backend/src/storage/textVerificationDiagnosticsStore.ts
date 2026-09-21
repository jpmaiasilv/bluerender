import fs from 'node:fs';
import path from 'node:path';
import { serverLogger } from '../lib/logger';
import { DiscardedTextBox, TextBoxFilterMetrics } from '../lib/floorplanMask/textVerificationSchema';

/**
 * Private, temporary storage for the second, OpenAI-based text-verification
 * call's structured output (accepted + discarded boundingBoxes, with
 * reasons and metrics) — same conventions as storage/visionDetectionDiagnosticsStore.ts:
 * never under backend/public/, associated by jobId, TTL-swept. The saved
 * payload is the ALREADY-validated, structured JSON the model returned
 * (booleans/numbers/short text) — never the raw HTTP response, so it can
 * never contain the API key, request headers, base64 image bytes, or the
 * full prompt text.
 */
const DIAGNOSTICS_DIR = path.join(__dirname, '..', '..', 'private-diagnostics', 'humanized-floorplan-text-verification');

const MIN_TTL_MS = 5 * 60 * 1000;
const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export function resolveTextVerificationDiagnosticsTtlMs(raw: string | undefined): number {
  if (!raw) return DEFAULT_TTL_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_TTL_MS || value > MAX_TTL_MS) {
    throw new Error(`Invalid HUMANIZED_FLOORPLAN_TEXT_VERIFICATION_DIAGNOSTICS_TTL_MS "${raw}" — must be a number between ${MIN_TTL_MS} and ${MAX_TTL_MS}.`);
  }
  return value;
}

export const TEXT_VERIFICATION_DIAGNOSTICS_TTL_MS: number = resolveTextVerificationDiagnosticsTtlMs(process.env.HUMANIZED_FLOORPLAN_TEXT_VERIFICATION_DIAGNOSTICS_TTL_MS);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TextVerificationDiagnosticsPayload {
  imageWidth: number;
  imageHeight: number;
  possuiTextoNovo: boolean;
  quantidade: number;
  confianca: number;
  justificativa: string;
  acceptedBoxes: unknown[];
  discardedBoxes: DiscardedTextBox[];
  boxMetrics: TextBoxFilterMetrics;
  requestId: string | null;
  elapsedMs: number;
}

export function saveTextVerificationDiagnostics(jobId: string, payload: TextVerificationDiagnosticsPayload): void {
  if (!UUID_PATTERN.test(jobId)) {
    throw new Error('saveTextVerificationDiagnostics: jobId must be a valid UUID.');
  }
  const dir = path.join(DIAGNOSTICS_DIR, jobId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'verification.json'), JSON.stringify(payload, null, 2));
}

export function sweepExpiredTextVerificationDiagnostics(nowMs: number = Date.now(), ttlMs: number = TEXT_VERIFICATION_DIAGNOSTICS_TTL_MS): number {
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

export function startTextVerificationDiagnosticsCleanup(): void {
  if (sweepIntervalStarted) return;
  sweepIntervalStarted = true;
  setInterval(() => {
    try {
      const removed = sweepExpiredTextVerificationDiagnostics();
      if (removed > 0) serverLogger.log(`Swept ${removed} expired text-verification diagnostics folder(s).`);
    } catch (err) {
      serverLogger.error('Failed to sweep expired text-verification diagnostics', err);
    }
  }, 15 * 60 * 1000).unref();
}
