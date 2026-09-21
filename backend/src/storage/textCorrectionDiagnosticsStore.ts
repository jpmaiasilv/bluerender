import fs from 'node:fs';
import path from 'node:path';
import { serverLogger } from '../lib/logger';

/**
 * Private, temporary storage for the text preservation/correction layer's
 * artifacts — requirement: "Salve artefatos privados: caixas de textos
 * originais; máscara textual expandida; caixas de texto novo confirmadas;
 * resultado antes e depois da restauração; decisão individual de cada
 * caixa." Same conventions as the other private diagnostics stores in this
 * project: never under backend/public/, associated by jobId, TTL-swept.
 */
const DIAGNOSTICS_DIR = path.join(__dirname, '..', '..', 'private-diagnostics', 'humanized-floorplan-text-correction');

const MIN_TTL_MS = 5 * 60 * 1000;
const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export function resolveTextCorrectionDiagnosticsTtlMs(raw: string | undefined): number {
  if (!raw) return DEFAULT_TTL_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_TTL_MS || value > MAX_TTL_MS) {
    throw new Error(`Invalid HUMANIZED_FLOORPLAN_TEXT_CORRECTION_DIAGNOSTICS_TTL_MS "${raw}" — must be a number between ${MIN_TTL_MS} and ${MAX_TTL_MS}.`);
  }
  return value;
}

export const TEXT_CORRECTION_DIAGNOSTICS_TTL_MS: number = resolveTextCorrectionDiagnosticsTtlMs(process.env.HUMANIZED_FLOORPLAN_TEXT_CORRECTION_DIAGNOSTICS_TTL_MS);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TextCorrectionDiagnosticsPayload {
  originalTextRegions: unknown[];
  confirmedNewTextBoxes: unknown[];
  perBoxDecisions: unknown[];
  allSafelyCorrected: boolean;
  residualSuspicious: boolean;
  residualNewTextBlobCount: number;
  /** How many of the (global, unfiltered) residual candidates overlap a region this pass actually corrected — these are the ones that count. */
  residualBoxesWithinConfirmedRegionsCount: number;
  /** How many are entirely outside every corrected region — pre-existing candidates OpenAI's own verification already implicitly dismissed; informational only, never blocking (see lib/floorplanMask/textCorrection.ts). */
  residualBoxesExternalCount: number;
}

export function saveTextCorrectionDiagnostics(
  jobId: string,
  payload: TextCorrectionDiagnosticsPayload,
  images: { expandedTextMaskPng: Buffer; beforeRestorationPng: Buffer; afterRestorationPng: Buffer }
): void {
  if (!UUID_PATTERN.test(jobId)) {
    throw new Error('saveTextCorrectionDiagnostics: jobId must be a valid UUID.');
  }
  const dir = path.join(DIAGNOSTICS_DIR, jobId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(payload, null, 2));
  fs.writeFileSync(path.join(dir, 'expanded-text-mask.png'), images.expandedTextMaskPng);
  fs.writeFileSync(path.join(dir, 'before-restoration.png'), images.beforeRestorationPng);
  fs.writeFileSync(path.join(dir, 'after-restoration.png'), images.afterRestorationPng);
}

export function sweepExpiredTextCorrectionDiagnostics(nowMs: number = Date.now(), ttlMs: number = TEXT_CORRECTION_DIAGNOSTICS_TTL_MS): number {
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

export function startTextCorrectionDiagnosticsCleanup(): void {
  if (sweepIntervalStarted) return;
  sweepIntervalStarted = true;
  setInterval(() => {
    try {
      const removed = sweepExpiredTextCorrectionDiagnostics();
      if (removed > 0) serverLogger.log(`Swept ${removed} expired text-correction diagnostics folder(s).`);
    } catch (err) {
      serverLogger.error('Failed to sweep expired text-correction diagnostics', err);
    }
  }, 15 * 60 * 1000).unref();
}
