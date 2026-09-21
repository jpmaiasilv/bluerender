import { Router, Request, Response } from 'express';
import { listRenderEngineOptions } from '../config/renderEngines';

export const enginesRouter = Router();

enginesRouter.get('/engines', (_req: Request, res: Response) => {
  const engines = listRenderEngineOptions().map((e) => ({
    id: e.id,
    technicalName: e.technicalName,
    credits: e.credits,
    badge: e.badge ?? null,
    legacy: e.legacy,
  }));
  res.json({ engines });
});
