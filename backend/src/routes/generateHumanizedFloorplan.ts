import { Router, Request, Response } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { AppError } from '../lib/errors';
import { detectImageMimeType } from '../lib/fileSignature';
import { buildHumanizedFloorplanFillPrompt } from '../lib/humanizedFloorplanPromptBuilder';
import { buildFloorplanMask } from '../lib/floorplanMask/buildMask';
import { decodeMaskToProtectedMat } from '../lib/floorplanMask/maskIO';
import { decodeToMat, encodeMatToPng } from '../lib/floorplanMask/imageIO';
import { getOpenCv, OpenCv } from '../lib/floorplanMask/opencvRuntime';
import {
  decideFinalAcceptance,
  FinalAcceptanceResult,
  forceOriginalDimensions,
  RejectionKind,
  SuspiciousTextBox,
  TextVerificationOutcome,
  validateAndFinalizeResult,
} from '../lib/floorplanMask/floorplanValidation';
import { attemptTextCorrectionAndRevalidate } from '../lib/floorplanMask/textCorrection';
import { detectDrawnAreaBoundingBox, extractUsefulAreaCrop, recomposeOntoOriginalCanvas } from '../lib/floorplanMask/usefulAreaCrop';
import { detectFloorplanFurnitureOpenAI } from '../lib/floorplanFurniture/detectFloorplanFurnitureOpenAI';
import { FinalOpenAIObject, FinalOpenAIRoom } from '../lib/floorplanFurniture/openaiTypes';
import { generateFill } from '../providers/bflFill';
import { verifySuspiciousText } from '../providers/openaiTextVerification';
import { savePrivateRejectionDiagnostics, startPrivateDiagnosticsCleanup } from '../storage/privateDiagnosticsStore';
import { saveRawFillResult, startRawFillResultCleanup } from '../storage/rawFillResultStore';
import { saveTextCorrectionDiagnostics, startTextCorrectionDiagnosticsCleanup } from '../storage/textCorrectionDiagnosticsStore';
import { saveResultImage } from '../storage/resultStore';
import { serverLogger } from '../lib/logger';
import {
  HUMANIZED_FLOORPLAN_DEFAULT_GUIDANCE,
  HUMANIZED_FLOORPLAN_DEFAULT_STEPS,
  HUMANIZED_FLOORPLAN_DEVIATION_TOLERANCE,
  HUMANIZED_FLOORPLAN_PROVIDER_COST_USD,
  HUMANIZED_FLOORPLAN_PROVIDER_CREDITS,
  HUMANIZED_FLOORPLAN_TEXT_RESTORATION_MARGIN_PX,
  HUMANIZED_FLOORPLAN_TEXT_UNIFORMITY_STDDEV,
  HUMANIZED_FLOORPLAN_USEFUL_AREA_MARGIN_PX,
  HUMANIZED_FLOORPLAN_WALLET_DEBIT_CREDITS,
} from '../config/humanizedFloorplanEngine';
import { ACTIVE_VISION_PROVIDER, OPENAI_TEXT_VERIFICATION_MIN_CONFIDENCE, VisionProvider } from '../config/openaiModels';
import { ActiveReservation, captureCredits, refundCredits, reserveCredits } from '../services/creditWallet';
import { requireAuth, AuthenticatedRequest } from '../middleware/requireAuth';
import { recordGeneration } from '../services/generationLog';
import { logJobCreation } from '../services/jobCreationLog';
import {
  HumanizedFloorplanConfigResponse,
  HumanizedFloorplanCreateJobResponse,
  HumanizedFloorplanJobStage,
  HumanizedFloorplanJobStatusResponse,
} from '../types/humanizedFloorplan';

type Mat = InstanceType<OpenCv['Mat']>;

