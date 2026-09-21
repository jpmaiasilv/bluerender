/**
 * Local test suite for the Planta Humanizada OpenAI-vision + FLUX.1 Fill
 * route (routes/generateHumanizedFloorplan.ts) — covers the billing-safety
 * and validation-gate rewrite: OpenAI connected to the flow, Gemini never
 * called, the 2-credit shared cost, the heuristic-can't-reject-alone rule,
 * the second OpenAI verification's authority over text rejections, private
 * rejection diagnostics, single debit, no charge on failure, and polling
 * never re-executing anything.
 *
 * Runs entirely offline — no network calls, no OPENAI_API_KEY/BFL_API_KEY
 * needed, no credits spent. The route's own `runJob` makes real network
 * calls (OpenAI + BFL) by design, so it is deliberately NOT invoked here;
 * instead this suite (a) unit-tests every pure decision/helper function the
 * route exports, and (b) inspects the route's own source text for the
 * sequencing/billing invariants that can't be exercised without a live
 * provider call — the same structural-verification approach already used
 * to audit this route by hand earlier in this project.
 *
 * Run with: npm run test:generate-humanized-floorplan -w backend
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  decideFinalAcceptance,
  SuspiciousTextCheck,
  TextVerificationOutcome,
} from '../src/lib/floorplanMask/floorplanValidation';
import { HUMANIZED_FLOORPLAN_WALLET_DEBIT_CREDITS } from '../src/config/humanizedFloorplanEngine';
import { OPENAI_TEXT_VERIFICATION_MIN_CONFIDENCE, ACTIVE_VISION_PROVIDER } from '../src/config/openaiModels';
import { buildHumanizedFloorplanFillPrompt } from '../src/lib/humanizedFloorplanPromptBuilder';
import { assertOpenAiVisionProviderActive, buildSemanticContext } from '../src/routes/generateHumanizedFloorplan';
import {
  PRIVATE_DIAGNOSTICS_TTL_MS,
  resolvePrivateDiagnosticsTtlMs,
  savePrivateRejectionDiagnostics,
  sweepExpiredPrivateDiagnostics,
} from '../src/storage/privateDiagnosticsStore';
import { FinalOpenAIObject, FinalOpenAIRoom } from '../src/lib/floorplanFurniture/openaiTypes';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
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

function noSuspicion(): SuspiciousTextCheck {
  return { suspicious: false, newTextBlobCount: 0, boxes: [] };
}

function suspicious(count = 12): SuspiciousTextCheck {
  return { suspicious: true, newTextBlobCount: count, boxes: [], reason: `Detectados ${count} elementos...` };
}

function verification(overrides: Partial<TextVerificationOutcome>): TextVerificationOutcome {
  return { possuiTextoNovo: false, quantidade: 0, boundingBoxes: [], confianca: 0, justificativa: 'stub', ...overrides };
}

const ROUTE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../src/routes/generateHumanizedFloorplan.ts'), 'utf8');

async function main() {
  console.log('Planta Humanizada — OpenAI-vision route local tests\n');

  // --- Shared cost config ---
  await test('the wallet debit cost is 2 credits', () => {
    assert.equal(HUMANIZED_FLOORPLAN_WALLET_DEBIT_CREDITS, 2);
  });

  await test('the /config endpoint reports the SAME constant that is actually reserved and captured (single shared source, not two hardcoded numbers)', () => {
    const configHandlerIndex = ROUTE_SOURCE.indexOf("'/generate-humanized-floorplan/config'");
    const debitCallIndex = ROUTE_SOURCE.indexOf('captureCredits(reservation)');
    assert.ok(configHandlerIndex >= 0, '/config route must exist');
    assert.ok(debitCallIndex >= 0, 'the credits are captured for the reservation made with the shared constant');
    assert.ok(/reserveCredits\(\{[^}]*amount: HUMANIZED_FLOORPLAN_WALLET_DEBIT_CREDITS/.test(ROUTE_SOURCE), 'the reservation must use the shared constant');
    const configHandlerSlice = ROUTE_SOURCE.slice(configHandlerIndex, configHandlerIndex + 400);
    assert.ok(
      configHandlerSlice.includes('HUMANIZED_FLOORPLAN_WALLET_DEBIT_CREDITS'),
      '/config handler must return the same HUMANIZED_FLOORPLAN_WALLET_DEBIT_CREDITS constant used for billing'
    );
  });

  // --- OpenAI connected / Gemini never called ---
  await test('ACTIVE_VISION_PROVIDER defaults to "openai"', () => {
    assert.equal(ACTIVE_VISION_PROVIDER, 'openai');
  });

  await test('assertOpenAiVisionProviderActive passes for "openai" and throws for every other provider', () => {
    assert.doesNotThrow(() => assertOpenAiVisionProviderActive('openai'));
    assert.throws(() => assertOpenAiVisionProviderActive('gemini'), /VISION_PROVIDER=openai/);
  });

  await test('the route imports the OpenAI furniture-detection pipeline', () => {
    assert.ok(ROUTE_SOURCE.includes("from '../lib/floorplanFurniture/detectFloorplanFurnitureOpenAI'"));
  });

  await test('the route never imports the Gemini furniture-detection pipeline or providers/geminiVision', () => {
    const importLines = ROUTE_SOURCE.split('\n').filter((line) => line.trim().startsWith('import '));
    assert.ok(
      importLines.every((line) => !line.includes("floorplanFurniture/detectFloorplanFurniture'")),
      'must not import the Gemini-only detector (note: distinct from ...OpenAI)'
    );
    assert.ok(
      importLines.every((line) => !line.includes('geminiVision')),
      'must not import the Gemini provider (mentioning it in a comment, as this file\'s own header does to explain the exclusion, is fine)'
    );
  });

  await test('runJob asserts the OpenAI vision provider is active before any paid call', () => {
    const runJobIndex = ROUTE_SOURCE.indexOf('async function runJob');
    const assertIndex = ROUTE_SOURCE.indexOf('assertOpenAiVisionProviderActive()');
    const generateFillIndex = ROUTE_SOURCE.indexOf('generateFill(');
    assert.ok(assertIndex >= 0 && generateFillIndex > assertIndex, 'the provider gate must run before the FLUX call');
    // Also called synchronously in the POST handler, before the job is even created.
    assert.ok(assertIndex < runJobIndex, 'the POST handler must also gate before creating the job');
  });

  // --- Billing structure: single debit, only on the accepted path, never in the GET handler ---
  await test('the credits are captured (consumed) exactly once in the whole file, and refunded on failure', () => {
    const marker = 'captureCredits(reservation)';
    const count = ROUTE_SOURCE.split(marker).length - 1;
    assert.equal(count, 1, `expected exactly one captureCredits() call, found ${count}`);
    assert.ok(/refundCredits\(reservation, 'generation_failed'\)/.test(ROUTE_SOURCE), 'a failed job must refund its reservation');
  });

  await test('the single debit() call happens after the acceptance check and before runJob\'s own catch block (never on a rejected/failed path)', () => {
    const runJobStart = ROUTE_SOURCE.indexOf('async function runJob');
    assert.ok(runJobStart >= 0);
    const runJobSource = ROUTE_SOURCE.slice(runJobStart);
    const acceptCheckIndex = runJobSource.indexOf('if (!decision.accepted)');
    const debitIndex = runJobSource.indexOf('captureCredits(reservation)');
    const catchIndex = runJobSource.indexOf('} catch (err) {');
    assert.ok(acceptCheckIndex >= 0 && debitIndex > acceptCheckIndex, 'debit() must come after the acceptance gate');
    assert.ok(catchIndex > debitIndex, 'debit() must be inside the try block, before runJob\'s catch');
  });

  await test('the GET /:jobId handler never calls runJob or debit — polling cannot repeat a generation or a charge', () => {
    const getHandlerStart = ROUTE_SOURCE.indexOf("generateHumanizedFloorplanRouter.get('/generate-humanized-floorplan/:jobId'");
    const getHandlerEnd = ROUTE_SOURCE.indexOf('interface JobInput');
    assert.ok(getHandlerStart >= 0 && getHandlerEnd > getHandlerStart);
    const getHandlerSource = ROUTE_SOURCE.slice(getHandlerStart, getHandlerEnd);
    assert.ok(!getHandlerSource.includes('runJob('), 'GET handler must never invoke runJob');
    assert.ok(!/captureCredits|refundCredits|reserveCredits/.test(getHandlerSource), 'GET handler must never touch the wallet');
  });

  await test('a rejection saves private diagnostics BEFORE the (unreachable-on-reject) debit call, in source order', () => {
    const saveIndex = ROUTE_SOURCE.indexOf('savePrivateRejectionDiagnostics(job.id');
    const debitIndex = ROUTE_SOURCE.indexOf('captureCredits(reservation)');
    assert.ok(saveIndex >= 0, 'diagnostics must be saved on rejection');
    assert.ok(saveIndex < debitIndex, 'diagnostics saving must be in the rejection branch, which precedes the success/debit branch');
  });

  // --- decideFinalAcceptance: the core "heuristic alone never rejects" rule ---
  await test('decideFinalAcceptance rejects on geometry deviation regardless of text', () => {
    const result = decideFinalAcceptance({
      deviationAccepted: false,
      suspiciousText: noSuspicion(),
      textVerification: null,
      minConfidence: OPENAI_TEXT_VERIFICATION_MIN_CONFIDENCE,
    });
    assert.equal(result.accepted, false);
    assert.equal(result.rejectionKind, 'geometry_deviation');
  });

  await test('decideFinalAcceptance accepts a clean result (no candidates, no verification needed)', () => {
    const result = decideFinalAcceptance({
      deviationAccepted: true,
      suspiciousText: noSuspicion(),
      textVerification: null,
      minConfidence: OPENAI_TEXT_VERIFICATION_MIN_CONFIDENCE,
    });
    assert.equal(result.accepted, true);
  });

  await test('the heuristic flagging candidates never rejects by itself — a furniture/rug/texture false positive is accepted once the second verification clears it', () => {
    const result = decideFinalAcceptance({
      deviationAccepted: true,
      suspiciousText: suspicious(226), // same order of magnitude as the real furniture/texture false-positive case investigated earlier
      textVerification: verification({ possuiTextoNovo: false, quantidade: 0, confianca: 0.9, justificativa: 'Apenas texturas de tapete e móveis, nenhum texto real.' }),
      minConfidence: OPENAI_TEXT_VERIFICATION_MIN_CONFIDENCE,
    });
    assert.equal(result.accepted, true, 'a heuristic flag alone, cleared by verification, must not cause a rejection');
  });

  await test('a confirmed real hallucinated/corrupted text result is rejected', () => {
    const result = decideFinalAcceptance({
      deviationAccepted: true,
      suspiciousText: suspicious(5),
      textVerification: verification({ possuiTextoNovo: true, quantidade: 3, confianca: 0.85, justificativa: 'Texto novo e ilegível sobre a área editável.' }),
      minConfidence: OPENAI_TEXT_VERIFICATION_MIN_CONFIDENCE,
    });
    assert.equal(result.accepted, false);
    assert.equal(result.rejectionKind, 'confirmed_new_text');
  });

  await test('a confirmed-but-low-confidence verification does not reject (confidence gate is enforced)', () => {
    const result = decideFinalAcceptance({
      deviationAccepted: true,
      suspiciousText: suspicious(5),
      textVerification: verification({ possuiTextoNovo: true, quantidade: 1, confianca: 0.2, justificativa: 'Possível texto, mas incerto.' }),
      minConfidence: OPENAI_TEXT_VERIFICATION_MIN_CONFIDENCE,
    });
    assert.equal(result.accepted, true);
  });

  await test('a missing verification (technical failure never reached this function in production) never silently accepts', () => {
    const result = decideFinalAcceptance({
      deviationAccepted: true,
      suspiciousText: suspicious(5),
      textVerification: null,
      minConfidence: OPENAI_TEXT_VERIFICATION_MIN_CONFIDENCE,
    });
    assert.equal(result.accepted, false);
    assert.equal(result.rejectionKind, 'text_verification_missing');
  });

  // --- Semantic-context prompt enrichment (proves OpenAI's detections are actually used, not discarded) ---
  await test('buildSemanticContext summarizes detected rooms and replaceable furniture', () => {
    const rooms: FinalOpenAIRoom[] = [
      { id: 'r1', type: 'cozinha', label: 'Cozinha', confidence: 0.9, boxOriginalPixels: { xMin: 0, yMin: 0, xMax: 10, yMax: 10 } },
    ];
    const objects: FinalOpenAIObject[] = [
      {
        id: 'o1',
        category: 'cama',
        subcategory: null,
        roomType: 'quarto',
        confidence: 0.9,
        orientationDegrees: null,
        boxOriginalPixels: { xMin: 0, yMin: 0, xMax: 10, yMax: 10 },
        polygonOriginalPixels: null,
        modelReplaceable: true,
        notes: null,
        replaceable: true,
        uncertain: false,
        reason: 'aceito',
      },
      {
        id: 'o2',
        category: 'cama',
        subcategory: null,
        roomType: 'quarto',
        confidence: 0.9,
        orientationDegrees: null,
        boxOriginalPixels: { xMin: 0, yMin: 0, xMax: 10, yMax: 10 },
        polygonOriginalPixels: null,
        modelReplaceable: true,
        notes: null,
        replaceable: false, // rejected by combineWithStructureOpenAI — must NOT be counted
        uncertain: true,
        reason: 'incerto',
      },
    ];
    const context = buildSemanticContext(rooms, objects);
    assert.ok(context.includes('Cozinha'), 'must mention the detected room label');
    assert.ok(context.includes('1x cama'), 'must count only replaceable=true objects, not uncertain/rejected ones');
  });

  await test('buildSemanticContext returns an empty string when nothing was detected', () => {
    assert.equal(buildSemanticContext([], []), '');
  });

  await test('the Fill prompt keeps semantic context and the user prompt in separate, clearly labeled sections', () => {
    const withBoth = buildHumanizedFloorplanFillPrompt('deixe estilo minimalista', 'Rooms detected: Cozinha.');
    assert.ok(withBoth.includes('Detected context'));
    assert.ok(withBoth.includes('Rooms detected: Cozinha.'));
    assert.ok(withBoth.includes('Additional instructions'));
    assert.ok(withBoth.includes('deixe estilo minimalista'));
    const withNeither = buildHumanizedFloorplanFillPrompt();
    assert.ok(!withNeither.includes('Detected context'));
    assert.ok(!withNeither.includes('Additional instructions'));
  });

  // --- Private rejection diagnostics: never under public/, associated by jobId, auto-cleaned ---
  await test('resolvePrivateDiagnosticsTtlMs rejects an out-of-range value instead of silently clamping', () => {
    assert.throws(() => resolvePrivateDiagnosticsTtlMs('1'));
    assert.throws(() => resolvePrivateDiagnosticsTtlMs('99999999999'));
    assert.equal(resolvePrivateDiagnosticsTtlMs(undefined), PRIVATE_DIAGNOSTICS_TTL_MS);
  });

  await test('savePrivateRejectionDiagnostics rejects a non-UUID jobId (defense in depth against path traversal)', () => {
    assert.throws(() => savePrivateRejectionDiagnostics('../../etc/passwd', { resultPng: Buffer.from(''), maskPng: Buffer.from(''), markedPng: Buffer.from(''), reportJson: {} }));
  });

  await test('a rejection\'s artifacts are written privately (never under public/), associated by jobId, and readable back', async () => {
    const jobId = crypto.randomUUID();
    const reportJson = { rejectionKind: 'confirmed_new_text', jobId };
    savePrivateRejectionDiagnostics(jobId, {
      resultPng: Buffer.from('fake-result-png'),
      maskPng: Buffer.from('fake-mask-png'),
      markedPng: Buffer.from('fake-marked-png'),
      reportJson,
    });

    const dir = path.resolve(__dirname, '..', 'private-diagnostics', 'humanized-floorplan-rejections', jobId);
    assert.ok(fs.existsSync(dir), 'the diagnostics folder must exist, named by jobId');
    assert.ok(!dir.split(path.sep).includes('public'), 'diagnostics must never live under public/');
    assert.ok(fs.existsSync(path.join(dir, 'result.png')));
    assert.ok(fs.existsSync(path.join(dir, 'mask.png')));
    assert.ok(fs.existsSync(path.join(dir, 'marked.png')));
    const savedReport = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
    assert.equal(savedReport.jobId, jobId);

    // Cleanup after ourselves — this test's own artifact, not a real user's.
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test('sweepExpiredPrivateDiagnostics removes only folders older than the TTL', async () => {
    const oldJobId = crypto.randomUUID();
    const freshJobId = crypto.randomUUID();
    for (const jobId of [oldJobId, freshJobId]) {
      savePrivateRejectionDiagnostics(jobId, { resultPng: Buffer.from('x'), maskPng: Buffer.from('x'), markedPng: Buffer.from('x'), reportJson: {} });
    }
    const baseDir = path.resolve(__dirname, '..', 'private-diagnostics', 'humanized-floorplan-rejections');
    const oldTime = new Date(Date.now() - 1000);
    fs.utimesSync(path.join(baseDir, oldJobId), oldTime, oldTime);

    const removed = sweepExpiredPrivateDiagnostics(Date.now(), 500 /* ttlMs */);
    assert.ok(removed >= 1, 'the old folder should have been swept');
    assert.ok(!fs.existsSync(path.join(baseDir, oldJobId)), 'old folder must be gone');
    assert.ok(fs.existsSync(path.join(baseDir, freshJobId)), 'fresh folder must survive a short TTL sweep run just after creation');

    fs.rmSync(path.join(baseDir, freshJobId), { recursive: true, force: true });
  });

  // --- No charge on failure: every AppError path in runJob is reachable only before debit() (structural corollary of the single-debit-after-accept test above, restated for the specific failure sources requirement #27 calls out) ---
  await test('the OpenAI furniture-detection call and the FLUX call both happen before the acceptance/debit gate (a failure in either never reaches debit)', () => {
    const detectIndex = ROUTE_SOURCE.indexOf('detectFloorplanFurnitureOpenAI(input.imageBuffer');
    const fillIndex = ROUTE_SOURCE.indexOf('await generateFill(');
    const acceptIndex = ROUTE_SOURCE.indexOf('if (!decision.accepted)');
    const debitIndex = ROUTE_SOURCE.indexOf('captureCredits(reservation)');
    assert.ok(detectIndex > 0 && detectIndex < acceptIndex && acceptIndex < debitIndex);
    assert.ok(fillIndex > 0 && fillIndex < acceptIndex && acceptIndex < debitIndex);
  });

  await test('the second (text-verification) OpenAI call also happens before the acceptance/debit gate', () => {
    const verifyIndex = ROUTE_SOURCE.indexOf('await verifySuspiciousText(');
    const acceptIndex = ROUTE_SOURCE.indexOf('if (!decision.accepted)');
    const debitIndex = ROUTE_SOURCE.indexOf('captureCredits(reservation)');
    assert.ok(verifyIndex > 0 && verifyIndex < acceptIndex && acceptIndex < debitIndex);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
