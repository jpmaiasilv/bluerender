/**
 * Unit tests for the geometry-preserving canvas step shared by both Planta
 * Humanizada modes: detect the plan's aspect ratio, pick the nearest supported
 * output size, add neutral margins only when needed, and never resample,
 * stretch, compress or crop the plan. Fully offline.
 *
 * Run: npx tsx scripts/test-floorplan-canvas.ts
 */
import assert from 'node:assert/strict';
import { Jimp } from 'jimp';
import { chooseOutputSize, pickNearestSize, prepareFloorplanCanvas, ratioOfSize } from '../src/lib/openaiImage/floorplanCanvas';

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

/** A plan with a distinctive, position-dependent pattern so any resampling/shift is detected pixel by pixel. */
async function patternedPlan(w: number, h: number, opts: { background?: number; noisyBorder?: boolean; transparent?: boolean } = {}): Promise<Buffer> {
  const img = new Jimp({ width: w, height: h, color: opts.transparent ? 0x00000000 : (opts.background ?? 0xffffffff) });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (opts.noisyBorder && border) img.setPixelColor(((((x * 37) & 0xff) << 24) | (((y * 91) & 0xff) << 16) | (((x + y) & 0xff) << 8) | 0xff) >>> 0, x, y);
      else if (!border && (x % 7 === 0 || y % 5 === 0)) img.setPixelColor(((((x * 3) & 0xff) << 24) | (((y * 5) & 0xff) << 16) | 0x00ff) >>> 0, x, y);
    }
  }
  return Buffer.from(await img.getBuffer('image/png'));
}