/**
 * Planta Humanizada's PRIMARY pipeline: OpenCV structural mask + OpenAI
 * semantic room/furniture recognition + FLUX.1 Fill masked inpainting.
 * Entirely isolated from every other tool's routes (Render/Redesign/Vídeo/
 * Upscale all keep using routes/generate.ts + providers/bfl.ts, completely
 * untouched by this file) and from routes/plantaHumanizada.ts, which still
 * exists unchanged as a fallback pipeline.
 *
 * VISION_PROVIDER=openai is the ONLY supported provider for this route —
 * see assertOpenAiVisionProviderActive below. Gemini's pipeline
 * (lib/floorplanFurniture/detectFloorplanFurniture.ts, providers/geminiVision.ts)
 * is never imported here and this route refuses to run at all if
 * VISION_PROVIDER is set to anything else, rather than silently falling
 * back to it.
 */

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const JOB_TTL_MS = 30 * 60 * 1000;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE } });
const uploadFields = upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'maskOverride', maxCount: 1 },
]);
const uploadSingleImage = upload.single('image');

interface Job {
  id: string;
  stage: HumanizedFloorplanJobStage;
  providerStatus?: string;
  startedAt: number;
  result?: HumanizedFloorplanJobStatusResponse['result'];
  error?: HumanizedFloorplanJobStatusResponse['error'];
}

const jobs = new Map<string, Job>();

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.startedAt > JOB_TTL_MS) jobs.delete(id);
  }
}, 5 * 60 * 1000).unref();

startPrivateDiagnosticsCleanup();
startRawFillResultCleanup();
startTextCorrectionDiagnosticsCleanup();

export const generateHumanizedFloorplanRouter = Router();

/**
 * VISION_PROVIDER must resolve to "openai" for this route — Gemini is never
 * used for a real (paid) generation, only reachable from the offline
 * inspection scripts. Takes the provider as a parameter (defaulting to the
 * real configured one) specifically so both branches are directly
 * unit-testable without mutating process.env or a network call.
 */
export function assertOpenAiVisionProviderActive(provider: VisionProvider = ACTIVE_VISION_PROVIDER): void {
  if (provider !== 'openai') {
    throw new AppError(
      'VALIDATION_ERROR',
      'This generation pipeline requires VISION_PROVIDER=openai. Gemini is not supported for generation.',
      `ACTIVE_VISION_PROVIDER=${provider}`,
      500
    );
  }
}

/**
 * Turns the OpenAI vision step's own detected rooms/objects into a short,
 * descriptive (never geometrically authoritative) paragraph appended to the
 * Fill prompt — purely guidance text, the mask alone still decides which
 * pixels Fill can touch. Pure/synchronous so it's directly unit-testable.
 */
export function buildSemanticContext(rooms: FinalOpenAIRoom[], objects: FinalOpenAIObject[]): string {
  const parts: string[] = [];

  const roomLabels = Array.from(new Set(rooms.map((r) => r.label || r.type).filter((label): label is string => Boolean(label))));
  if (roomLabels.length > 0) {
    parts.push(`Rooms detected: ${roomLabels.slice(0, 20).join(', ')}.`);
  }

  const replaceableCategories = objects.filter((o) => o.replaceable).map((o) => o.category);
  if (replaceableCategories.length > 0) {
    const counts = new Map<string, number>();
    for (const category of replaceableCategories) counts.set(category, (counts.get(category) ?? 0) + 1);
    const summary = Array.from(counts.entries())
      .map(([category, count]) => `${count}x ${category}`)
      .join(', ');
    parts.push(`Existing furniture/fixtures already drawn — humanize them in place, keeping their position and orientation: ${summary}.`);
  }

  return parts.join(' ');
}

function buildTextVerificationCandidateHint(boxCount: number): string {
  return `an automated heuristic flagged ${boxCount} candidate text-like region(s) (it is known to also flag furniture/rug/texture edges as false positives — verify independently)`;
}

