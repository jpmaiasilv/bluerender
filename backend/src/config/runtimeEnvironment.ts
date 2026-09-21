/**
 * Environment rules for infrastructure that holds user data or money.
 *
 * PRODUCTION (NODE_ENV=production): Supabase database, Supabase Storage and
 * authentication are mandatory. No in-memory wallet, no JSON file, no local
 * disk for Planta Humanizada files — and no way to switch any of that on.
 *
 * DEVELOPMENT: the same Supabase infrastructure is used when it is set up.
 * A local fallback (in-memory wallet, JSON generation store, files on disk)
 * exists ONLY behind the explicit flag ALLOW_LOCAL_DEV_FALLBACK=true, and is
 * announced loudly in the log every time it is used. Without the flag, a
 * missing/unmigrated Supabase is an error, never a silent downgrade.
 */

export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production';
}

export function isLocalDevFallbackAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return !isProduction(env) && env.ALLOW_LOCAL_DEV_FALLBACK === 'true';
}

export const LOCAL_FALLBACK_BANNER = '*** LOCAL DEV FALLBACK ACTIVE (ALLOW_LOCAL_DEV_FALLBACK=true): data is NOT stored in Supabase ***';

/** Throws a clear error at startup when production is missing something it must have. Pure function of the env — unit-testable. */
export function assertInfrastructureConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (!isProduction(env)) return;
  const problems: string[] = [];
  if (!env.SUPABASE_URL) problems.push('SUPABASE_URL is not set');
  if (!env.SUPABASE_SERVICE_ROLE_KEY) problems.push('SUPABASE_SERVICE_ROLE_KEY is not set');
  if (env.ALLOW_LOCAL_DEV_FALLBACK === 'true') problems.push('ALLOW_LOCAL_DEV_FALLBACK must not be enabled in production');
  if (env.WALLET_SIGNUP_BONUS_CREDITS !== undefined && !/^\d+$/.test(env.WALLET_SIGNUP_BONUS_CREDITS)) problems.push('WALLET_SIGNUP_BONUS_CREDITS must be a non-negative integer');
  if (problems.length > 0) {
    throw new Error(`Refusing to start in production: ${problems.join('; ')}.`);
  }
}

/**
 * Credits granted once to a brand-new wallet. There is no persistent signup
 * rule in the product yet, so production defaults to 0 (nothing is invented);
 * development defaults to 100 to match the previous local behaviour.
 */
export function walletSignupBonusCredits(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.WALLET_SIGNUP_BONUS_CREDITS;
  if (raw !== undefined && raw.trim() !== '') {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0) return n;
  }
  return isProduction(env) ? 0 : 100;
}

/** Minutes a reservation may stay unsettled before reconciliation looks at it. Longer than any provider timeout. */
export function walletStaleReservationMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.WALLET_RESERVATION_STALE_MINUTES);
  return Number.isFinite(n) && n >= 1 ? n : 20;
}
