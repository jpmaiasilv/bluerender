import fs from 'node:fs';
import path from 'node:path';
import { serverLogger } from '../lib/logger';
import { DiscardedDetection, ObjectFilterMetrics } from '../lib/floorplanFurniture/openaiResponseSchema';

/**
 * Private, temporary storage for the OpenAI vision step's per-crop
 * structured output (accepted + discarded detections, with reasons and
 * metrics) — requirement: "Salve para diagnóstico privado, com TTL:
 * resposta estruturada sanitizada da OpenAI; detecções aceitas e
 * descartadas; caixas e motivos." Deliberately its own store, separate from
 * storage/privateDiagnosticsStore.ts (which holds FLUX-result rejection
 * artifacts — images, further downstream in the pipeline) — this one holds
 * only small JSON, one file per crop call (overview/tile-N), no images.
 *
 * Never under backend/public/ (index.ts only serves /results and /uploads
 * as static dirs), and the saved payload is ALREADY the validated,
 * structured JSON the model returned (category/confidence/boxes/notes/labels
 * as plain text) — never the raw HTTP response, so it can never contain the
 * API key, request headers, base64 image bytes, or the full prompt text.
 */
const DIAGNOSTICS_DIR = path.join(__dirname, '..', '..', 'private-diagnostics', 'humanized-floorplan-vision-detections');

const MIN_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Same fail-fast validation pattern used elsewhere in this pipeline — an out-of-range value refuses to start rather than silently clamping. */
export function resolveVisionDiagnosticsTtlMs(raw: string | undefined): number {
  if (!raw) return DEFAULT_TTL_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_TTL_MS || value > MAX_TTL_MS) {
    throw new Error(`Invalid HUMANIZED_FLOORPLAN_VISION_DIAGNOSTICS_TTL_MS "${raw}" — must be a number between ${MIN_TTL_MS} and ${MAX_TTL_MS}.`);
  }
  return value;
}

export const VISION_DIAGNOSTICS_TTL_MS: number = resolveVisionDiagnosticsTtlMs(process.env.HUMANIZED_FLOORPLAN_VISION_DIAGNOSTICS_TTL_MS);

// crypto.randomUUID() format — the only diagnosticsId shape this store ever receives, validated before being used to build a filesystem path.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// cropId is always 'overview' or 'tile-<n>' (see types.ts's SourceCrop.id / detectFloorplanFurnitureOpenAI.ts) — validated the same defensive way before touching the filesystem.
const CROP_ID_PATTERN = /^(overview|tile-\d+)$/;

export interface VisionDetectionDiagnosticsPayload {
  variant: 'overview' | 'tile';
  cropWidth: number;
  cropHeight: number;
  acceptedObjects: unknown[];
  discardedObjects: DiscardedDetection[];
  objectMetrics: ObjectFilterMetrics;
  acceptedRooms: unknown[];
  discardedRooms: DiscardedDetection[];
  roomMetrics: ObjectFilterMetrics;
  requestId: string | null;
  elapsedMs: number;
}

export function saveVisionDetectionDiagnostics(diagnosticsId: string, cropId: string, payload: VisionDetectionDiagnosticsPayload): void {
  if (!UUID_PATTERN.test(diagnosticsId)) {
    throw new Error('saveVisionDetectionDiagnostics: diagnosticsId must be a valid UUID.');
  }
  if (!CROP_ID_PATTERN.test(cropId)) {
    throw new Error('saveVisionDetectionDiagnostics: cropId must be "overview" or "tile-<n>".');
  }
  const dir = path.join(DIAGNOSTICS_DIR, diagnosticsId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${cropId}.json`), JSON.stringify(payload, null, 2));
}

/** Deletes every per-run subfolder older than the configured TTL. Exported so tests can invoke it directly and deterministically, without waiting on a real timer. */
export function sweepExpiredVisionDetectionDiagnostics(nowMs: number = Date.now(), ttlMs: number = VISION_DIAGNOSTICS_TTL_MS): number {
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

export function startVisionDetectionDiagnosticsCleanup(): void {
  if (sweepIntervalStarted) return;
  sweepIntervalStarted = true;
  setInterval(() => {
    try {
      const removed = sweepExpiredVisionDetectionDiagnostics();
      if (removed > 0) serverLogger.log(`Swept ${removed} expired vision-detection diagnostics folder(s).`);
    } catch (err) {
      serverLogger.error('Failed to sweep expired vision-detection diagnostics', err);
    }
  }, 15 * 60 * 1000).unref();
}
