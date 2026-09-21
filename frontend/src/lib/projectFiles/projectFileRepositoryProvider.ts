import { SupabaseProjectFileRepository } from './supabaseRepository';
import { ProjectFileRepository } from './repository';

export interface ProjectFileRepositories {
  projectFiles: ProjectFileRepository;
}

/** Cached per organization id — mirrors clientRepositoryProvider.ts /
 * supportRepositoryProvider.ts. Scoped only by org (not by project — the
 * repository takes projectId per call), so switching between obras within
 * the same office reuses the same instance. */
let cachedOrgId: string | null = null;
let cached: ProjectFileRepositories | null = null;

export function getProjectFileRepositories(organizationId: string): ProjectFileRepositories {
  if (!cached || cachedOrgId !== organizationId) {
    cached = { projectFiles: new SupabaseProjectFileRepository(organizationId) };
    cachedOrgId = organizationId;
  }
  return cached;
}
