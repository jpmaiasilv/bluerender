import { SupabaseSupportRepository } from './supabaseRepository';
import { SupportRepository } from './repository';

export interface SupportRepositories {
  support: SupportRepository;
}

/** Cached per organization id. Mirrors clientRepositoryProvider.ts /
 * projectRepositoryProvider.ts / financial/repositoryProvider.ts. */
let cachedOrgId: string | null = null;
let cached: SupportRepositories | null = null;

export function getSupportRepositories(organizationId: string): SupportRepositories {
  if (!cached || cachedOrgId !== organizationId) {
    cached = { support: new SupabaseSupportRepository(organizationId) };
    cachedOrgId = organizationId;
  }
  return cached;
}
