import { NextFunction, Request, Response } from 'express';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { serverLogger } from '../lib/logger';

export interface AuthenticatedRequest extends Request {
  user?: { id: string; email: string | null };
}

/**
 * Verifies the Supabase access token the frontend sends (Authorization: Bearer <token>)
 * against Supabase itself — never trusts a user/organization id the browser sends directly.
 * Populates req.user only once that token has been confirmed valid.
 */
export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!token) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Missing bearer token.' } });
    return;
  }

  try {
    const { data, error } = await getSupabaseAdmin().auth.getUser(token);
    if (error || !data.user) {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired session.' } });
      return;
    }
    req.user = { id: data.user.id, email: data.user.email ?? null };
    next();
  } catch (err) {
    serverLogger.error('requireAuth: could not verify session', err);
    res.status(500).json({ error: { code: 'AUTH_CHECK_FAILED', message: 'Could not verify session.' } });
  }
}
