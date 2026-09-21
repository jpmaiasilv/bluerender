import { assertNoError, requireSupabase } from '../supabaseRepositoryHelpers';
import { ProjectHistoryRepository, ProjectRepository, ProjectStageRepository, ProjectTagRepository } from './repository';
import { ChecklistItem, Project, ProjectFilter, ProjectHistoryEntry, ProjectInput, ProjectStage, ProjectTag } from './types';
import {
  ProjectHistoryRow,
  ProjectRow,
  ProjectStageRow,
  ProjectTagRow,
  ProjectTaskRow,
  mapHistoryRow,
  mapProjectRow,
  mapStageRow,
  mapTagRow,
  mapTaskRow,
} from './mappers';

function projectPatchToRow(patch: Partial<Project>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if ('name' in patch) row.name = patch.name;
  if ('clientId' in patch) row.client_id = patch.clientId;
  if ('projectType' in patch) row.project_type = patch.projectType;
  if ('stageId' in patch) row.stage_id = patch.stageId;
  if ('order' in patch) row.position = patch.order;
  if ('stageEnteredAt' in patch) row.stage_entered_at = patch.stageEnteredAt;
  if ('priority' in patch) row.priority = patch.priority;
  if ('startDate' in patch) row.start_date = patch.startDate;
  if ('dueDate' in patch) row.due_date = patch.dueDate;
  if ('contractValueCents' in patch) row.contract_value_cents = patch.contractValueCents;
  if ('waitingForClient' in patch) row.waiting_for_client = patch.waitingForClient;
  if ('waitingSince' in patch) row.waiting_since = patch.waitingSince;
  if ('approvalStatus' in patch) row.approval_status = patch.approvalStatus;
  if ('responsibleId' in patch) row.responsible_user_id = patch.responsibleId;
  if ('responsibleName' in patch) row.responsible_name = patch.responsibleName;
  if ('nextAction' in patch) row.next_action = patch.nextAction;
  if ('notes' in patch) row.notes = patch.notes;
  if ('archivedAt' in patch) row.archived_at = patch.archivedAt;
  if ('completedAt' in patch) row.completed_at = patch.completedAt;
  return row;
}

/** Batch-fetches checklist + tag ids for a set of project ids in two
 * queries total (never N+1) and returns per-project maps ready to merge
 * into mapProjectRow(). */
async function fetchChecklistsAndTags(
  projectIds: string[]
): Promise<{ checklistByProject: Map<string, ChecklistItem[]>; tagIdsByProject: Map<string, string[]> }> {
  const supabase = requireSupabase();
  const checklistByProject = new Map<string, ChecklistItem[]>();
  const tagIdsByProject = new Map<string, string[]>();
  if (projectIds.length === 0) return { checklistByProject, tagIdsByProject };

  const [tasksResult, linksResult] = await Promise.all([
    supabase.from('project_tasks').select('*').in('project_id', projectIds).order('position', { ascending: true }),
    supabase.from('project_tag_links').select('project_id, tag_id').in('project_id', projectIds),
  ]);
  assertNoError(tasksResult.error);
  assertNoError(linksResult.error);

  for (const row of (tasksResult.data as ProjectTaskRow[]) ?? []) {
    const list = checklistByProject.get(row.project_id) ?? [];
    list.push(mapTaskRow(row));
    checklistByProject.set(row.project_id, list);
  }
  for (const row of (linksResult.data as { project_id: string; tag_id: string }[]) ?? []) {
    const list = tagIdsByProject.get(row.project_id) ?? [];
    list.push(row.tag_id);
    tagIdsByProject.set(row.project_id, list);
  }
  return { checklistByProject, tagIdsByProject };
}

export class SupabaseProjectRepository implements ProjectRepository {
  constructor(private organizationId: string) {}