function buildRejectionMessage(kind: RejectionKind | undefined, deviation: number, verification: TextVerificationOutcome | null): string {
  if (kind === 'text_correction_unsafe' && verification) {
    return `A verificação visual confirmou ${verification.quantidade} elemento(s) de texto novo/corrompido (confiança ${Math.round(verification.confianca * 100)}%), e a correção local automática não pôde ser aplicada com segurança (região sobre piso/textura/móvel/vegetação, ou risco de mancha visível). Geração rejeitada, sem cobrança.`;
  }
  if (kind === 'confirmed_new_text' && verification) {
    return `A verificação visual confirmou ${verification.quantidade} elemento(s) de texto novo/corrompido (confiança ${Math.round(verification.confianca * 100)}%): ${verification.justificativa}`;
  }
  if (kind === 'text_verification_missing') {
    return 'Não foi possível confirmar a verificação visual de texto suspeito. A geração foi rejeitada por segurança, sem cobrança.';
  }
  return 'The generated result altered the protected areas of the floor plan more than the allowed tolerance and was rejected.';
}

/** Draws the heuristic's candidate boxes (yellow) and, when available, the second OpenAI verification's confirmed boxes (red) onto a copy of the result — saved privately for later manual review, never sent to the frontend. */
async function buildMarkedDiagnosticImage(correctedRgba: Mat, candidateBoxes: SuspiciousTextBox[], verification: TextVerificationOutcome | null): Promise<Buffer> {
  const cv = await getOpenCv();
  const marked = new cv.Mat();
  correctedRgba.copyTo(marked);

  for (const box of candidateBoxes) {
    cv.rectangle(marked, new cv.Point(box.x, box.y), new cv.Point(box.x + box.width, box.y + box.height), new cv.Scalar(230, 190, 0, 255), 1);
  }
  if (verification) {
    for (const box of verification.boundingBoxes) {
      cv.rectangle(
        marked,
        new cv.Point(Math.round(box.xMin), Math.round(box.yMin)),
        new cv.Point(Math.round(box.xMax), Math.round(box.yMax)),
        new cv.Scalar(230, 20, 20, 255),
        2
      );
    }
  }

  const png = await encodeMatToPng(marked);
  marked.delete();
  return png;
}

function validateImage(file: Express.Multer.File | undefined, label: string, required: boolean): string | null {
  if (!file) {
    if (required) throw new AppError('IMAGE_UPLOAD_FAILED', `No ${label} file was received.`, undefined, 400);
    return null;
  }
  const detected = detectImageMimeType(file.buffer);
  if (!detected) {
    throw new AppError('IMAGE_UPLOAD_FAILED', `Unsupported ${label} format. Please upload a JPG, PNG or WEBP file.`, `Declared mimetype: ${file.mimetype}`, 400);
  }
  return detected;
}

