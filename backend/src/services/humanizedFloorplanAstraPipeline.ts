import { AppError } from '../lib/errors';
import { analyzeFloorplanWithAstra, AstraCallMeta } from '../providers/openaiAstra';
import { generateHumanizedFloorplanImage, GenerateHumanizedFloorplanImageResult } from '../providers/openaiBlockImage';
import { buildHumanizedFloorplanPrompt, HumanizedFloorplanPromptOptions } from '../lib/openaiImage/humanizedFloorplanPrompt';
import { validateGeneratedFloorplanPng } from '../lib/openaiImage/floorplanImageValidation';
import { prepareFloorplanCanvas } from '../lib/openaiImage/floorplanCanvas';
import { AstraAnalysis, sanitizeAnalysis, sanitizeText } from '../lib/astra/astraSchemas';
import { ASTRA_MAX_LIST_ITEMS, ASTRA_PIPELINE_MAX_MS } from '../config/humanizedFloorplanAstra';
import { OPENAI_ASTRA_MODEL, OPENAI_BLOCK_IMAGE_MODEL } from '../config/openaiModels';
import { HUMANIZED_FLOORPLAN_SIMPLE_STYLE_LABELS, HUMANIZED_FLOORPLAN_LIGHTING_PHRASES, HumanizedFloorplanLighting, HumanizedFloorplanOutputFormat, HumanizedFloorplanSimpleStyle } from '../config/humanizedFloorplanSimpleStyles';
import { estimateAstraCostUsd, sumCosts } from './openaiAstraCost';
import { estimateOpenAiImageCostUsd } from './openaiImageCost';
import { GenerationRecord, GenerationUsage, PipelineStepName, PipelineStepRecord } from './humanizedFloorplanStore';
import type { HumanizedFileStorage, StorableMime } from '../storage/humanizedFloorplanFiles';

/**
 * The premium ("astra") pipeline. Exactly TWO external calls, in this order:
 *
 *   1) GPT-6 Astra analyzes the ORIGINAL plan -> architectural instructions
 *      that improve the prompt (Astra never sees the generated image).
 *   2) Sunburst generates ONE image at high quality (a single images.edit).
 *
 * If OpenAI returns a valid, readable image, that image is the result. There is
 * no score, no approval status, no violation check, no second attempt and no
 * automatic correction: nothing here can reject an image that was generated.
 * This module never touches credits: the route reserves before calling it,
 * captures only after the returned image is saved and readable, and refunds
 * when it throws (technical error, no image, or a failure to save).
 */

type Mime = StorableMime;

export interface AstraPipelineInput {
  userId: string;
  generationId: string;
  record: GenerationRecord;
  original: { buffer: Buffer; mime: Mime };
  reference: { buffer: Buffer; mime: Mime } | null;
  storage: HumanizedFileStorage;
  /** Persists + publishes the current real stage (analyzing_architecture, preparing, generating). */
  setStage: (stage: string) => Promise<void>;
  /** Persists record-level fields as they become known (analysis status). */
  patchRecord: (patch: Partial<GenerationRecord>) => Promise<void>;
  /** Persists one accounting row per step. */
  saveStep: (step: PipelineStepRecord) => Promise<void>;
}

export interface AstraPipelineResult {
  finalPng: Buffer;
  imageUsage: GenerationUsage | null;
  effectiveQuality: string | null;
  effectiveSize: string | null;
  lastImageRequestId: string | null;
  /** Total provider cost in USD (analysis + generation); null when any step's cost is unknown. */
  totalCostUsd: number | null;
}

const constraintLabels: Array<[keyof AstraAnalysis['architectural_constraints'], string]> = [
  ['building_perimeter', 'Building perimeter'],
  ['walls', 'Walls'],
  ['openings', 'Openings'],
  ['doors', 'Doors'],
  ['windows', 'Windows'],
  ['stairs', 'Stairs'],
  ['fixed_elements', 'Fixed elements'],
  ['rooms', 'Rooms'],
  ['circulation', 'Circulation'],
  ['elements_that_must_not_change', 'Must not change'],
];

