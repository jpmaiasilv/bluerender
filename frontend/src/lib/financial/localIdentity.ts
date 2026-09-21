/**
 * This build has no real authentication or multi-tenant backend — every
 * financial record is still tagged with userId/organizationId so a future
 * Supabase migration (real auth + row-level security) never needs a data
 * migration, only a repository swap (see repository.ts). Never fabricate a
 * realistic-looking user — this constant is intentionally a placeholder,
 * not a fake identity.
 */
export const LOCAL_USER_ID = 'local-user';
export const LOCAL_ORGANIZATION_ID: string | null = null;