  async createProject(
    input: ProjectInput & { id?: string; createdAt?: string; updatedAt?: string; userId?: string | null; organizationId?: string | null }
  ): Promise<Project> {
    const supabase = requireSupabase();
    const { count } = await supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', this.organizationId)
      .eq('stage_id', input.stageId);

    const { data, error } = await supabase
      .from('projects')
      .insert({
        id: input.id,
        organization_id: this.organizationId,
        client_id: input.clientId,
        stage_id: input.stageId,
        name: input.name,
        project_type: input.projectType,
        contract_value_cents: input.contractValueCents,
        position: count ?? 0,
        priority: input.priority,
        start_date: input.startDate,
        due_date: input.dueDate,
        responsible_user_id: null,
        responsible_name: input.responsibleName,
        next_action: input.nextAction,
        notes: input.notes,
        ...(input.createdAt ? { created_at: input.createdAt } : {}),
        ...(input.updatedAt ? { updated_at: input.updatedAt } : {}),
      })
      .select()
      .single();
    assertNoError(error);
    const project = data as ProjectRow;

    if (input.tagIds.length > 0) {
      const { error: linkError } = await supabase
        .from('project_tag_links')
        .insert(input.tagIds.map((tagId) => ({ project_id: project.id, tag_id: tagId, organization_id: this.organizationId })));
      assertNoError(linkError);
    }

    return mapProjectRow(project, [], input.tagIds);
  }

  async updateProject(id: string, patch: Partial<Project>): Promise<Project> {
    const supabase = requireSupabase();
    const rowPatch = projectPatchToRow(patch);
    if (Object.keys(rowPatch).length > 0) {
      const { error } = await supabase.from('projects').update(rowPatch).eq('id', id);
      assertNoError(error);
    }

    if (patch.checklist) {
      const { error: deleteError } = await supabase.from('project_tasks').delete().eq('project_id', id);
      assertNoError(deleteError);
      if (patch.checklist.length > 0) {
        const { error: insertError } = await supabase.from('project_tasks').insert(
          patch.checklist.map((item) => ({
            id: item.id,
            organization_id: this.organizationId,
            project_id: id,
            title: item.title,
            completed: item.completed,
            position: item.order,
          }))
        );
        assertNoError(insertError);
      }
    }

    if (patch.tagIds) {
      const { error: deleteError } = await supabase.from('project_tag_links').delete().eq('project_id', id);
      assertNoError(deleteError);
      if (patch.tagIds.length > 0) {
        const { error: insertError } = await supabase
          .from('project_tag_links')
          .insert(patch.tagIds.map((tagId) => ({ project_id: id, tag_id: tagId, organization_id: this.organizationId })));
        assertNoError(insertError);
      }
    }

    const updated = await this.getProject(id);
    if (!updated) throw new Error(`Project not found: ${id}`);
    return updated;
  }

  async deleteProject(id: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase.from('projects').delete().eq('id', id);
    assertNoError(error);
  }

  async getProject(id: string): Promise<Project | null> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.from('projects').select('*').eq('id', id).maybeSingle();
    assertNoError(error);
    if (!data) return null;
    const row = data as ProjectRow;
    const { checklistByProject, tagIdsByProject } = await fetchChecklistsAndTags([row.id]);
    return mapProjectRow(row, checklistByProject.get(row.id) ?? [], tagIdsByProject.get(row.id) ?? []);
  }

  async listProjects(filter?: ProjectFilter): Promise<Project[]> {
    const supabase = requireSupabase();
    let query = supabase.from('projects').select('*').eq('organization_id', this.organizationId);
    if (!filter?.includeArchived) query = query.is('archived_at', null);
    if (filter?.stageId) query = query.eq('stage_id', filter.stageId);
    if (filter?.priority) query = query.eq('priority', filter.priority);
    if (filter?.clientId) query = query.eq('client_id', filter.clientId);
    if (filter?.responsibleId) query = query.eq('responsible_user_id', filter.responsibleId);

    const { data, error } = await query;
    assertNoError(error);
    const rows = (data as ProjectRow[]) ?? [];
    const { checklistByProject, tagIdsByProject } = await fetchChecklistsAndTags(rows.map((r) => r.id));
    return rows.map((row) => mapProjectRow(row, checklistByProject.get(row.id) ?? [], tagIdsByProject.get(row.id) ?? []));
  }

  async reorderWithinStage(stageId: string, orderedProjectIds: string[]): Promise<void> {
    const supabase = requireSupabase();
    await Promise.all(
      orderedProjectIds.map((id, index) =>
        supabase.from('projects').update({ position: index }).eq('id', id).eq('stage_id', stageId)
      )
    );
  }
}

