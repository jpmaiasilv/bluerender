import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Centralized Supabase client — the only place in the frontend allowed to
 * construct one. Auth, Financeiro and Fluxo de Projetos are all backed by
 * this client (see lib/auth, lib/financial, lib/projects, lib/clients).
 *
 * Only the publishable (anon) key is ever read here — never the secret /
 * service role key, which must never reach the browser bundle. Values
 * themselves are never logged or exposed; only their presence is checked.
 *
 * Reads `import.meta.env` (real in the Vite-built app) with a `process.env`
 * fallback so this same module also runs under plain Node/tsx test scripts
 * (via `node --env-file=.env`) — the fallback branch never executes in the
 * browser build, since `import.meta.env` is always a real object there.
 */
const env: Record<string, string | undefined> =
  (import.meta.env as unknown as Record<string, string | undefined>) ?? (typeof process !== 'undefined' ? process.env : {});
const supabaseUrl = env.VITE_SUPABASE_URL;
const supabasePublishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

if (!isSupabaseConfigured) {
  // eslint-disable-next-line no-console
  console.warn('[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are not set — Supabase-backed features stay disabled.');
}

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabasePublishableKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export interface SupabaseConnectionCheck {
  ok: boolean;
  message: string;
}

/**
 * Safe, read-only connectivity check that works even though no tables exist
 * yet: querying a table that doesn't exist still round-trips through
 * PostgREST and the project's auth layer, so a well-formed "relation not
 * found" response (PGRST205 / 42P01) is a genuine confirmation that the URL
 * and publishable key are valid and the project is reachable — as opposed
 * to a network failure or an auth rejection, which surface as different
 * error shapes. Never touches or creates any real table.
 */
export async function testSupabaseConnection(): Promise<SupabaseConnectionCheck> {
  if (!supabase) {
    return { ok: false, message: 'Supabase client not configured (missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY).' };
  }
  try {
    const { error } = await supabase.from('__connection_check__').select('*').limit(1);
    if (!error) {
      // Table unexpectedly exists — still a successful, real connection.
      return { ok: true, message: 'Connected to the Supabase project.' };
    }
    const notFoundCodes = ['PGRST205', '42P01'];
    if (notFoundCodes.includes(error.code ?? '') || /does not exist|could not find the table/i.test(error.message)) {
      return { ok: true, message: 'Connected to the Supabase project (reached PostgREST; no tables exist yet, as expected).' };
    }
    return { ok: false, message: `Reached Supabase but got an unexpected error: ${error.message}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