function handleSyncError(res: Response, err: unknown): void {
  if (err instanceof AppError) {
    res.status(err.httpStatus).json({ error: err.toPayload() });
    return;
  }
  serverLogger.error('Unexpected error handling humanized floorplan request', err);
  res.status(500).json({ error: { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred.' } });
}

/** Single shared source of truth for the cost shown anywhere in the frontend — see config/humanizedFloorplanEngine.ts. Requirement: "usando uma única configuração compartilhada" — the frontend fetches this instead of hardcoding the number. */
generateHumanizedFloorplanRouter.get('/generate-humanized-floorplan/config', (_req: Request, res: Response) => {
  const payload: HumanizedFloorplanConfigResponse = { costCredits: HUMANIZED_FLOORPLAN_WALLET_DEBIT_CREDITS };
  res.json(payload);
});

/**
 * FREE preview endpoint — runs only the local OpenCV detection (no BFL
 * call, no OpenAI call, no credits charged), so the frontend can show the
 * auto mask before the user commits to spending anything, per requirement #7.
 */
generateHumanizedFloorplanRouter.post('/generate-humanized-floorplan/mask', uploadSingleImage, async (req: Request, res: Response) => {
  try {
    validateImage(req.file, 'floor plan image', true);
    const result = await buildFloorplanMask(req.file!.buffer);
    const maskDataUrl = `data:image/png;base64,${result.maskPng.toString('base64')}`;
    res.json({ maskDataUrl, originalWidth: result.originalWidth, originalHeight: result.originalHeight });
    result.protectedMask.delete();
    result.wallsMaskOriginalRes.delete();
    result.textProtectionMaskOriginalRes.delete();
  } catch (err) {
    handleSyncError(res, err);
  }
});

generateHumanizedFloorplanRouter.post('/generate-humanized-floorplan', requireAuth, uploadFields, async (req: Request, res: Response) => {
  let reservation: ActiveReservation | null = null;
  try {
    assertOpenAiVisionProviderActive();

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const imageFile = files?.image?.[0];
    const maskFile = files?.maskOverride?.[0];

    validateImage(imageFile, 'floor plan image', true);
    if (maskFile) validateImage(maskFile, 'mask', false);


    const steps = req.body.steps ? Number(req.body.steps) : HUMANIZED_FLOORPLAN_DEFAULT_STEPS;
    const guidance = req.body.guidance ? Number(req.body.guidance) : HUMANIZED_FLOORPLAN_DEFAULT_GUIDANCE;
    const prompt = typeof req.body.prompt === 'string' ? req.body.prompt : undefined;

    const jobId = crypto.randomUUID();
    reservation = await reserveCredits({ userId: (req as AuthenticatedRequest).user!.id, amount: HUMANIZED_FLOORPLAN_WALLET_DEBIT_CREDITS, tool: 'planta_humanizada_advanced', generationId: jobId });
    const job: Job = { id: jobId, stage: 'uploading', startedAt: Date.now() };
    jobs.set(jobId, job);

    // Persistent (survives a restart) creation record — added 2026-09-19
    // after an untraceable real generation ran on this exact route with no
    // way to determine its origin afterward. Never includes the image,
    // mask, or any secret — see services/jobCreationLog.ts.
    logJobCreation({ route: '/generate-humanized-floorplan', jobId, idempotencyKey: null, reusedExistingJob: false, ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null });

    const response: HumanizedFloorplanCreateJobResponse = { jobId, startedAt: job.startedAt };
    res.status(202).json(response);

    void runJob(job, reservation, {
      imageBuffer: imageFile!.buffer,
      maskOverrideBuffer: maskFile?.buffer,
      prompt,
      steps,
      guidance,
    });
  } catch (err) {
    if (reservation) await refundCredits(reservation, 'request_failed');
    handleSyncError(res, err);
  }
});

/**
 * Read-only — only ever reads from `jobs`. Never calls runJob, never
 * touches the wallet, never makes a provider call. Polling this endpoint
 * as many times as the frontend wants can never repeat a generation or a
 * charge (requirement #9).
 */
generateHumanizedFloorplanRouter.get('/generate-humanized-floorplan/:jobId', (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: { code: 'UNKNOWN_ERROR', message: 'Job not found. It may have expired.' } });
    return;
  }
  // Never includes an internal file path, API key, or anything sensitive —
  // job.error is always built from AppError.toPayload() (code/message/details,
  // all already sanitized at the point each AppError was thrown) or the
  // generic UNKNOWN_ERROR fallback below.
  const payload: HumanizedFloorplanJobStatusResponse = {
    jobId: job.id,
    stage: job.stage,
    providerStatus: job.providerStatus,
    startedAt: job.startedAt,
    result: job.result,
    error: job.error,
  };
  res.json(payload);
});

interface JobInput {
  imageBuffer: Buffer;
  maskOverrideBuffer?: Buffer;
  prompt?: string;
  steps: number;
  guidance: number;
}

