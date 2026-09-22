import dns from 'node:dns';
import dotenv from 'dotenv';
import path from 'node:path';

// On this host, outbound IPv6 to api.bfl.ai (and possibly other hosts) times out
// instead of failing fast, and Node's fetch doesn't reliably fall back to IPv4
// within a usable time budget. Forcing IPv4-first resolution avoids the hang.
dns.setDefaultResultOrder('ipv4first');

// Resolve backend/.env by file location, not process.cwd() — this way it loads
// correctly no matter how the process is launched (npm workspace script, IDE
// run config, `node dist/index.js` from another directory, etc). __dirname is
// backend/src in dev (tsx) and backend/dist after a build; either way ".." is backend/.
const ENV_PATH = path.resolve(__dirname, '..', '.env');
const dotenvResult = dotenv.config({ path: ENV_PATH });

import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import { serverLogger } from './lib/logger';
import { generateRouter } from './routes/generate';
import { enginesRouter } from './routes/engines';
import { walletRouter } from './routes/wallet';
import { textToImageRouter } from './routes/textToImage';
import { ideaGeneratorRouter } from './routes/ideaGenerator';
import { plantaHumanizadaRouter } from './routes/plantaHumanizada';
import { generateHumanizedFloorplanRouter } from './routes/generateHumanizedFloorplan';
import { generateHumanizedFloorplanSimpleRouter } from './routes/generateHumanizedFloorplanSimple';
import { videoGeneratorRouter } from './routes/videoGenerator';
import { videoEditorRouter } from './routes/videoEditor';
import { architectChatRouter } from './routes/architectChat';
import { billingRouter } from './routes/billing';
import { billingWebhookRouter } from './routes/billingWebhook';
import { upscaleRouter } from './routes/upscale';
import { assertInfrastructureConfig, isProduction } from './config/runtimeEnvironment';
import { getWalletBackend } from './services/creditWallet';
import { startWalletReconciler } from './services/walletReconciler';
import { getGenerationStore } from './services/humanizedFloorplanStore';
import { getFileStorage } from './storage/humanizedFloorplanFiles';
import { getUpscaleStore } from './services/upscaleStore';
import { getUpscaleFileStorage } from './storage/upscaleFiles';
import { reconcileStaleGenerations } from './services/humanizedFloorplanReconciler';

serverLogger.log(`Loading environment from ${ENV_PATH}`);
if (dotenvResult.error) {
  serverLogger.error(`Could not read .env file: ${dotenvResult.error.message}`);
}

const app = express();
const PORT = Number(process.env.PORT) || 8787;

app.use(cors());
// Scoped to this one path and mounted BEFORE express.json(): Stripe's webhook
// signature check needs the exact raw request body bytes. Every other /api/*
// route below still gets the normal parsed JSON body.
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use('/api', billingWebhookRouter);
app.use(express.json({ limit: '2mb' }));
app.use('/results', express.static(path.join(__dirname, '..', 'public', 'results')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'public', 'uploads')));

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    bflConfigured: Boolean(process.env.BFL_API_KEY),
    xaiConfigured: Boolean(process.env.XAI_API_KEY),
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
    supabaseAdminConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    topazConfigured: Boolean(process.env.TOPAZ_API_KEY),
  });
});

app.use('/api', generateRouter);
app.use('/api', enginesRouter);
app.use('/api', walletRouter);
app.use('/api', textToImageRouter);
app.use('/api', ideaGeneratorRouter);
app.use('/api', plantaHumanizadaRouter);
app.use('/api', generateHumanizedFloorplanRouter);
app.use('/api', generateHumanizedFloorplanSimpleRouter);
app.use('/api', videoGeneratorRouter);
app.use('/api', videoEditorRouter);
app.use('/api', architectChatRouter);
app.use('/api', billingRouter);
app.use('/api', upscaleRouter);

// Converts multer failures (bad file type/size) into the same JSON error shape as the rest of the API.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    res.status(400).json({
      error: { code: 'IMAGE_UPLOAD_FAILED', message: 'Image upload failed.', details: err.message },
    });
    return;
  }
  serverLogger.error('Unhandled error', err);
  res.status(500).json({ error: { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred.' } });
});

/**
 * Resolves the infrastructure that holds user data and money: the credit
 * wallet, the generation history and the private file bucket. In production a
 * failure here stops the server before it accepts a single request; in
 * development it is reported loudly (requests then get a clear 503 instead of
 * silently using a local fallback).
 */
async function verifyInfrastructure(): Promise<void> {
  await getWalletBackend();
  await getGenerationStore();
  await getFileStorage();
  await getUpscaleStore();
  await getUpscaleFileStorage();
}

async function start(): Promise<void> {
  assertInfrastructureConfig();
  if (isProduction()) {
    try {
      await verifyInfrastructure();
    } catch (err) {
      serverLogger.error('Refusing to start in production: required infrastructure is not ready.', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  app.listen(PORT, () => {
    serverLogger.log(`Render Lab backend listening on http://localhost:${PORT}`);
    if (!process.env.BFL_API_KEY) {
      serverLogger.error('BFL_API_KEY is not set. Add it to backend/.env before generating renders.');
    }
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
      serverLogger.error('STRIPE_SECRET_KEY and/or STRIPE_WEBHOOK_SECRET are not set. Billing checkout/webhook will return 503 until both are added to backend/.env.');
    }
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      serverLogger.error('SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY are not set. Billing, credits, history and file storage cannot work until both are added to backend/.env.');
    }
    if (!isProduction()) {
      verifyInfrastructure().catch((err) => serverLogger.error('Infrastructure check (development): ' + (err instanceof Error ? err.message : String(err))));
    }
    startWalletReconciler(async () => {
      await reconcileStaleGenerations();
    });
  });
}

void start();
