/**
 * Behavioral tests for the 2026-09-21 "engine by AI model identity" redesign,
 * across all three tools that got it: Render IA (config/renderEngines.ts),
 * Imagem por Texto (config/textToImageEngines.ts) and Gerador de Ideias
 * (config/ideaGeneratorEngines.ts). Pure logic, no network, no server, no
 * credits spent.
 *
 * Run with: npm run test:render-engines -w backend
 */
import assert from 'node:assert/strict';
import { getEngineConfig } from '../src/config/engines';
import { getRenderEngineOption, isRenderEngineId, listRenderEngineOptions } from '../src/config/renderEngines';
import { getT2IEngineOption, isT2IEngineTier, listT2IEngineOptions } from '../src/config/textToImageEngines';
import { getIdeaEngineOption, isIdeaEngineTier, listIdeaEngineOptions } from '../src/config/ideaGeneratorEngines';
import { getProvider } from '../src/providers/registry';

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

console.log('Render IA — engine picker (config/renderEngines.ts)\n');

test('the FLUX tier ids are kept EXACTLY as before (fast/standard/pro) so old history rows keep resolving', () => {
  assert.equal(isRenderEngineId('fast'), true);
  assert.equal(isRenderEngineId('standard'), true);
  assert.equal(isRenderEngineId('pro'), true);
  assert.equal(isRenderEngineId('gpt_image'), true);
  assert.equal(isRenderEngineId('ultra'), false);
});

test('fast/standard/pro resolve to the exact same provider/model/credits as config/engines.ts — this file relabels, never re-prices', () => {
  for (const tier of ['fast', 'standard', 'pro'] as const) {
    const shared = getEngineConfig(tier)!;
    const own = getRenderEngineOption(tier)!;
    assert.equal(own.providerId, shared.providerId, tier);
    assert.equal(own.modelId, shared.modelId, tier);
    assert.equal(own.credits, shared.credits, tier);
    assert.equal(own.technicalName, shared.technicalName, tier);
  }
});

test('only fast, gpt_image and nano_banana_2 are featured (not legacy); standard and pro are demoted to the legacy section', () => {
  assert.equal(getRenderEngineOption('fast')!.legacy, false);
  assert.equal(getRenderEngineOption('gpt_image')!.legacy, false);
  assert.equal(getRenderEngineOption('nano_banana_2')!.legacy, false);
  assert.equal(getRenderEngineOption('standard')!.legacy, true);
  assert.equal(getRenderEngineOption('pro')!.legacy, true);
});

test('gpt_image: 2 credits (same as fast, so the two compare with no cost difference), openai provider, badge "new"', () => {
  const g = getRenderEngineOption('gpt_image')!;
  assert.equal(g.providerId, 'openai');
  assert.equal(g.credits, 2);
  assert.equal(g.badge, 'new');
  assert.equal(g.credits, getRenderEngineOption('fast')!.credits);
});

test('nano_banana_2: 2 credits, gemini provider, badge "new", model id confirmed as the real Nano Banana 2 model', () => {
  const n = getRenderEngineOption('nano_banana_2')!;
  assert.equal(n.providerId, 'gemini');
  assert.equal(n.credits, 2);
  assert.equal(n.badge, 'new');
  assert.equal(n.modelId, 'gemini-3.1-flash-image');
});

test('every listed engine resolves to a REGISTERED provider that actually knows its model id', () => {
  for (const engine of listRenderEngineOptions()) {
    const provider = getProvider(engine.providerId);
    assert.ok(provider, `no provider registered for ${engine.providerId}`);
    assert.ok(provider!.models.some((m) => m.id === engine.modelId), `${engine.providerId} does not list model ${engine.modelId}`);
  }
});

test('listRenderEngineOptions() order is fast, gpt_image, nano_banana_2, standard, pro — featured engines before legacy ones', () => {
  assert.deepEqual(listRenderEngineOptions().map((e) => e.id), ['fast', 'gpt_image', 'nano_banana_2', 'standard', 'pro']);
});

test('an unknown engine id resolves to undefined, never a guess', () => {
  assert.equal(getRenderEngineOption('nano_banana_pro'), undefined);
  assert.equal(getRenderEngineOption(''), undefined);
});

console.log('\nImagem por Texto — engine picker (config/textToImageEngines.ts)\n');

test('T2I: the FLUX tier ids are kept EXACTLY as before (fast/pro/ultra) so old history rows keep resolving', () => {
  assert.equal(isT2IEngineTier('fast'), true);
  assert.equal(isT2IEngineTier('pro'), true);
  assert.equal(isT2IEngineTier('ultra'), true);
  assert.equal(isT2IEngineTier('gpt_image'), true);
  assert.equal(isT2IEngineTier('nano_banana_2'), true);
  assert.equal(isT2IEngineTier('standard'), false);
});

