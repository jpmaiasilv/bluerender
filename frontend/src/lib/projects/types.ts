// --- Fluxo de Projetos: core domain types ---
//
// Mirrors the same conventions as lib/financial/types.ts: money in integer
// cents, dates as date-only "YYYY-MM-DD" strings (never Date/UTC timestamps
// for anything the user reasons about locally), userId/organizationId
// present but unused (LOCAL_USER_ID placeholder) until real auth exists.

export type ProjectPriority = 'low' | 'normal' | 'high' | 'urgent';

export const PROJECT_PRIORITIES: ProjectPriority[] = ['low', 'normal', 'high', 'urgent'];

/** Independent of due-date status — a project can be "on time" AND
 * "awaiting approval" simultaneously. */
export type ApprovalStatus = 'none' | 'awaitingApproval' | 'changesRequested' | 'approved';

/** Derived, never stored directly (except 'completed', which mirrors
 * completedAt being set) — see deriveDueStatus() in dates.ts. */
export type DueStatus = 'onTrack' | 'dueSoon' | 'dueToday' | 'overdue' | 'completed';

export interface ProjectStage {
  id: string;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistItem {
  id: string;
  title: string;
  completed: boolean;
  order: number;
  createdAt: string;
}

export interface ProjectTag {
  id: string;
  name: string;
  createdAt: string;
}

export interface ProjectHistoryEntry {
  id: string;
  projectId: string;
  fromStageId: string | null;
  toStageId: string;
  timestamp: string;
}

export interface Project {
  id: string;
  /** Prepared for a future auth/Supabase migration — see financial/localIdentity.ts's LOCAL_USER_ID, reused here. */
  userId: string | null;
  organizationId: string | null;

  name: string;
  /** Optional — no real Clients module exists yet, never fabricated. */
  clientId: string | null;
  /** Free text for now (no real project-type catalog module yet). */
  projectType: string | null;

  stageId: string;
  /** Position within its stage, for manual reordering — lower sorts first. */
  order: number;
  stageEnteredAt: string;

  priority: ProjectPriority;

  startDate: string | null;
  dueDate: string | null;

  /** Total contracted value — the ONLY money this module stores. Received /
   * receivable are always computed from FinancialTransaction records tagged
   * with this project's id (see financialIntegration.ts), never duplicated
   * here. */
  contractValueCents: number;

  waitingForClient: boolean;
  waitingSince: string | null;

  approvalStatus: ApprovalStatus;

  /** Prepared for a real team/users module — today just an optional local
   * label, never a fabricated "fake team member". */
  responsibleId: string | null;
  responsibleName: string | null;

  nextAction: string | null;
  notes: string | null;

  tagIds: string[];
  /** Embedded rather than a separate store — simple enough at this scale
   * (a handful of items per project) that a join would add complexity
   * without benefit; the repository interface is what a future Supabase
   * table swap depends on, not this in-memory shape. */
  checklist: ChecklistItem[];

  attachmentIds: string[];

  archivedAt: string | null;
  completedAt: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface ProjectInput {
  name: string;
  clientId: string | null;
  projectType: string | null;
  stageId: string;
  priority: ProjectPriority;
  startDate: string | null;
  dueDate: string | null;
  contractValueCents: number;
  responsibleId: string | null;
  responsibleName: string | null;
  nextAction: string | null;
  notes: string | null;
  tagIds: string[];
}

export interface ProjectFilter {
  stageId?: string;
  priority?: ProjectPriority;
  clientId?: string;
  responsibleId?: string;
  includeArchived?: boolean;
}

/** Financial figures for a project — always computed from FinancialService,
 * never stored on the Project itself (see financialIntegration.ts). */
export interface ProjectFinancials {
  receivedCents: number;
  receivableCents: number;
  expenseCents: number;
  resultCents: number;
}
