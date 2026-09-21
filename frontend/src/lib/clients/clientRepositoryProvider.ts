import { SupabaseClientRepository } from './supabaseRepository';
import { ClientRepository } from './repository';

export interface ClientRepositories {
  clients: ClientRepository;
}

/** Cached per organization id — a new organization means new repository
 * instances, but switching back to a previously-seen org (or the common
 * case of a single org) reuses the same instance. Mirrors
 * projectRepositoryProvider.ts / financial/repositoryProvider.ts. */
let cachedOrgId: string | null = null;
let cached: ClientRepositories | null = null;

export function getClientRepositories(organizationId: string): ClientRepositories {
  if (!cached || cachedOrgId !== organizationId) {
    cached = { clients: new SupabaseClientRepository(organizationId) };
    cachedOrgId = organizationId;
  }
  return cached;
}
