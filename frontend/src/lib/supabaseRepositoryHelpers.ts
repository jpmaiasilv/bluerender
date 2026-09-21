import { PostgrestError } from '@supabase/supabase-js';
import { supabase } from './supabase';

/** Every Supabase-backed repository needs a live client — this is the one
 * place that asserts it, so callers get a clear error instead of a null-ref
 * deep inside a query chain. */
export function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

/** Throws a plain Error with the PostgREST message — repositories never let
 * a raw PostgrestError (with internal codes/hints) reach the UI; callers
 * catch this the same way they already catch IndexedDB errors. */
export function assertNoError(error: PostgrestError | null): void {
  if (error) throw new Error(error.message);
}