async function runJob(
  job: Job,
  reservation: ActiveReservation, input: JobInput): Promise<void> {
  const startedAt = job.startedAt;
  let deviation = 0;
  try {
    job.stage = 'analyzing_structure';
    const cv = await getOpenCv();

    // Structure detection always runs (cheap, local, free) — it's needed for
    // the walls-only mask used by the pixel-exact line correction later,
    // regardless of whether the user's own manually-edited mask (rather
    // than the auto one) is what actually gets sent to Fill.
    const auto = await buildFloorplanMask(input.imageBuffer);

    const protectedMask = input.maskOverrideBuffer
      ? await decodeMaskToProtectedMat(input.maskOverrideBuffer, auto.originalWidth, auto.originalHeight)
      : auto.protectedMask;

    const fillMask = new cv.Mat();
    cv.bitwise_not(protectedMask, fillMask);

    const { mat: originalRgba } = await decodeToMat(input.imageBuffer);
    const outputFormat = detectImageMimeType(input.imageBuffer) === 'image/png' ? 'png' : 'jpeg';

    // --- Scope FLUX to the actually-drawn area (requirement: "O FLUX não
    // deve editar as grandes áreas brancas externas à planta") — everything
    // outside this rect is never even sent to FLUX, so it is structurally
    // impossible for it to end up in the result: the final image is
    // recomposed from an untouched copy of the original outside this
    // region. See lib/floorplanMask/usefulAreaCrop.ts. ---
    const usefulAreaRect = await detectDrawnAreaBoundingBox(originalRgba, HUMANIZED_FLOORPLAN_USEFUL_AREA_MARGIN_PX);
    const usefulAreaCrop = await extractUsefulAreaCrop(originalRgba, fillMask, usefulAreaRect);
    fillMask.delete();
    serverLogger.log('FLUX useful-area crop computed', {
      jobId: job.id,
      usefulAreaRect,
      marginPx: HUMANIZED_FLOORPLAN_USEFUL_AREA_MARGIN_PX,
      originalWidth: auto.originalWidth,
      originalHeight: auto.originalHeight,
    });

    // --- OpenAI semantic recognition (overview + tiles), combined with the
    // OpenCV structural mask internally (combineOpenAIWithStructure) BEFORE
    // anything is sent to FLUX — a failure here (network/schema/rate-limit)
    // throws straight into the catch block below: no debit, no fallback to
    // Gemini, no silent continuation without it.
    job.stage = 'recognizing_furniture';
    const furnitureResult = await detectFloorplanFurnitureOpenAI(input.imageBuffer, {
      diagnosticsId: job.id,
      onOverviewSuccess: () => {
        job.stage = 'refining_objects';
      },
    });
    const semanticContext = buildSemanticContext(furnitureResult.report.rooms, furnitureResult.report.objects);
    const openAiRoomsDetected = furnitureResult.report.rooms.length;
    const openAiObjectsDetected = furnitureResult.report.objects.length;
    serverLogger.log('OpenAI furniture detection summary', {
      jobId: job.id,
      callCount: furnitureResult.report.callCount,
      crops: furnitureResult.report.crops.length,
      tilesRan: furnitureResult.report.tilesRan,
      callOutcomes: furnitureResult.report.callOutcomes,
      usageTotals: furnitureResult.report.usageTotals,
      visionMetrics: furnitureResult.report.visionMetrics,
      totalTimeMs: furnitureResult.report.totalTimeMs,
      rooms: openAiRoomsDetected,
      objects: openAiObjectsDetected,
    });
    furnitureResult.artifacts.originalRgba.delete();
    furnitureResult.artifacts.usefulAreaRgba.delete();
    furnitureResult.artifacts.structuralProtectedMask.delete();
    furnitureResult.artifacts.rawFurnitureMask.delete();
    furnitureResult.artifacts.structureSubtractedMask.delete();

    const prompt = buildHumanizedFloorplanFillPrompt(input.prompt, semanticContext);

    job.stage = 'humanizing';
    const fillResult = await generateFill({
      prompt,
      // Only the useful-area crop (+ configured margin) is ever sent to
      // FLUX — never the full original image. Always PNG (extractUsefulAreaCrop
      // always encodes via encodeMatToPng), independent of the upload's own format.
      imageBase64: usefulAreaCrop.imageCropPng.toString('base64'),
      maskBase64: usefulAreaCrop.maskCropPng.toString('base64'),
      steps: input.steps,
      guidance: input.guidance,
      outputFormat: 'png',
      onProviderStatus: (status) => {
        job.providerStatus = status;
      },
    });

    // Saved unconditionally (accept AND reject) — the ONE pipeline artifact
    // otherwise never persisted anywhere: FLUX's raw output for the CROP,
    // exactly as returned, before resizing/recomposition ever touch it.
    // Never under public/, never exposed via the API response — see
    // storage/rawFillResultStore.ts.
    saveRawFillResult(job.id, fillResult.imageBuffer, 'png');

    const { mat: rawCropResultRgba } = await decodeToMat(fillResult.imageBuffer);
    // BFL can return a canvas that doesn't precisely match the crop request
    // in edge cases (rounding, provider-side padding) — force it back to the
    // EXACT crop dimensions before pasting, same defensive step the old
    // whole-image path already relied on (forceOriginalDimensions).
    const resizedCropResult = await forceOriginalDimensions(rawCropResultRgba, usefulAreaRect.width, usefulAreaRect.height);
    rawCropResultRgba.delete();

    // Recompose onto a full copy of the ORIGINAL image — outside
    // usefulAreaRect, `recomposedRgba` is byte-identical to `originalRgba`:
    // FLUX never saw that region, so there is nothing it could have altered
    // there. Dimensions always match the original exactly.
    const recomposedRgba = await recomposeOntoOriginalCanvas(originalRgba, resizedCropResult, usefulAreaRect);
    resizedCropResult.delete();

    job.stage = 'validating';
    const validation = await validateAndFinalizeResult(
      originalRgba,
      recomposedRgba,
      protectedMask,
      auto.wallsMaskOriginalRes,
      auto.textRegions,
      auto.originalWidth,
      auto.originalHeight
    );
    deviation = validation.deviation;

    // The heuristic (validation.suspiciousText) is ADVISORY ONLY — it is
    // proven to also flag furniture/rug/texture edges as false positives
    // and must never by itself reject a result (requirement #10). When it
    // flags candidates, a second, independent OpenAI call compares the
    // original and generated images and is the ONLY thing allowed to turn
    // that into a rejection (requirement #12-14). If THIS call fails
    // technically, the error propagates to the catch block below — no
    // charge, no silent delivery (requirement #15).
    let textVerification: TextVerificationOutcome | null = null;
    const correctedPngBuffer = await encodeMatToPng(validation.correctedRgba);
    if (validation.suspiciousText.suspicious) {
      const verifyResult = await verifySuspiciousText({
        originalImageBase64: input.imageBuffer.toString('base64'),
        originalMimeType: outputFormat === 'png' ? 'image/png' : 'image/jpeg',
        resultImageBase64: correctedPngBuffer.toString('base64'),
        resultMimeType: 'image/png',
        resultWidth: auto.originalWidth,
        resultHeight: auto.originalHeight,
        candidateHint: buildTextVerificationCandidateHint(validation.suspiciousText.newTextBlobCount),
        diagnosticsId: job.id,
      });
      textVerification = verifyResult.result;
    }

    let decision: FinalAcceptanceResult = decideFinalAcceptance({
      deviationAccepted: validation.deviationAccepted,
      suspiciousText: validation.suspiciousText,
      textVerification,
      minConfidence: OPENAI_TEXT_VERIFICATION_MIN_CONFIDENCE,
    });

    // --- Local, offline-only text correction (requirement: "após
    // verifySuspiciousText... restaure somente a caixa confirmada"). Only
    // ever runs when the SECOND, OpenAI-based verification itself confirmed
    // real new/corrupted text — never for a raw, unconfirmed heuristic
    // candidate, and never triggers another FLUX or OpenAI call. Only
    // touches the exact confirmed boxes (+ a small configurable margin),
    // and only when the ORIGINAL content there was blank/uniform; a
    // confirmed box over floor/texture/furniture/vegetation, or a visible
    // seam after the attempted patch, keeps the rejection. ---
    let finalCorrectedRgba = validation.correctedRgba;
    let finalCorrectedPngBuffer = correctedPngBuffer;
    if (!decision.accepted && decision.rejectionKind === 'confirmed_new_text' && textVerification) {
      const confirmedBoxes = textVerification.boundingBoxes;
      const correction = await attemptTextCorrectionAndRevalidate(
        originalRgba,
        validation.correctedRgba,
        protectedMask,
        confirmedBoxes,
        HUMANIZED_FLOORPLAN_TEXT_RESTORATION_MARGIN_PX,
        HUMANIZED_FLOORPLAN_TEXT_UNIFORMITY_STDDEV
      );

      const afterRestorationPng = await encodeMatToPng(correction.correctedRgba);
      const expandedTextMaskPng = await encodeMatToPng(auto.textProtectionMaskOriginalRes);
      saveTextCorrectionDiagnostics(
        job.id,
        {
          originalTextRegions: auto.textRegions,
          confirmedNewTextBoxes: confirmedBoxes,
          perBoxDecisions: correction.decisions,
          allSafelyCorrected: correction.allSafelyCorrected,
          residualSuspicious: correction.residualSuspiciousText.suspicious,
          residualNewTextBlobCount: correction.residualSuspiciousText.newTextBlobCount,
          residualBoxesWithinConfirmedRegionsCount: correction.residualBoxesWithinConfirmedRegions.length,
          residualBoxesExternalCount: correction.residualBoxesExternal.length,
        },
        { expandedTextMaskPng, beforeRestorationPng: correctedPngBuffer, afterRestorationPng }
      );

      // 2026-09-19 fix: `allSafelyCorrected` alone is the correct gate — it
      // already only looks at residual candidates OVERLAPPING a region this
      // pass actually corrected (see textCorrection.ts). It deliberately
      // does NOT also require the GLOBAL `residualSuspiciousText.suspicious`
      // to be false: that flag reflects EVERY candidate anywhere in the
      // image, including ones OpenAI's own verification already implicitly
      // dismissed by never confirming them (e.g. the real run where the
      // heuristic found 18 candidates but only 4 were confirmed — the other
      // 14 sit entirely outside every corrected region, were never touched,
      // and must not re-reject a result whose actual problem was fixed).
      const correctionSucceeded = correction.allSafelyCorrected;
      if (correctionSucceeded) {
        // Never auto-accept just because a restoration happened — route it
        // back through the same decision function. The text concern is now
        // fully resolved (confirmed boxes fixed and verified locally clean;
        // any other candidate was pre-existing and outside every corrected
        // region, so it is deliberately NOT passed through here — see the
        // comment above), so this call only needs to (re-)check geometry
        // deviation, which is unchanged since the correction only ever
        // touches previously-editable pixels.
        const secondDecision = decideFinalAcceptance({
          deviationAccepted: validation.deviationAccepted,
          suspiciousText: { suspicious: false, newTextBlobCount: 0, boxes: [] },
          textVerification: null,
          minConfidence: OPENAI_TEXT_VERIFICATION_MIN_CONFIDENCE,
        });
        if (secondDecision.accepted) {
          validation.correctedRgba.delete();
          finalCorrectedRgba = correction.correctedRgba;
          finalCorrectedPngBuffer = afterRestorationPng;
        } else {
          correction.correctedRgba.delete();
        }
        decision = secondDecision;
      } else {
        correction.correctedRgba.delete();
        decision = { accepted: false, rejectionKind: 'text_correction_unsafe' };
      }
    }

    // Validation runs BEFORE the job is ever marked complete and BEFORE
    // debit() is called — a rejection here always throws, which skips
    // straight to the catch block below without ever reaching debit(). No
    // charge, no automatic retry: the job simply ends in 'error' and the
    // caller must start a brand-new request (with an adjusted mask, if
    // that's the cause) to try again.
    if (!decision.accepted) {
      const maskPngForDiagnostics = await encodeMatToPng(protectedMask);
      const markedPng = await buildMarkedDiagnosticImage(finalCorrectedRgba, validation.suspiciousText.boxes, textVerification);
      savePrivateRejectionDiagnostics(job.id, {
        resultPng: finalCorrectedPngBuffer,
        maskPng: maskPngForDiagnostics,
        markedPng,
        reportJson: {
          jobId: job.id,
          timestamp: Date.now(),
          rejectionKind: decision.rejectionKind,
          protectedRegionDeviation: deviation,
          deviationTolerance: HUMANIZED_FLOORPLAN_DEVIATION_TOLERANCE,
          suspiciousTextCandidateCount: validation.suspiciousText.newTextBlobCount,
          textVerification,
        },
      });
      finalCorrectedRgba.delete();
      originalRgba.delete();
      recomposedRgba.delete();
      auto.protectedMask.delete();
      auto.wallsMaskOriginalRes.delete();
      auto.textProtectionMaskOriginalRes.delete();
      if (input.maskOverrideBuffer) protectedMask.delete();
      const reason = buildRejectionMessage(decision.rejectionKind, deviation, textVerification);
      throw new AppError(
        'GENERATION_FAILED',
        reason,
        `rejectionKind=${decision.rejectionKind}, protectedRegionDeviation=${deviation.toFixed(4)}, suspiciousTextBlobs=${validation.suspiciousText.newTextBlobCount}`,
        502
      );
    }

    const imageUrl = saveResultImage(fillResult.requestId, finalCorrectedPngBuffer, 'image/png');

    // Debited exactly once, here, only on the accepted path — this is the
    // single debit() call anywhere in this job's lifecycle (runJob runs
    // once per POST request; polling via GET /:jobId only ever reads
    // `jobs`, it never re-invokes runJob), so double-billing across polls
    // is structurally impossible.
    await captureCredits(reservation);

    job.result = {
      requestId: fillResult.requestId,
      provider: 'bfl-fill',
      model: 'flux-pro-1.0-fill',
      imageUrl,
      prompt,
      generationTimeMs: Date.now() - startedAt,
      resolution: { width: auto.originalWidth, height: auto.originalHeight },
      status: 'Ready',
      providerCostUsd: HUMANIZED_FLOORPLAN_PROVIDER_COST_USD,
      providerCredits: HUMANIZED_FLOORPLAN_PROVIDER_CREDITS,
      walletDebitCredits: HUMANIZED_FLOORPLAN_WALLET_DEBIT_CREDITS,
      protectedRegionDeviation: deviation,
      openAiRoomsDetected,
      openAiObjectsDetected,
    };
    job.stage = 'complete';

    recordGeneration({
      generationId: job.id,
      timestamp: startedAt,
      engine: 'bfl-fill',
      provider: 'bfl-fill',
      model: 'flux-pro-1.0-fill',
      creditsCharged: HUMANIZED_FLOORPLAN_WALLET_DEBIT_CREDITS,
      status: 'complete',
      resolution: { width: auto.originalWidth, height: auto.originalHeight },
      hasReferenceRender: false,
    });

    originalRgba.delete();
    recomposedRgba.delete();
    finalCorrectedRgba.delete();
    auto.protectedMask.delete();
    auto.wallsMaskOriginalRes.delete();
    auto.textProtectionMaskOriginalRes.delete();
    if (input.maskOverrideBuffer) protectedMask.delete();
  } catch (err) {
    job.stage = 'error';
    await refundCredits(reservation, 'generation_failed');
    if (err instanceof AppError) {
      job.error = err.toPayload();
    } else {
      serverLogger.error(`Humanized floorplan job ${job.id} failed unexpectedly`, err);
      job.error = {
        code: 'UNKNOWN_ERROR',
        message: 'An unexpected error occurred during generation.',
        details: err instanceof Error ? err.message : String(err),
      };
    }

    recordGeneration({
      generationId: job.id,
      timestamp: startedAt,
      engine: 'bfl-fill',
      provider: 'bfl-fill',
      model: 'flux-pro-1.0-fill',
      creditsCharged: 0,
      status: 'error',
      resolution: null,
      hasReferenceRender: false,
    });
  }
}
