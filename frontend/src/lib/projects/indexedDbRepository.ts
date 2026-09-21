import { getProjectsDb } from './db';
import { ProjectHistoryRepository, ProjectRepository, ProjectStageRepository, ProjectTagRepository } from './repository';
import { Project, ProjectFilter, ProjectHistoryEntry, ProjectInput, ProjectStage, ProjectTag } from './types';

function newId(): string {
  return crypto.randomUUID();
}

function nowISO(): string {
  return new Date().toISOString();
}

export class IndexedDbProjectRepository implements ProjectRepository {
  async createProject(
    input: ProjectInput & { id?: string; createdAt?: string; updatedAt?: string; userId?: string | null; organizationId?: string | null }
  ): Promise<Project> {
    const db = await getProjectsDb();
    const now = nowISO();
    const existingInStage = await db.getAllFromIndex('projects', 'stageId', input.stageId);
    const project: Project = {
      id: input.id ?? newId(),
      userId: input.userId ?? null,
      organizationId: input.organizationId ?? null,
      name: input.name,
      clientId: input.clientId,
      projectType: input.projectType,
      stageId: input.stageId,
      order: existingInStage.length,
      stageEnteredAt: now,
      priority: input.priority,
      startDate: input.startDate,
      dueDate: input.dueDate,
      contractValueCents: input.contractValueCents,
      waitingForClient: false,
      waitingSince: null,
      approvalStatus: 'none',
      responsibleId: input.responsibleId,
      responsibleName: input.responsibleName,
      nextAction: input.nextAction,
      notes: input.notes,
      tagIds: input.tagIds,
      checklist: [],
      attachmentIds: [],
      archivedAt: null,
      completedAt: null,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };
    await db.put('projects', project);
    return project;
  }

  async updateProject(id: string, patch: Partial<Project>): Promise<Project> {
    const db = await getProjectsDb();
    const existing = await db.get('projects', id);
    if (!existing) throw new Error(`Project not found: ${id}`);
    const updated: Project = { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt, updatedAt: nowISO() };
    await db.put('projects', updated);
    return updated;
  }

  async deleteProject(id: string): Promise<void> {
    const db = await getProjectsDb();
    await db.delete('projects', id);
  }

  async getProject(id: string): Promise<Project | null> {
    const db = await getProjectsDb();
    return (await db.get('projects', id)) ?? null;
  }

  async listProjects(filter?: ProjectFilter): Promise<Project[]> {
    const db = await getProjectsDb();
    let all = await db.getAll('projects');
    if (!filter?.includeArchived) all = all.filter((p) => !p.archivedAt);
    if (filter?.stageId) all = all.filter((p) => p.stageId === filter.stageId);
    if (filter?.priority) all = all.filter((p) => p.priority === filter.priority);
    if (filter?.clientId) all = all.filter((p) => p.clientId === filter.clientId);
    if (filter?.responsibleId) all = all.filter((p) => p.responsibleId === filter.responsibleId);
    return all;
  }

  async reorderWithinStage(stageId: string, orderedProjectIds: string[]): Promise<void> {
    const db = await getProjectsDb();
    const tx = db.transaction('projects', 'readwrite');
    await Promise.all(
      orderedProjectIds.map(async (id, index) => {
        const project = await tx.store.get(id);
        if (project && project.stageId === stageId) {
          await tx.store.put({ ...project, order: index, updatedAt: nowISO() });
        }
      })
    );
    await tx.done;
  }
}

export class IndexedDbProjectStageRepository implements ProjectStageRepository {
  async createStage(input: Pick<ProjectStage, 'name' | 'order'>): Promise<ProjectStage> {
    const db = await getProjectsDb();
    const now = nowISO();
    const stage: ProjectStage = { id: newId(), name: input.name.trim(), order: input.order, createdAt: now, updatedAt: now };
    await db.put('projectStages', stage);
    return stage;
  }

  async updateStage(id: string, patch: Partial<Pick<ProjectStage, 'name' | 'order'>>): Promise<ProjectStage> {
    const db = await getProjectsDb();
    const existing = await db.get('projectStages', id);
    if (!existing) throw new Error(`Stage not found: ${id}`);
    const updated: ProjectStage = { ...existing, ...patch, updatedAt: nowISO() };
    await db.put('projectStages', updated);
    return updated;
  }

  async deleteStage(id: string): Promise<void> {
    const db = await getProjectsDb();
    const inUse = await db.getAllFromIndex('projects', 'stageId', id);
    if (inUse.length > 0) {
      throw new Error('STAGE_IN_USE');
    }
    await db.delete('projectStages', id);
  }

  async listStages(): Promise<ProjectStage[]> {
    const db = await getProjectsDb();
    const all = await db.getAll('projectStages');
    return all.sort((a, b) => a.order - b.order);
  }
}

export class IndexedDbProjectTagRepository implements ProjectTagRepository {
  async createTag(name: string): Promise<ProjectTag> {
    const db = await getProjectsDb();
    const tag: ProjectTag = { id: newId(), name: name.trim(), createdAt: nowISO() };
    await db.put('projectTags', tag);
    return tag;
  }

  async deleteTag(id: string): Promise<void> {
    const db = await getProjectsDb();
    await db.delete('projectTags', id);
  }

  async listTags(): Promise<ProjectTag[]> {
    const db = await getProjectsDb();
    return db.getAll('projectTags');
  }
}

export class IndexedDbProjectHistoryRepository implements ProjectHistoryRepository {
  async addEntry(entry: Omit<ProjectHistoryEntry, 'id'>): Promise<ProjectHistoryEntry> {
    const db = await getProjectsDb();
    const created: ProjectHistoryEntry = { ...entry, id: newId() };
    await db.put('projectHistory', created);
    return created;
  }

  async listByProject(projectId: string): Promise<ProjectHistoryEntry[]> {
    const db = await getProjectsDb();
    const entries = await db.getAllFromIndex('projectHistory', 'projectId', projectId);
    return entries.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
  }
}
