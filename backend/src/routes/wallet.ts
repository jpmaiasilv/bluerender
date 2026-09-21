import { Response, Router } from 'express';
import { AppError } from '../lib/errors';
import { serverLogger } from '../lib/logger';
import { AuthenticatedRequest, requireAuth } from '../middleware/requireAuth';
import { getWalletBalance, grantCredits } from '../services/creditWallet';
import { isProduction } from '../config/runtimeEnvironment';

export const walletRouter = Router();

const DEV_TEST_CREDITS = 100;

function sendWalletError(res: Response, err: unknown): void {
  if (err instanceof AppError) {
    res.status(err.httpStatus).json({ error: { code: err.code, message: err.message } });
    return;
  }
  serverLogger.error('Unexpected wallet error', err instanceof Error ? err.message : String(err));
  res.status(500).json({ error: { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred.' } });
}

/** The signed-in user's OWN spendable balance — the user id comes from the verified token, never from the request. */
walletRouter.get('/wallet', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    res.json({ balance: await getWalletBalance(req.user!.id) });
  } catch (err) {
    sendWalletError(res, err);
  }
});

// DEV-ONLY: grants free test credits to the caller's own wallet (recorded in the ledger). Does not exist in production.
walletRouter.post('/wallet/test-credits', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (isProduction()) {
    res.status(404).json({ error: { code: 'UNKNOWN_ERROR', message: 'Not found.' } });
    return;
  }
  try {
    const userId = req.user!.id;
    await getWalletBalance(userId);
    res.json({ balance: await grantCredits(userId, DEV_TEST_CREDITS, 'dev_test_credits', 'dev') });
  } catch (err) {
    sendWalletError(res, err);
  }
});
