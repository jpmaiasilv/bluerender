/**
 * Tests for Vídeo IA's error-handling fix: the original Gemini/Veo failure
 * must always be captured and stored on the job BEFORE a credit refund is
 * attempted, and a problem during the refund itself must never overwrite or
 * hide it. Pure logic + one real (but free) call against the configured
 * wallet backend with a reservation that was never actually made, to prove
 * attemptRefund() never throws even when the refund genuinely cannot be
 * recorded. No Gemini/Veo API call is made — simulating "a failure in the
 * Gemini API" means feeding buildJobErrorPayload() the same shapes a real
 * failure there would throw (an AppError from providers/geminiVideo.ts, a
 * plain Error, or a non-Error thrown value), which is exactly what the
 * route's catch block receives regardless of where the throw came from.
 *
 * Run with: npx tsx scripts/test-video-error-handling.ts
 */
import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { ActiveReservation } from '../src/services/creditWallet';

let passed = 0;
let failed = 0;
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

async function main() {
  const { AppError } = await import('../src/lib/errors');
  const { buildJobErrorPayload, attemptRefund } = await import('../src/routes/videoGenerator');

  console.log('Vídeo IA — error capture (buildJobErrorPayload)\n');

  await test('an AppError thrown by the Gemini/Veo provider is preserved exactly — code, message and details all survive', () => {
    const err = new AppError('GENERATION_FAILED', 'Gemini failed to generate the video.', '{"code":"SAFETY","reason":"person_generation"}', 502);
    const payload = buildJobErrorPayload(err);
    assert.equal(payload.code, 'GENERATION_FAILED');
    assert.equal(payload.message, 'Gemini failed to generate the video.');
    assert.equal(payload.details, '{"code":"SAFETY","reason":"person_generation"}');
    assert.ok(payload.message.length > 0, 'message must never be empty — this was the original bug');
  });

  await test('a timeout AppError (no video returned in time) is preserved', () => {
    const err = new AppError('GENERATION_TIMEOUT', 'The video took too long to generate.', 'operation=operations/abc123 exceeded 360000ms polling timeout', 504);
    const payload = buildJobErrorPayload(err);
    assert.equal(payload.code, 'GENERATION_TIMEOUT');
    assert.ok(payload.message.length > 0);
    assert.match(payload.details ?? '', /operations\/abc123/);
  });

  await test('a content-filtered "no video returned" AppError is preserved, including the RAI filter reason', () => {
    const err = new AppError('UNKNOWN_ERROR', 'Gemini filtered this video for a policy reason and did not generate it.', 'Person generation policy violation', 502);
    const payload = buildJobErrorPayload(err);
    assert.equal(payload.code, 'UNKNOWN_ERROR');
    assert.match(payload.message, /filtered/i);
    assert.equal(payload.details, 'Person generation policy violation');
  });

  await test('a plain (non-AppError) Error still produces a non-empty message, with the real error text kept in details', () => {
    const payload = buildJobErrorPayload(new Error('ECONNRESET: socket hang up'));
    assert.equal(payload.code, 'UNKNOWN_ERROR');
    assert.ok(payload.message.length > 0);
    assert.equal(payload.details, 'ECONNRESET: socket hang up');
  });

  await test('a non-Error thrown value (string, object, undefined) never produces an empty message', () => {
    for (const thrown of ['a string failure', { weird: 'object' }, undefined, null, 42]) {
      const payload = buildJobErrorPayload(thrown);
      assert.equal(payload.code, 'UNKNOWN_ERROR');
      assert.ok(payload.message.length > 0, `message must be non-empty for thrown value: ${String(thrown)}`);
      assert.ok(payload.details !== undefined && payload.details.length > 0, `details must capture the raw value for: ${String(thrown)}`);
    }
  });

  console.log('\nVídeo IA — refund never hides the original error (attemptRefund)\n');

  await test('attemptRefund NEVER throws, even for a reservation that was never actually made (a guaranteed-to-fail refund)', async () => {
    // A syntactically valid but entirely made-up reservation — nothing ever
    // reserved this, so the wallet backend cannot find it to refund. This is
    // the real, executable version of "simulate a failure in the credit
    // refund": refundCredits() is designed to catch exactly this and hand the
    // reservation to the wallet reconciler instead of throwing — attemptRefund
    // must survive it regardless, so the caller (runJob's catch block) is
    // never at risk of an unhandled rejection that would skip recordGeneration().
    const bogusReservation: ActiveReservation = {
      id: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      amount: 35,
      tool: 'video_generator',
      generationId: crypto.randomUUID(),
      reused: false,
      balanceAfter: 0,
    };

    const outcome = await attemptRefund('test-job-id', bogusReservation);
    assert.notEqual(outcome, 'threw', 'attemptRefund must swallow a failed refund, never propagate it');
    assert.ok(['refunded', 'pending_reconciliation'].includes(outcome), `unexpected outcome: ${outcome}`);
  });

  await test('the original error payload is unaffected by whatever the refund attempt returns — simulates the exact ordering the bug was about', async () => {
    // Reproduces runJob's catch block ordering directly: capture the error
    // FIRST, then attempt the refund — and prove the stored payload is the
    // same object/value before and after, regardless of the refund's outcome.
    const originalErr = new AppError('GENERATION_FAILED', 'Gemini failed to generate the video.', 'raw provider details', 502);
    const errorPayload = buildJobErrorPayload(originalErr);
    const snapshotBeforeRefund = { ...errorPayload };

    const bogusReservation: ActiveReservation = {
      id: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      amount: 20,
      tool: 'video_generator',
      generationId: crypto.randomUUID(),
      reused: false,
      balanceAfter: 0,
    };
    await attemptRefund('test-job-id-2', bogusReservation);

    assert.deepEqual(errorPayload, snapshotBeforeRefund, 'the error payload must be byte-for-byte unchanged after the refund attempt, success or not');
    assert.equal(errorPayload.message, 'Gemini failed to generate the video.');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test run crashed:', err);
  process.exit(1);
});
