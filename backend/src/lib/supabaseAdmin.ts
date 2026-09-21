import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase client using the service_role key — bypasses RLS entirely.
 * Never expose SUPABASE_SERVICE_ROLE_KEY to the frontend; it belongs in backend/.env only.
 * Used to (a) verify a user's access token (auth.getUser) and (b) write billing state
 * from signature-verified Stripe webhook events.
 */

let client: SupabaseClient | null = null;

export function isSupabaseAdminConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in backend/.env to use Supabase from the backend.');
  }
  client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return client;
}
