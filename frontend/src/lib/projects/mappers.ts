import { ChecklistItem, Project, ProjectHistoryEntry, ProjectStage, ProjectTag } from './types';

export interface ProjectRow {
  id: string;
  organization_id: string;
  client_id: string | null;
  stage_id: string;
  name: string;
  project_type: string | null;
  contract_value_cents: number;
  position: number;
  priority: string;
  start_date: string | null;
  due_date: string | null;
  waiting_for_client: boolean;
  waiting_since: string | null;
  approval_status: string;
  responsible_user_id: string | null;
  responsible_name: string | null;
  next_action: string | null;
  notes: string | null;
  stage_entered_at: string;
  archived_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectTaskRow {
  id: string;
  project_id: string;
  title: string;
  completed: boolean;
  position: number;
  created_at: string;
}

export interface ProjectStageRow {
  id: string;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectTagRow {
  id: string;
  name: string;
  created_at: string;
}

export interface ProjectHistoryRow {
  id: string;
  project_id: string;
  from_stage_id: string | null;
  to_stage_id: string | null;
  created_at: string;
}

/** Merges the base row with its (already-fetched) checklist items and tag
 * ids — Project.checklist/tagIds stay embedded on the object per the
 * existing ProjectRepository contract, even though they're now normalized
 * tables (project_tasks, project_tag_links) behind the scenes. */
export function mapProjectRow(row: ProjectRow, checklist: ChecklistItem[], tagIds: string[]): Project {
  return {
    id: row.id,
    userId: null,
    organizationId: row.organization_id,
    name: row.name,
    clientId: row.client_id,
    projectType: row.project_type,
    stageId: row.stage_id,
    order: row.position,
    stageEnteredAt: row.stage_entered_at,
    priority: row.priority as Project['priority'],
    startDate: row.start_date,
    dueDate: row.due_date,
    contractValueCents: row.contract_value_cents,
    waitingForClient: row.waiting_for_client,
    waitingSince: row.waiting_since,
    approvalStatus: row.approval_status as Project['approvalStatus'],
    responsibleId: row.responsible_user_id,
    responsibleName: row.responsible_name,
    nextAction: row.next_action,
    notes: row.notes,
    tagIds,
    checklist,
    attachmentIds: [],
    archivedAt: row.archived_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapTaskRow(row: ProjectTaskRow): ChecklistItem {
  return { id: row.id, title: row.title, completed: row.completed, order: row.position, createdAt: row.created_at };
}

export function mapStageRow(row: ProjectStageRow): ProjectStage {
  return { id: row.id, name: row.name, order: row.position, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function mapTagRow(row: ProjectTagRow): ProjectTag {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

export function mapHistoryRow(row: ProjectHistoryRow): ProjectHistoryEntry {
  return { id: row.id, projectId: row.project_id, fromStageId: row.from_stage_id, toStageId: row.to_stage_id ?? '', timestamp: row.created_at };
}
