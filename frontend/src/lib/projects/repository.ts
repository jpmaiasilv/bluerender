import { ChecklistItem, Project, ProjectFilter, ProjectHistoryEntry, ProjectInput, ProjectStage, ProjectTag } from './types';

/**
 * The only contracts the UI and ProjectService are allowed to depend on —
 * mirrors lib/financial/repository.ts's pattern exactly. Today
 * IndexedDbProjectRepository (see indexedDbRepository.ts) is the only
 * implementation; a future SupabaseProjectRepository implementing the same
 * interface is a drop-in replacement via projectRepositoryProvider.ts.
 */
export interface ProjectRepository {
  createProject(input: ProjectInput & { id?: string; createdAt?: string; updatedAt?: string; userId?: string | null; organizationId?: string | null }): Promise<Project>;
  updateProject(id: string, patch: Partial<Project>): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  getProject(id: string): Promise<Project | null>;
  listProjects(filter?: ProjectFilter): Promise<Project[]>;
  /** Batch-persists the `order` field for every project id in a stage, in the given sequence. */
  reorderWithinStage(stageId: string, orderedProjectIds: string[]): Promise<void>;
}

export interface ProjectStageRepository {
  createStage(input: Pick<ProjectStage, 'name' | 'order'>): Promise<ProjectStage>;
  updateStage(id: string, patch: Partial<Pick<ProjectStage, 'name' | 'order'>>): Promise<ProjectStage>;
  deleteStage(id: string): Promise<void>;
  listStages(): Promise<ProjectStage[]>;
}

export interface ProjectTagRepository {
  createTag(name: string): Promise<ProjectTag>;
  deleteTag(id: string): Promise<void>;
  listTags(): Promise<ProjectTag[]>;
}

export interface ProjectHistoryRepository {
  addEntry(entry: Omit<ProjectHistoryEntry, 'id'>): Promise<ProjectHistoryEntry>;
  listByProject(projectId: string): Promise<ProjectHistoryEntry[]>;
}

export type { ChecklistItem };
