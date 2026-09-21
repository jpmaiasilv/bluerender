import { SupabaseProjectHistoryRepository, SupabaseProjectRepository, SupabaseProjectStageRepository, SupabaseProjectTagRepository } from './supabaseRepository';
import { ProjectHistoryRepository, ProjectRepository, ProjectStageRepository, ProjectTagRepository } from './repository';

/** The one place that decides which repository implementation backs the
 * project-flow module — mirrors financial/repositoryProvider.ts exactly.
 * Supabase-backed since the management_foundation migration; cached per
 * organization id (see AuthProvider's currentOrganization) so switching org
 * — or the common single-org case — never rebuilds repositories needlessly. */
export interface ProjectRepositories {
  projects: ProjectRepository;
  stages: ProjectStageRepository;
  tags: ProjectTagRepository;
  history: ProjectHistoryRepository;
}

let cachedOrgId: string | null = null;
let cached: ProjectRepositories | null = null;

export function getProjectRepositories(organizationId: string): ProjectRepositories {
  if (!cached || cachedOrgId !== organizationId) {
    cached = {
      projects: new SupabaseProjectRepository(organizationId),
      stages: new SupabaseProjectStageRepository(organizationId),
      tags: new SupabaseProjectTagRepository(organizationId),
      history: new SupabaseProjectHistoryRepository(organizationId),
    };
    cachedOrgId = organizationId;
  }
  return cached;
}