async function main() {
  console.log('Floor plan canvas — nearest size + neutral margins, geometry never altered\n');

  await test('nearest supported size by aspect ratio: square, 3:2, 2:3, 4:3, 5:4, 2:1, 1:2, and the 1.22 boundary', () => {
    assert.equal(pickNearestSize(1000, 1000), '1024x1024');
    assert.equal(pickNearestSize(1500, 1000), '1536x1024');
    assert.equal(pickNearestSize(1000, 1500), '1024x1536');
    assert.equal(pickNearestSize(1200, 900), '1536x1024');
    assert.equal(pickNearestSize(1250, 1000), '1536x1024');
    assert.equal(pickNearestSize(1200, 1000), '1024x1024');
    assert.equal(pickNearestSize(2000, 1000), '1536x1024');
    assert.equal(pickNearestSize(1000, 2000), '1024x1536');
    assert.equal(pickNearestSize(900, 1000), '1024x1024');
    assert.equal(pickNearestSize(700, 1000), '1024x1536');
    assert.equal(ratioOfSize('1536x1024'), 1.5);
  });

  await test('an explicit user format (square / landscape / portrait) wins over the detected ratio; "original" uses the detection', () => {
    assert.equal(chooseOutputSize(300, 200, 'square'), '1024x1024');
    assert.equal(chooseOutputSize(300, 200, 'portrait'), '1024x1536');
    assert.equal(chooseOutputSize(200, 300, 'landscape'), '1536x1024');
    assert.equal(chooseOutputSize(300, 200, 'original'), '1536x1024');
    assert.equal(chooseOutputSize(200, 300, 'original'), '1024x1536');
  });

  await test('a plan that already has the right ratio is sent UNTOUCHED (same bytes, no margins), with its size chosen', async () => {
    const png = await patternedPlan(300, 200);
    const p = await prepareFloorplanCanvas(png, 'image/png', 'original');
    assert.equal(p.padded, false);
    assert.equal(p.size, '1536x1024');
    assert.equal(p.buffer, png, 'the original bytes are passed through');
    const near = await patternedPlan(301, 200);
    assert.equal((await prepareFloorplanCanvas(near, 'image/png', 'original')).padded, false, 'sub-pixel ratio noise never triggers padding');
  });

  await test('a WIDE plan (4:1) gets margins ABOVE and BELOW only; canvas has exactly the target ratio; the plan pixels are identical, at the computed offset', async () => {
    const png = await patternedPlan(400, 100, { background: 0xf0f0f0ff });
    const p = await prepareFloorplanCanvas(png, 'image/png', 'original');
    assert.equal(p.padded, true);
    assert.equal(p.size, '1536x1024');
    assert.equal(p.canvas.width, 400, 'the plan\'s own width is untouched');
    assert.equal(p.canvas.height, Math.ceil(400 / 1.5));
    assert.ok(Math.abs(p.canvas.width / p.canvas.height - 1.5) < 0.01);
    assert.deepEqual(p.offset, { x: 0, y: Math.floor((p.canvas.height - 100) / 2) });
    const out = await Jimp.read(p.buffer);
    const orig = await Jimp.read(png);
    assert.equal(out.width, p.canvas.width);
    assert.equal(out.height, p.canvas.height);
    for (let y = 0; y < 100; y++) for (let x = 0; x < 400; x++) assert.equal(out.getPixelColor(x + p.offset.x, y + p.offset.y), orig.getPixelColor(x, y), `pixel ${x},${y} changed`);
    for (const [x, y] of [[0, 0], [399, 0], [200, p.offset.y - 1], [0, p.canvas.height - 1], [399, p.offset.y + 100]]) assert.equal(out.getPixelColor(x, y), 0xf0f0f0ff, `margin at ${x},${y} must be the neutral colour`);
  });

  await test('a TALL plan (1:4) gets margins LEFT and RIGHT only, in a portrait canvas; the plan is intact', async () => {
    const png = await patternedPlan(100, 400);
    const p = await prepareFloorplanCanvas(png, 'image/png', 'original');
    assert.equal(p.size, '1024x1536');
    assert.equal(p.canvas.height, 400);
    assert.equal(p.canvas.width, Math.ceil(400 * (1024 / 1536)));
    assert.deepEqual(p.offset, { x: Math.floor((p.canvas.width - 100) / 2), y: 0 });
    const out = await Jimp.read(p.buffer);
    const orig = await Jimp.read(png);
    for (let y = 0; y < 400; y++) for (let x = 0; x < 100; x++) assert.equal(out.getPixelColor(x + p.offset.x, y + p.offset.y), orig.getPixelColor(x, y));
  });

  await test('explicit "square" on a 3:2 plan: padded to a SQUARE canvas (width kept, height extended), never stretched', async () => {
    const png = await patternedPlan(300, 200);
    const p = await prepareFloorplanCanvas(png, 'image/png', 'square');
    assert.equal(p.size, '1024x1024');
    assert.equal(p.padded, true);
    assert.deepEqual(p.canvas, { width: 300, height: 300 });
    assert.deepEqual(p.plan, { width: 300, height: 200 });
    const p2 = await prepareFloorplanCanvas(png, 'image/png', 'portrait');
    assert.equal(p2.size, '1024x1536');
    assert.ok(Math.abs(p2.canvas.width / p2.canvas.height - 1024 / 1536) < 0.01);
  });

  await test('the neutral margin follows the drawing\'s own uniform background; a noisy/non-uniform border falls back to white; transparency is flattened on white', async () => {
    const gray = await prepareFloorplanCanvas(await patternedPlan(400, 100, { background: 0xe8e0d0ff }), 'image/png', 'original');
    assert.ok(gray.marginColor && Math.abs(gray.marginColor.r - 0xe8) <= 8 && Math.abs(gray.marginColor.g - 0xe0) <= 8 && Math.abs(gray.marginColor.b - 0xd0) <= 8);
    const noisy = await prepareFloorplanCanvas(await patternedPlan(400, 100, { noisyBorder: true }), 'image/png', 'original');
    assert.deepEqual(noisy.marginColor, { r: 255, g: 255, b: 255 });
    const clear = await prepareFloorplanCanvas(await patternedPlan(400, 100, { transparent: true }), 'image/png', 'original');
    assert.deepEqual(clear.marginColor, { r: 255, g: 255, b: 255 });
    const out = await Jimp.read(clear.buffer);
    assert.equal(out.getPixelColor(0, 0), 0xffffffff, 'no transparent pixels reach the model');
  });

  await test('JPEG plans are supported and become a lossless PNG canvas; the reported plan/canvas geometry is exact', async () => {
    const img = new Jimp({ width: 600, height: 200, color: 0xffffffff });
    const jpg = Buffer.from(await img.getBuffer('image/jpeg'));
    const p = await prepareFloorplanCanvas(jpg, 'image/jpeg', 'original');
    assert.equal(p.padded, true);
    assert.equal(p.mime, 'image/png');
    const out = await Jimp.read(p.buffer);
    assert.deepEqual({ w: out.width, h: out.height }, { w: p.canvas.width, h: p.canvas.height });
    assert.equal(p.canvas.width, 600);
  });

  await test('WEBP (cannot be decoded here) and undecodable files: still get the nearest size, are sent untouched (never damaged), and never throw', async () => {
    const webp = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
    const w = await prepareFloorplanCanvas(webp, 'image/webp', 'original');
    assert.equal(w.padded, false);
    assert.equal(w.buffer, webp);
    assert.equal(w.size, '1024x1024');
    const junk = await prepareFloorplanCanvas(Buffer.from('not an image'), 'image/png', 'landscape');
    assert.equal(junk.padded, false);
    assert.equal(junk.size, '1536x1024');
  });

  await test('the plan is NEVER resampled: for many ratios the plan region equals the original pixel-for-pixel and no plan pixel is lost', async () => {
    for (const [w, h] of [[500, 120], [90, 480], [333, 333], [1000, 400], [123, 456]]) {
      const png = await patternedPlan(w, h);
      const p = await prepareFloorplanCanvas(png, 'image/png', 'original');
      if (!p.padded) continue;
      const out = await Jimp.read(p.buffer);
      const orig = await Jimp.read(png);
      assert.ok(out.width >= w && out.height >= h, `${w}x${h}: canvas must contain the whole plan`);
      let diff = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (out.getPixelColor(x + p.offset.x, y + p.offset.y) !== orig.getPixelColor(x, y)) diff++;
      assert.equal(diff, 0, `${w}x${h}: ${diff} plan pixels changed`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