const referenceLabels: Array<[keyof AstraAnalysis['style_reference'], string]> = [
  ['palette', 'Palette'],
  ['materials', 'Materials'],
  ['textures', 'Textures'],
  ['furniture_style', 'Furniture'],
  ['vegetation_style', 'Vegetation'],
  ['shadow_style', 'Shadows'],
  ['graphic_language', 'Graphic language'],
];

function flatten<K extends string>(source: Record<K, string[]>, labels: Array<[K, string]>, cap: number): string[] {
  const out: string[] = [];
  for (const [key, label] of labels) {
    for (const item of source[key]) {
      if (out.length >= cap) return out;
      out.push(`${label}: ${item}`);
    }
  }
  return out;
}

export function settingsSummary(r: GenerationRecord): string {
  const lines = [
    `Style: ${HUMANIZED_FLOORPLAN_SIMPLE_STYLE_LABELS[r.style as HumanizedFloorplanSimpleStyle] ?? r.style}`,
    `Lighting: ${HUMANIZED_FLOORPLAN_LIGHTING_PHRASES[r.lighting as HumanizedFloorplanLighting] ?? r.lighting}`,
    `Surroundings: ${r.surroundings}${r.surroundingsKind ? ` (${r.surroundingsKind}${r.customSurroundings ? `: ${sanitizeText(r.customSurroundings, 200)}` : ''})` : ''}`,
    `Text and dimensions: ${r.textMode}`,
    `Furniture level: ${r.furnitureLevel}`,
    `Output format: ${r.outputFormat}`,
  ];
  if (r.customInstructions) lines.push(`Additional user instructions: ${sanitizeText(r.customInstructions, 500)}`);
  return lines.join('\n');
}

function imageStep(step: PipelineStepName, started: number, res: GenerateHumanizedFloorplanImageResult, costUsd: number | null): PipelineStepRecord {
  const u = res.usage;
  return {
    step,
    model: OPENAI_BLOCK_IMAGE_MODEL,
    status: 'completed',
    startedAt: new Date(started).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    inputTokens: u && (u.textInputTokens !== null || u.imageInputTokens !== null) ? (u.textInputTokens ?? 0) + (u.imageInputTokens ?? 0) : null,
    cachedInputTokens: null,
    outputTokens: u?.imageOutputTokens ?? null,
    totalTokens: u?.totalTokens ?? null,
    reasoningEffort: null,
    requestId: res.requestId,
    costUsd,
    detail: { quality: res.effectiveQuality, size: res.effectiveSize },
    errorCode: null,
  };
}

function astraStep(step: PipelineStepName, started: number, meta: AstraCallMeta, costUsd: number | null, detail: Record<string, unknown> | null): PipelineStepRecord {
  return {
    step,
    model: meta.model,
    status: 'completed',
    startedAt: new Date(started).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: meta.durationMs,
    inputTokens: meta.usage?.inputTokens ?? null,
    cachedInputTokens: meta.usage?.cachedInputTokens ?? null,
    outputTokens: meta.usage?.outputTokens ?? null,
    totalTokens: meta.usage?.totalTokens ?? null,
    reasoningEffort: meta.reasoningEffort,
    requestId: meta.requestId,
    costUsd,
    detail,
    errorCode: null,
  };
}

function failedStep(step: PipelineStepName, model: string, started: number, err: unknown): PipelineStepRecord {
  return {
    step,
    model,
    status: 'failed',
    startedAt: new Date(started).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    totalTokens: null,
    reasoningEffort: null,
    requestId: null,
    costUsd: null,
    // Safe diagnostic only (status/code/type/request id) — never a key, header, prompt or image.
    detail: err instanceof AppError && err.details ? { providerError: err.details.slice(0, 300) } : null,
    errorCode: err instanceof AppError ? err.code : 'UNKNOWN_ERROR',
  };
}

