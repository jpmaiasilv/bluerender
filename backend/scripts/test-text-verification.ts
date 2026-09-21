/**
 * Local test suite for the second, OpenAI-based text-verification pipeline's
 * structural/semantic validation split — mirrors the identical fix already
 * applied to the furniture-detection pipeline (test-openai-vision-filtering.ts),
 * after the SAME class of bug hit here on 2026-09-19: one degenerate
 * `boundingBoxes` entry (yMax <= yMin) voided the WHOLE verification
 * response, discarding a perfectly usable possuiTextoNovo/confianca/
 * justificativa verdict along with 3 valid boxes, after FLUX had already run
 * (no charge, but wasted work and a generic UNKNOWN_ERROR instead of a
 * clear VALIDATION_ERROR).
 *
 * Runs entirely offline — no OPENAI_API_KEY needed, no network call, no
 * credits spent.
 *
 * Run with: npx tsx scripts/test-text-verification.ts
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  filterTextVerificationBoxes,
  parseTextVerificationResponse,
} from '../src/lib/floorplanMask/textVerificationSchema';
import { getTextVerificationCallCount } from '../src/providers/openaiTextVerification';
import {
  resolveTextVerificationDiagnosticsTtlMs,
  saveTextVerificationDiagnostics,
  sweepExpiredTextVerificationDiagnostics,
  TEXT_VERIFICATION_DIAGNOSTICS_TTL_MS,
} from '../src/storage/textVerificationDiagnosticsStore';

let passed = 0;
let failed = 0;
const callCountAtStart = getTextVerificationCallCount();

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log('        ', err instanceof Error ? err.message : err);
    failed++;
  }
}

const PROVIDER_SOURCE = fs.readFileSync(path.resolve(__dirname, '../src/providers/openaiTextVerification.ts'), 'utf8');

function buildResponse(overrides: Partial<{ possuiTextoNovo: boolean; quantidade: number; boundingBoxes: unknown[]; confianca: number; justificativa: string }> = {}) {
  return JSON.stringify({
    possuiTextoNovo: overrides.possuiTextoNovo ?? true,
    quantidade: overrides.quantidade ?? 1,
    boundingBoxes: overrides.boundingBoxes ?? [{ xMin: 10, yMin: 10, xMax: 50, yMax: 40 }],
    confianca: overrides.confianca ?? 0.8,
    justificativa: overrides.justificativa ?? 'Texto novo encontrado.',
  });
}

async function main() {
  console.log('OpenAI text-verification — structural/semantic validation split, local tests\n');

  // --- 1) One invalid box among three valid ones: kept individually, response never throws ---
  await test('a degenerate boundingBox among three valid ones is discarded individually, the other three and the verdict survive', () => {
    const sample = buildResponse({
      quantidade: 4,
      boundingBoxes: [
        { xMin: 10, yMin: 10, xMax: 50, yMax: 40 },
        { xMin: 60, yMin: 60, xMax: 90, yMax: 20 }, // degenerate: yMax < yMin — the exact real-run failure shape
        { xMin: 100, yMin: 100, xMax: 140, yMax: 130 },
        { xMin: 200, yMin: 200, xMax: 230, yMax: 240 },
      ],
    });
    const parsed = parseTextVerificationResponse(sample, 1000, 1000);
    assert.equal(parsed.possuiTextoNovo, true, 'top-level verdict must survive');
    assert.equal(parsed.confianca, 0.8);
    assert.equal(parsed.justificativa, 'Texto novo encontrado.');
    assert.equal(parsed.boundingBoxes.length, 3, 'the 3 valid boxes must survive');
    assert.equal(parsed.discardedBoxes.length, 1);
    assert.equal(parsed.discardedBoxes[0].reasonCode, 'degenerate_dimensions');
    assert.equal(parsed.boxMetrics.totalReceived, 4);
    assert.equal(parsed.boxMetrics.totalAccepted, 3);
    assert.equal(parsed.boxMetrics.totalDiscarded, 1);
  });

  // --- 2) All boxes invalid, but the general verdict is still valid and usable ---
  await test('all boundingBoxes invalid but the general verdict (possuiTextoNovo/confianca/justificativa) stays valid', () => {
    const sample = buildResponse({
      possuiTextoNovo: true,
      quantidade: 2,
      boundingBoxes: [
        { xMin: 10, yMin: 10, xMax: 5, yMax: 40 }, // inverted xMax<xMin
        { xMin: -5, yMin: 10, xMax: 40, yMax: 40 }, // out of bounds (negative)
      ],
      confianca: 0.9,
      justificativa: 'Texto corrompido detectado, mas caixas imprecisas.',
    });
    const parsed = parseTextVerificationResponse(sample, 1000, 1000);
    assert.equal(parsed.boundingBoxes.length, 0);
    assert.equal(parsed.discardedBoxes.length, 2);
    assert.equal(parsed.possuiTextoNovo, true, 'the verdict itself must not be discarded just because its boxes were bad');
    assert.equal(parsed.confianca, 0.9);
    assert.equal(parsed.justificativa, 'Texto corrompido detectado, mas caixas imprecisas.');
  });

  // --- 3) Reproduces the exact real 2026-09-19 shape ---
  await test('reproduces the real 2026-09-19 shape (4 boxes, 1 with yMax<=yMin) without throwing', () => {
    const sample = buildResponse({
      boundingBoxes: [
        { xMin: 100, yMin: 50, xMax: 150, yMax: 90 },
        { xMin: 200, yMin: 50, xMax: 250, yMax: 90 },
        { xMin: 300, yMin: 50, xMax: 350, yMax: 90 },
        { xMin: 400, yMin: 90, xMax: 450, yMax: 50 }, // yMax (50) <= yMin (90) — the real failure
      ],
    });
    assert.doesNotThrow(() => parseTextVerificationResponse(sample, 1000, 1000));
    const parsed = parseTextVerificationResponse(sample, 1000, 1000);
    assert.equal(parsed.boundingBoxes.length, 3);
    assert.equal(parsed.discardedBoxes.length, 1);
  });

  // --- 4) A box out of the image bounds ---
  await test('a box exceeding the image bounds is discarded individually', () => {
    const result = filterTextVerificationBoxes([{ xMin: 10, yMin: 10, xMax: 40, yMax: 40 }, { xMin: 900, yMin: 900, xMax: 1200, yMax: 1100 }], 1000, 1000);
    assert.equal(result.accepted.length, 1);
    assert.equal(result.discarded.length, 1);
    assert.equal(result.discarded[0].reasonCode, 'out_of_bounds');
  });

  // --- 5) Structural (schema) failures still throw ---
  await test('a genuinely malformed response (wrong type) still throws a plain Error at the parse layer', () => {
    const malformed = JSON.stringify({ possuiTextoNovo: 'yes', quantidade: 1, boundingBoxes: [], confianca: 0.5, justificativa: 'x' });
    assert.throws(() => parseTextVerificationResponse(malformed, 100, 100), /schema validation/);
  });

  await test('invalid JSON still throws a plain Error at the parse layer', () => {
    assert.throws(() => parseTextVerificationResponse('{not json', 100, 100), /not valid JSON/);
  });

  // --- 6) providers/openaiTextVerification.ts classifies a structural failure as VALIDATION_ERROR, never UNKNOWN_ERROR ---
  await test('providers/openaiTextVerification.ts wraps a structural parse failure as AppError(\'VALIDATION_ERROR\', ...)', () => {
    const parseCallIndex = PROVIDER_SOURCE.indexOf('parseTextVerificationResponse(outputText');
    assert.ok(parseCallIndex >= 0);
    const section = PROVIDER_SOURCE.slice(parseCallIndex, parseCallIndex + 500);
    assert.match(section, /catch \(err\) \{/);
    assert.match(section, /'VALIDATION_ERROR'/);
  });

  // --- 7) usage/tokens are logged, same as OpenAI Vision ---
  await test('the success log line for the text-verification call includes usage, matching providers/openaiVision.ts', () => {
    const logIndex = PROVIDER_SOURCE.indexOf("openaiLogger.log('OpenAI text-verification call completed'");
    assert.ok(logIndex >= 0);
    const line = PROVIDER_SOURCE.slice(logIndex, logIndex + 200);
    assert.match(line, /usage/);
  });

  // --- 8) Private diagnostics: TTL, never under public/, sanitized content only ---
  await test('resolveTextVerificationDiagnosticsTtlMs rejects an out-of-range value instead of silently clamping', () => {
    assert.throws(() => resolveTextVerificationDiagnosticsTtlMs('1'));
    assert.throws(() => resolveTextVerificationDiagnosticsTtlMs('999999999999'));
    assert.equal(resolveTextVerificationDiagnosticsTtlMs(undefined), TEXT_VERIFICATION_DIAGNOSTICS_TTL_MS);
  });

  await test('saveTextVerificationDiagnostics writes sanitized JSON privately (never under public/), associated by jobId, then sweeps on TTL', () => {
    const jobId = crypto.randomUUID();
    saveTextVerificationDiagnostics(jobId, {
      imageWidth: 1000,
      imageHeight: 1000,
      possuiTextoNovo: true,
      quantidade: 3,
      confianca: 0.8,
      justificativa: 'teste',
      acceptedBoxes: [{ xMin: 10, yMin: 10, xMax: 50, yMax: 40 }],
      discardedBoxes: [{ index: 1, reasonCode: 'degenerate_dimensions', reason: 'x', widthPx: 1, heightPx: -1 }],
      boxMetrics: { totalReceived: 2, totalAccepted: 1, totalDiscarded: 1, discardReasonsGrouped: { degenerate_dimensions: 1 } },
      requestId: 'resp_test',
      elapsedMs: 999,
    });
    const dir = path.resolve(__dirname, '..', 'private-diagnostics', 'humanized-floorplan-text-verification', jobId);
    assert.ok(fs.existsSync(path.join(dir, 'verification.json')));
    assert.ok(!dir.split(path.sep).includes('public'));
    const rawText = fs.readFileSync(path.join(dir, 'verification.json'), 'utf8');
    assert.ok(!/sk-[A-Za-z0-9]/.test(rawText));
    assert.ok(!/data:image\//.test(rawText));

    const oldTime = new Date(Date.now() - 1000);
    fs.utimesSync(dir, oldTime, oldTime);
    const removed = sweepExpiredTextVerificationDiagnostics(Date.now(), 500);
    assert.ok(removed >= 1);
    assert.ok(!fs.existsSync(dir));
  });

  await test('saveTextVerificationDiagnostics rejects a non-UUID jobId (defense in depth)', () => {
    assert.throws(() => saveTextVerificationDiagnostics('../../etc/passwd', {} as never));
  });

  // --- 9) No external call anywhere in this suite ---
  await test('no OpenAI text-verification call was attempted during this entire test run', () => {
    assert.equal(getTextVerificationCallCount(), callCountAtStart);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
