/**
 * Translates raw Supabase Auth error messages into a stable key the UI can
 * look up in messages.auth.errors — never shows PostgREST/GoTrue internals,
 * SQL, or stack traces to the user.
 */
export type AuthErrorKey =
  | 'invalidCredentials'
  | 'emailAlreadyRegistered'
  | 'emailNotConfirmed'
  | 'weakPassword'
  | 'invalidEmail'
  | 'sameNewPassword'
  | 'networkError'
  | 'unknown';

const PATTERNS: Array<[RegExp, AuthErrorKey]> = [
  [/invalid login credentials/i, 'invalidCredentials'],
  [/already registered|already exists|user already registered/i, 'emailAlreadyRegistered'],
  [/email not confirmed/i, 'emailNotConfirmed'],
  [/password should be at least|password.*too short|weak password/i, 'weakPassword'],
  [/unable to validate email|invalid email/i, 'invalidEmail'],
  [/new password should be different/i, 'sameNewPassword'],
  [/failed to fetch|network|fetch error/i, 'networkError'],
];

export function mapAuthError(error: unknown): AuthErrorKey {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  for (const [pattern, key] of PATTERNS) {
    if (pattern.test(message)) return key;
  }
  return 'unknown';
}