export async function runAstraPipeline(input: AstraPipelineInput): Promise<AstraPipelineResult> {
  const { record, original, reference } = input;
  const deadline = Date.now() + ASTRA_PIPELINE_MAX_MS;
  const stepCosts: Array<number | null> = [];

  const guard = () => {
    if (Date.now() > deadline) throw new AppError('GENERATION_TIMEOUT', 'The generation took too long.', undefined, 504);
  };
  const runStep = async <T>(step: PipelineStepName, model: string, fn: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    try {
      return await fn();
    } catch (err) {
      await input.saveStep(failedStep(step, model, started, err)).catch(() => undefined);
      throw err;
    }
  };

  // 1) Analysis of the ORIGINAL plan (the only Astra call) ----------------------------------
  guard();
  await input.setStage('analyzing_architecture');
  const summary = settingsSummary(record);
  const analysisStarted = Date.now();
  let analysis: AstraAnalysis;
  try {
    const r = await runStep('analysis', OPENAI_ASTRA_MODEL, () => analyzeFloorplanWithAstra({ original, reference, settingsSummary: summary }));
    analysis = sanitizeAnalysis(r.analysis);
    const cost = estimateAstraCostUsd(r.meta.usage);
    stepCosts.push(cost);
    await input.saveStep(astraStep('analysis', analysisStarted, r.meta, cost, { constraintCount: flatten(analysis.architectural_constraints, constraintLabels, 999).length }));
    await input.patchRecord({ analysisModel: r.meta.model, analysisStatus: 'completed' });
  } catch (err) {
    await input.patchRecord({ analysisModel: OPENAI_ASTRA_MODEL, analysisStatus: 'failed' }).catch(() => undefined);
    throw err;
  }

  // 2) Prompt from the structured analysis ------------------------------------------------
  await input.setStage('preparing');
  const constraints = flatten(analysis.architectural_constraints, constraintLabels, ASTRA_MAX_LIST_ITEMS);
  for (const f of analysis.generation_guidance.forbidden_changes.slice(0, 10)) constraints.push(`Forbidden: ${f}`);
  const referenceStyleNotes = reference ? flatten(analysis.style_reference, referenceLabels, ASTRA_MAX_LIST_ITEMS) : [];
  // Same geometry-preserving canvas as the standard mode: nearest supported size + neutral margins only when needed (never stretch, squeeze or crop).
  const canvas = await prepareFloorplanCanvas(original.buffer, original.mime, record.outputFormat as HumanizedFloorplanOutputFormat);
  const prompt = buildHumanizedFloorplanPrompt({
    style: record.style as HumanizedFloorplanSimpleStyle,
    lighting: record.lighting as HumanizedFloorplanLighting,
    surroundings: record.surroundings as HumanizedFloorplanPromptOptions['surroundings'],
    surroundingsKind: record.surroundingsKind as HumanizedFloorplanPromptOptions['surroundingsKind'],
    customSurroundings: record.customSurroundings,
    textMode: record.textMode as HumanizedFloorplanPromptOptions['textMode'],
    furnitureLevel: record.furnitureLevel as HumanizedFloorplanPromptOptions['furnitureLevel'],
    outputFormat: record.outputFormat as HumanizedFloorplanOutputFormat,
    hasStyleReference: Boolean(reference),
    customInstructions: record.customInstructions,
    canvasPadded: canvas.padded,
    astra: { constraints, referenceStyleNotes, recommendedGuidance: analysis.generation_guidance.recommended_prompt },
  });

  // 3) ONE generation. No validation, no second attempt. -------------------------------------
  guard();
  await input.setStage('generating');
  const genStarted = Date.now();
  const gen = await runStep('generation_1', OPENAI_BLOCK_IMAGE_MODEL, () =>
    generateHumanizedFloorplanImage({
      originalImageBuffer: canvas.buffer,
      originalImageMimeType: canvas.mime as Mime,
      styleReferenceBuffer: reference?.buffer ?? null,
      styleReferenceMimeType: reference?.mime,
      prompt,
      size: canvas.size,
      quality: 'high',
    })
  );
  // Only technical readability is checked: a response that is not a readable image is a technical failure (the route refunds).
  const check = validateGeneratedFloorplanPng(gen.pngBuffer);
  if (!check.valid) throw new AppError('GENERATION_FAILED', 'The generated image was invalid or unreadable.', undefined, 502);
  const genCost = estimateOpenAiImageCostUsd(gen.usage);
  stepCosts.push(genCost);
  await input.saveStep(imageStep('generation_1', genStarted, gen, genCost));

  return {
    finalPng: gen.pngBuffer,
    imageUsage: gen.usage,
    effectiveQuality: gen.effectiveQuality,
    effectiveSize: gen.effectiveSize,
    lastImageRequestId: gen.requestId,
    totalCostUsd: sumCosts(stepCosts),
  };
}