test('T2I: fast/pro/ultra still resolve to the exact same FLUX provider/model/credits as config/engines.ts', () => {
  const map = { fast: 'fast', pro: 'standard', ultra: 'pro' } as const;
  for (const [t2iTier, sharedTier] of Object.entries(map)) {
    const shared = getEngineConfig(sharedTier)!;
    const own = getT2IEngineOption(t2iTier)!;
    assert.equal(own.providerId, shared.providerId, t2iTier);
    assert.equal(own.modelId, shared.modelId, t2iTier);
    assert.equal(own.credits, shared.credits, t2iTier);
  }
});

test('T2I: only fast, gpt_image and nano_banana_2 are featured; pro and ultra are demoted to legacy', () => {
  assert.equal(getT2IEngineOption('fast')!.legacy, false);
  assert.equal(getT2IEngineOption('gpt_image')!.legacy, false);
  assert.equal(getT2IEngineOption('nano_banana_2')!.legacy, false);
  assert.equal(getT2IEngineOption('pro')!.legacy, true);
  assert.equal(getT2IEngineOption('ultra')!.legacy, true);
});

test('T2I: gpt_image and nano_banana_2 cost the same as fast, and resolve to registered providers', () => {
  const gpt = getT2IEngineOption('gpt_image')!;
  const nano = getT2IEngineOption('nano_banana_2')!;
  assert.equal(gpt.credits, getT2IEngineOption('fast')!.credits);
  assert.equal(nano.credits, getT2IEngineOption('fast')!.credits);
  assert.ok(getProvider(gpt.providerId)!.models.some((m) => m.id === gpt.modelId));
  assert.ok(getProvider(nano.providerId)!.models.some((m) => m.id === nano.modelId));
});

test('T2I: listT2IEngineOptions() order is fast, gpt_image, nano_banana_2, pro, ultra', () => {
  assert.deepEqual(listT2IEngineOptions().map((e) => e.id), ['fast', 'gpt_image', 'nano_banana_2', 'pro', 'ultra']);
});

console.log('\nGerador de Ideias — engine picker (config/ideaGeneratorEngines.ts)\n');

test('Idea Generator: same three featured + two legacy engines in BOTH modes (textToImage and imageToImage)', () => {
  for (const mode of ['textToImage', 'imageToImage'] as const) {
    assert.equal(isIdeaEngineTier('gpt_image'), true, mode);
    assert.equal(getIdeaEngineOption(mode, 'fast')!.legacy, false, mode);
    assert.equal(getIdeaEngineOption(mode, 'gpt_image')!.legacy, false, mode);
    assert.equal(getIdeaEngineOption(mode, 'nano_banana_2')!.legacy, false, mode);
    assert.equal(getIdeaEngineOption(mode, 'pro')!.legacy, true, mode);
    assert.equal(getIdeaEngineOption(mode, 'ultra')!.legacy, true, mode);
    assert.deepEqual(listIdeaEngineOptions(mode).map((e) => e.id), ['fast', 'gpt_image', 'nano_banana_2', 'pro', 'ultra']);
  }
});

test('Idea Generator: fast/pro/ultra still resolve to the exact same FLUX provider/model/credits as config/engines.ts, per mode', () => {
  const map = { fast: 'fast', pro: 'standard', ultra: 'pro' } as const;
  for (const mode of ['textToImage', 'imageToImage'] as const) {
    for (const [ideaTier, sharedTier] of Object.entries(map)) {
      const shared = getEngineConfig(sharedTier)!;
      const own = getIdeaEngineOption(mode, ideaTier)!;
      assert.equal(own.providerId, shared.providerId, `${mode}/${ideaTier}`);
      assert.equal(own.modelId, shared.modelId, `${mode}/${ideaTier}`);
      assert.equal(own.credits, shared.credits, `${mode}/${ideaTier}`);
    }
  }
});

test('Idea Generator: gpt_image/nano_banana_2 resolve to registered providers in both modes', () => {
  for (const mode of ['textToImage', 'imageToImage'] as const) {
    const gpt = getIdeaEngineOption(mode, 'gpt_image')!;
    const nano = getIdeaEngineOption(mode, 'nano_banana_2')!;
    assert.ok(getProvider(gpt.providerId)!.models.some((m) => m.id === gpt.modelId), mode);
    assert.ok(getProvider(nano.providerId)!.models.some((m) => m.id === nano.modelId), mode);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
