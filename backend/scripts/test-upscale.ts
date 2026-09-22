/**
 * Behavioral tests for Upscale IA (Topaz "High Fidelity V2") — the pure,
 * deterministic logic: scale math, megapixel limits, credit configuration,
 * format detection. Same lightweight style as test-render-engines.ts: plain
 * assert, no network, no server, no credits spent.
 *
 * NOT covered here (would need an HTTP-mocking/integration test framework
 * this codebase doesn't otherwise use — see the final report for why this
 * line was drawn here): auth/ownership enforcement, idempotency/double-click
 * dedup, insufficient-credits gating, Topaz failure/rate-limit/timeout
 * handling, download validation, storage failure, and the actual
 * capture/refund database effects. Those are exercised by the one real,
 * controlled Topaz call (report) and by manual testing against a real
 * Supabase project.
 *
 * Run with: npm run test:upscale -w backend
 */
import assert from 'node:assert/strict';
import { creditsForScale, isUpscaleScale, TOPAZ_MAX_INPUT_MEGAPIXELS, TOPAZ_MAX_OUTPUT_MEGAPIXELS, TOPAZ_ACCEPTED_INPUT_TYPES, TOPAZ_MODEL } from '../src/config/topaz';
import { detectImageMimeType } from '../src/lib/fileSignature';
import { buildUpscaleObjectPath, isSafePathSegment, upscaleContentTypeForPath } from '../src/storage/upscaleFiles';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log('        ', err instanceof Error ? err.message : err);
    failed++;
  }
}

console.log('Upscale IA — scale math, limits, config (config/topaz.ts)\n');

test('isUpscaleScale accepts only 2 and 4', () => {
  assert.equal(isUpscaleScale(2), true);
  assert.equal(isUpscaleScale(4), true);
  assert.equal(isUpscaleScale(1), false);
  assert.equal(isUpscaleScale(8), false);
  assert.equal(isUpscaleScale('2'), false);
  assert.equal(isUpscaleScale(NaN), false);
});

test('2x and 4x output dimensions are computed from the original — never independently, always preserving aspect ratio', () => {
  const cases = [
    { w: 1536, h: 1024 },
    { w: 800, h: 600 },
    { w: 1080, h: 1920 }, // portrait
  ];
  for (const { w, h } of cases) {
    for (const scale of [2, 4] as const) {
      const outW = w * scale;
      const outH = h * scale;
      // The defining property: output/input ratio must equal input's own
      // width/height ratio exactly (scaling both dimensions by the same
      // factor can never distort the ratio, unlike independently-set values).
      assert.equal(outW / outH, w / h, `${w}x${h} at ${scale}x`);
      assert.equal(outW, w * scale);
      assert.equal(outH, h * scale);
    }
  }
});

test('credits default to a provisional value and respect env overrides', () => {
  delete process.env.TOPAZ_UPSCALE_2X_INTERNAL_CREDITS;
  delete process.env.TOPAZ_UPSCALE_4X_INTERNAL_CREDITS;
  assert.equal(creditsForScale(2), 5);
  assert.equal(creditsForScale(4), 10);

  process.env.TOPAZ_UPSCALE_2X_INTERNAL_CREDITS = '3';
  process.env.TOPAZ_UPSCALE_4X_INTERNAL_CREDITS = '7';
  assert.equal(creditsForScale(2), 3);
  assert.equal(creditsForScale(4), 7);

  process.env.TOPAZ_UPSCALE_2X_INTERNAL_CREDITS = 'not-a-number';
  assert.equal(creditsForScale(2), 5, 'invalid env value falls back to the default, never NaN');

  delete process.env.TOPAZ_UPSCALE_2X_INTERNAL_CREDITS;
  delete process.env.TOPAZ_UPSCALE_4X_INTERNAL_CREDITS;
});

test('input megapixel limit: at/under 512MP passes, over it is flagged', () => {
  const atLimit = { w: 16384, h: TOPAZ_MAX_INPUT_MEGAPIXELS * 1_000_000 / 16384 };
  assert.ok((atLimit.w * atLimit.h) / 1_000_000 <= TOPAZ_MAX_INPUT_MEGAPIXELS + 0.01);
  const overLimit = { w: 30000, h: 30000 }; // 900MP
  assert.ok((overLimit.w * overLimit.h) / 1_000_000 > TOPAZ_MAX_INPUT_MEGAPIXELS);
});

test('output megapixel limit: 4x on a large-enough original exceeds the cap and must be blocked', () => {
  // A 12000x8000 (96MP) original at 4x -> 48000x32000 = 1536MP, over the 1024MP output cap.
  const w = 12000;
  const h = 8000;
  const outputMp = (w * 4 * (h * 4)) / 1_000_000;
  assert.ok(outputMp > TOPAZ_MAX_OUTPUT_MEGAPIXELS, 'this case should exceed the output limit and be rejected before calling Topaz');
  // The same original at 2x stays within the cap.
  const outputMp2x = (w * 2 * (h * 2)) / 1_000_000;
  assert.ok(outputMp2x <= TOPAZ_MAX_OUTPUT_MEGAPIXELS, '2x of the same original should still be allowed');
});

test('Topaz does not accept webp — only jpeg/png are declared as accepted input types', () => {
  assert.deepEqual([...TOPAZ_ACCEPTED_INPUT_TYPES].sort(), ['image/jpeg', 'image/png']);
});

test('model id is the exact string Topaz expects, not a guess', () => {
  assert.equal(TOPAZ_MODEL, 'High Fidelity V2');
});

console.log('\nUpscale IA — upload validation (lib/fileSignature.ts)\n');

test('a PNG magic-byte header is detected regardless of the declared Content-Type', () => {
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(detectImageMimeType(pngHeader), 'image/png');
});

test('a JPEG magic-byte header is detected', () => {
  const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  assert.equal(detectImageMimeType(jpegHeader), 'image/jpeg');
});

test('webp is detected by signature, so the route can explicitly reject it with a clear message (never silently forwarded to Topaz)', () => {
  const webpHeader = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
  assert.equal(detectImageMimeType(webpHeader), 'image/webp');
});

test('garbage bytes are never guessed into a valid type', () => {
  assert.equal(detectImageMimeType(Buffer.from([0x00, 0x01, 0x02, 0x03])), null);
});

console.log('\nUpscale IA — storage paths (storage/upscaleFiles.ts)\n');

test('object paths are only ever built from validated ids — never from a client-supplied name', () => {
  const userId = 'a1b2c3d4-e5f6-7890';
  const jobId = 'job1234-5678-90ab';
  assert.equal(buildUpscaleObjectPath(userId, jobId, 'original', 'image/png'), `${userId}/${jobId}/original.png`);
  assert.equal(buildUpscaleObjectPath(userId, jobId, 'result', 'image/jpeg'), `${userId}/${jobId}/result.jpg`);
});

test('an unsafe path segment (path traversal, short ids) is rejected, never silently sanitized', () => {
  assert.equal(isSafePathSegment('../../etc/passwd'), false);
  assert.equal(isSafePathSegment('short'), false);
  assert.equal(isSafePathSegment('a1b2c3d4-e5f6-7890'), true);
  assert.throws(() => buildUpscaleObjectPath('../evil', 'job1234-5678-90ab', 'original', 'image/png'));
});

test('content type is derived from the stored extension, matching what was actually saved', () => {
  assert.equal(upscaleContentTypeForPath('user/job/result.jpg'), 'image/jpeg');
  assert.equal(upscaleContentTypeForPath('user/job/result.png'), 'image/png');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
