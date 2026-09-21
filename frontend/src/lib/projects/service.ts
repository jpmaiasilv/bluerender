import { LOCAL_ORGANIZATION_ID, LOCAL_USER_ID } from '../financial/localIdentity';
import { todayISO } from './dates';
import { ProjectRepositories } from './projectRepositoryProvider';
import { ChecklistItem, Project, ProjectInput, ProjectStage, ProjectTag } from './types';

function newId(): string {
  return crypto.randomUUID();
}

/**
 * The only layer UI components talk to for the project-flow module — owns
 * business rules (id/createdAt preservation, stage-move history logging,
 * safe stage deletion with migration, bounded/simple checklist mutation) so
 * they live in one place regardless of which repository is behind them.
 * Mirrors lib/financial/service.ts's shape.
 */
export class ProjectService {
  constructor(private repos: ProjectRepositories) {}

  async listProjects(includeArchived = false) {
    return this.repos.projects.listProjects({ includeArchived });
  }

  async listStages() {
    return this.repos.stages.listStages();
  }

  async listTags() {
    return this.repos.tags.listTags();
  }

  async createProject(input: ProjectInput): Promise<Project> {
    return this.repos.projects.createProject({ ...input, userId: LOCAL_USER_ID, organizationId: LOCAL_ORGANIZATION_ID });
  }

  async updateProject(id: string, patch: Partial<Project>): Promise<Project> {
    return this.repos.projects.updateProject(id, patch);
  }

  async deleteProject(id: string): Promise<void> {
    return this.repos.projects.deleteProject(id);
  }

  async duplicateProject(source: Project): Promise<Project> {
    // Explicitly does NOT copy: dates, waitingForClient, approvalStatus,
    // completedAt/archivedAt, attachments, history, or checklist completion
    // state — a duplicate is a fresh instance the user reviews before saving.
    return this.repos.projects.createProject({
      name: `${source.name} (cópia)`,
      clientId: source.clientId,
      projectType: source.projectType,
      stageId: source.stageId,
      priority: source.priority,
      startDate: null,
      dueDate: null,
      contractValueCents: source.contractValueCents,
      responsibleId: source.responsibleId,
      responsibleName: source.responsibleName,
      nextAction: null,
      notes: null,
      tagIds: [...source.tagIds],
      userId: LOCAL_USER_ID,
      organizationId: LOCAL_ORGANIZATION_ID,
    }).then(async (created) => {
      if (source.checklist.length === 0) return created;
      const checklist: ChecklistItem[] = source.checklist.map((item) => ({ ...item, id: newId(), completed: false }));
      return this.repos.projects.updateProject(created.id, { checklist });
    });
  }

  /** Moves a project to a new stage, updates stageEnteredAt, and logs the
   * transition to history — the three things that must always happen
   * together whenever a card crosses a column boundary. */
  async moveToStage(projectId: string, toStageId: string): Promise<Project> {
    const project = await this.repos.projects.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    const fromStageId = project.stageId;
    if (fromStageId === toStageId) return project;

    const destinationProjects = await this.repos.projects.listProjects({ stageId: toStageId, includeArchived: true });
    const updated = await this.repos.projects.updateProject(projectId, {
      stageId: toStageId,
      stageEnteredAt: new Date().toISOString(),
      order: destinationProjects.length,
    });
    await this.repos.history.addEntry({ projectId, fromStageId, toStageId, timestamp: new Date().toISOString() });
    return updated;
  }

  async reorderWithinStage(stageId: string, orderedProjectIds: string[]): Promise<void> {
    return this.repos.projects.reorderWithinStage(stageId, orderedProjectIds);
  }

  async getHistory(projectId: string) {
    return this.repos.history.listByProject(projectId);
  }

  async markCompleted(id: string): Promise<Project> {
    return this.repos.projects.updateProject(id, { completedAt: new Date().toISOString() });
  }

  async reopenProject(id: string): Promise<Project> {
    return this.repos.projects.updateProject(id, { completedAt: null });
  }

  async archiveProject(id: string): Promise<Project> {
    return this.repos.projects.updateProject(id, { archivedAt: new Date().toISOString() });
  }

  async unarchiveProject(id: string): Promise<Project> {
    return this.repos.projects.updateProject(id, { archivedAt: null });
  }

  async setWaitingForClient(id: string, waiting: boolean): Promise<Project> {
    return this.repos.projects.updateProject(id, { waitingForClient: waiting, waitingSince: waiting ? todayISO() : null });
  }

  async setApprovalStatus(id: string, approvalStatus: Project['approvalStatus']): Promise<Project> {
    return this.repos.projects.updateProject(id, { approvalStatus });
  }

  // --- Checklist (embedded on Project — see types.ts) ---

  async addChecklistItem(projectId: string, title: string): Promise<Project> {
    const project = await this.repos.projects.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    const item: ChecklistItem = { id: newId(), title: title.trim(), completed: false, order: project.checklist.length, createdAt: new Date().toISOString() };
    return this.repos.projects.updateProject(projectId, { checklist: [...project.checklist, item] });
  }

  async toggleChecklistItem(projectId: string, itemId: string, completed: boolean): Promise<Project> {
    const project = await this.repos.projects.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    const checklist = project.checklist.map((i) => (i.id === itemId ? { ...i, completed } : i));
    return this.repos.projects.updateProject(projectId, { checklist });
  }

  async removeChecklistItem(projectId: string, itemId: string): Promise<Project> {
    const project = await this.repos.projects.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    const checklist = project.checklist.filter((i) => i.id !== itemId);
    return this.repos.projects.updateProject(projectId, { checklist });
  }

  // --- Stages ---

  async createStage(name: string): Promise<ProjectStage> {
    const stages = await this.repos.stages.listStages();
    return this.repos.stages.createStage({ name, order: stages.length });
  }

  async renameStage(id: string, name: string): Promise<ProjectStage> {
    return this.repos.stages.updateStage(id, { name });
  }

  async reorderStages(orderedStageIds: string[]): Promise<void> {
    await Promise.all(orderedStageIds.map((id, index) => this.repos.stages.updateStage(id, { order: index })));
  }

  /** Deleting a stage never deletes its projects — every project currently
   * in it is migrated to `migrateToStageId` first, then the (now-empty)
   * stage is removed. The repository itself refuses to delete a
   * still-in-use stage as a defense-in-depth check. */
  async deleteStage(id: string, migrateToStageId: string): Promise<void> {
    const projectsInStage = await this.repos.projects.listProjects({ stageId: id, includeArchived: true });
    for (const project of projectsInStage) {
      await this.moveToStage(project.id, migrateToStageId);
    }
    await this.repos.stages.deleteStage(id);
  }

  // --- Tags ---

  async createTag(name: string): Promise<ProjectTag> {
    return this.repos.tags.createTag(name);
  }

  async deleteTag(id: string): Promise<void> {
    return this.repos.tags.deleteTag(id);
  }
}