export class SupabaseProjectStageRepository implements ProjectStageRepository {
  constructor(private organizationId: string) {}

  async createStage(input: Pick<ProjectStage, 'name' | 'order'>): Promise<ProjectStage> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from('project_stages')
      .insert({ organization_id: this.organizationId, name: input.name.trim(), position: input.order })
      .select()
      .single();
    assertNoError(error);
    return mapStageRow(data as ProjectStageRow);
  }

  async updateStage(id: string, patch: Partial<Pick<ProjectStage, 'name' | 'order'>>): Promise<ProjectStage> {
    const supabase = requireSupabase();
    const rowPatch: Record<string, unknown> = {};
    if (patch.name !== undefined) rowPatch.name = patch.name;
    if (patch.order !== undefined) rowPatch.position = patch.order;
    const { data, error } = await supabase.from('project_stages').update(rowPatch).eq('id', id).select().single();
    assertNoError(error);
    return mapStageRow(data as ProjectStageRow);
  }

  async deleteStage(id: string): Promise<void> {
    const supabase = requireSupabase();
    const { count } = await supabase.from('projects').select('id', { count: 'exact', head: true }).eq('stage_id', id);
    if ((count ?? 0) > 0) throw new Error('STAGE_IN_USE');
    const { error } = await supabase.from('project_stages').delete().eq('id', id);
    assertNoError(error);
  }

  async listStages(): Promise<ProjectStage[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from('project_stages')
      .select('*')
      .eq('organization_id', this.organizationId)
      .order('position', { ascending: true });
    assertNoError(error);
    return ((data as ProjectStageRow[]) ?? []).map(mapStageRow);
  }
}

export class SupabaseProjectTagRepository implements ProjectTagRepository {
  constructor(private organizationId: string) {}

  async createTag(name: string): Promise<ProjectTag> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from('project_tags')
      .insert({ organization_id: this.organizationId, name: name.trim() })
      .select()
      .single();
    assertNoError(error);
    return mapTagRow(data as ProjectTagRow);
  }

  async deleteTag(id: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase.from('project_tags').delete().eq('id', id);
    assertNoError(error);
  }

  async listTags(): Promise<ProjectTag[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.from('project_tags').select('*').eq('organization_id', this.organizationId);
    assertNoError(error);
    return ((data as ProjectTagRow[]) ?? []).map(mapTagRow);
  }
}

export class SupabaseProjectHistoryRepository implements ProjectHistoryRepository {
  constructor(private organizationId: string) {}

  async addEntry(entry: Omit<ProjectHistoryEntry, 'id'>): Promise<ProjectHistoryEntry> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from('project_history')
      .insert({
        organization_id: this.organizationId,
        project_id: entry.projectId,
        from_stage_id: entry.fromStageId,
        to_stage_id: entry.toStageId,
        created_at: entry.timestamp,
      })
      .select()
      .single();
    assertNoError(error);
    return mapHistoryRow(data as ProjectHistoryRow);
  }

  async listByProject(projectId: string): Promise<ProjectHistoryEntry[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from('project_history')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    assertNoError(error);
    return ((data as ProjectHistoryRow[]) ?? []).map(mapHistoryRow);
  }
}
