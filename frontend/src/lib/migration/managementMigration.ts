// Controlled, one-time IndexedDB -> Supabase upload for Financeiro + Fluxo
// de Projetos. Never deletes IndexedDB data. Never runs automatically without
// the user confirming (see useManagementMigration.ts / ManagementSyncBanner).
//
// Core idea: local ids are already crypto.randomUUID() (see the original
// IndexedDB repositories), so most entities preserve their id 1:1 into
// Supabase and re-running this is naturally idempotent via
// upsert(..., { ignoreDuplicates: true }). The two exceptions are
// project_stages and financial_categories: their local "default" rows were
// seeded independently on each device (different random ids for the same
// six/eighteen names), while the org's remote defaults were seeded once by
// ensure_default_project_stages/ensure_default_financial_categories — so
// those two need name-matching + an id remap instead of straight id
// preservation. Clients never existed locally at all (Project/Transaction
// "clientId" was free text), so they're always matched/created by name.

import { requireSupabase } from '../supabaseRepositoryHelpers';
import {
  IndexedDbProjectHistoryRepository,
  IndexedDbProjectRepository,
  IndexedDbProjectStageRepository,
  IndexedDbProjectTagRepository,
} from '../projects/indexedDbRepository';
import { IndexedDbCategoryRepository, IndexedDbFinancialRepository } from '../financial/indexedDbRepository';
import { Project, ProjectHistoryEntry, ProjectStage, ProjectTag } from '../projects/types';
import { FinancialCategory, FinancialTransaction, RecurrenceRule } from '../financial/types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export interface MigrationPreview {
  hasLocalData: boolean;
  projectsCount: number;
  stagesCount: number;
  tasksCount: number;
  tagsCount: number;
  transactionsCount: number;
  categoriesCount: number;
  recurrencesCount: number;
}

export interface MigrationResult {
  ok: boolean;
  preview: MigrationPreview;
  clientsCreated: number;
  errors: string[];
}

async function gatherLocalData() {
  const projectRepo = new IndexedDbProjectRepository();
  const stageRepo = new IndexedDbProjectStageRepository();
  const tagRepo = new IndexedDbProjectTagRepository();
  const historyRepo = new IndexedDbProjectHistoryRepository();
  const financialRepo = new IndexedDbFinancialRepository();
  const categoryRepo = new IndexedDbCategoryRepository();

  const [projects, stages, tags, transactions, categories] = await Promise.all([
    projectRepo.listProjects({ includeArchived: true }),
    stageRepo.listStages(),
    tagRepo.listTags(),
    financialRepo.listTransactions(),
    categoryRepo.listCategories(),
  ]);

  const historyByProject = new Map<string, ProjectHistoryEntry[]>();
  for (const project of projects) {
    historyByProject.set(project.id, await historyRepo.listByProject(project.id));
  }

  const recurrenceIds = new Set<string>();
  for (const tx of transactions) {
    if (tx.recurrenceRuleId) recurrenceIds.add(tx.recurrenceRuleId);
  }
  const recurrences: RecurrenceRule[] = [];
  for (const id of recurrenceIds) {
    const rule = await financialRepo.getRecurrenceRule(id);
    if (rule) recurrences.push(rule);
  }

  return { projects, stages, tags, transactions, categories, historyByProject, recurrences };
}

export async function previewLocalManagementData(): Promise<MigrationPreview> {
  const { projects, stages, tags, transactions, categories, historyByProject, recurrences } = await gatherLocalData();
  const tasksCount = projects.reduce((sum, p) => sum + p.checklist.length, 0);
  const hasLocalData = projects.length > 0 || transactions.length > 0;
  return {
    hasLocalData,
    projectsCount: projects.length,
    stagesCount: stages.length,
    tasksCount,
    tagsCount: tags.length,
    transactionsCount: transactions.length,
    categoriesCount: categories.length,
    recurrencesCount: recurrences.length,
  };
}

/** Matches each local (name[, type]) row against what already exists
 * remotely for this org; unmatched rows are inserted preserving their local
 * id. Returns a localId -> remoteId map (identity for freshly-inserted rows). */
async function reconcileByName<T extends { id: string; name: string }>(
  table: string,
  organizationId: string,
  localRows: T[],
  remoteRows: Array<{ id: string; name: string }>,
  buildInsertRow: (row: T) => Record<string, unknown>,
  extraKey?: (row: { name: string } & Record<string, unknown>) => string
): Promise<Map<string, string>> {
  const supabase = requireSupabase();
  const idMap = new Map<string, string>();
  const remoteByKey = new Map<string, string>();
  for (const r of remoteRows) {
    const key = extraKey ? extraKey(r) : normalizeName(r.name);
    remoteByKey.set(key, r.id);
  }

  const toInsert: T[] = [];
  for (const local of localRows) {
    const key = extraKey ? extraKey(local as unknown as { name: string } & Record<string, unknown>) : normalizeName(local.name);
    const existingId = remoteByKey.get(key);
    if (existingId) {
      idMap.set(local.id, existingId);
    } else {
      toInsert.push(local);
      idMap.set(local.id, local.id);
      remoteByKey.set(key, local.id);
    }
  }

  if (toInsert.length > 0) {
    const { error } = await supabase
      .from(table)
      .upsert(
        toInsert.map((row) => ({ id: row.id, organization_id: organizationId, ...buildInsertRow(row) })),
        { onConflict: 'id', ignoreDuplicates: true }
      );
    if (error) throw new Error(`${table}: ${error.message}`);
  }

  return idMap;
}

export async function runManagementMigration(organizationId: string): Promise<MigrationResult> {
  const supabase = requireSupabase();
  const errors: string[] = [];
  const { projects, stages, tags, transactions, categories, historyByProject, recurrences } = await gatherLocalData();
  const preview: MigrationPreview = {
    hasLocalData: projects.length > 0 || transactions.length > 0,
    projectsCount: projects.length,
    stagesCount: stages.length,
    tasksCount: projects.reduce((sum, p) => sum + p.checklist.length, 0),
    tagsCount: tags.length,
    transactionsCount: transactions.length,
    categoriesCount: categories.length,
    recurrencesCount: recurrences.length,
  };

  if (!preview.hasLocalData) {
    return { ok: true, preview, clientsCreated: 0, errors: [] };
  }

  // --- 1. Stages (name-matched) ---
  const { data: remoteStages } = await supabase.from('project_stages').select('id, name').eq('organization_id', organizationId);
  const stageIdMap = await reconcileByName<ProjectStage>(
    'project_stages',
    organizationId,
    stages,
    (remoteStages as { id: string; name: string }[]) ?? [],
    (s) => ({ name: s.name, position: s.order })
  );

  // --- 2. Clients (collected from free-text Project/Transaction clientId, name-matched) ---
  const localClientNames = new Set<string>();
  for (const p of projects) if (p.clientId?.trim()) localClientNames.add(p.clientId.trim());
  for (const tx of transactions) if (tx.clientId?.trim()) localClientNames.add(tx.clientId.trim());

  const { data: remoteClients } = await supabase.from('clients').select('id, name').eq('organization_id', organizationId);
  const clientNameToId = new Map<string, string>();
  for (const c of (remoteClients as { id: string; name: string }[]) ?? []) clientNameToId.set(normalizeName(c.name), c.id);

  const clientsToCreate = [...localClientNames].filter((name) => !clientNameToId.has(normalizeName(name)));
  if (clientsToCreate.length > 0) {
    const { data: createdClients, error } = await supabase
      .from('clients')
      .insert(clientsToCreate.map((name) => ({ organization_id: organizationId, name })))
      .select('id, name');
    if (error) errors.push(`clients: ${error.message}`);
    for (const c of (createdClients as { id: string; name: string }[]) ?? []) clientNameToId.set(normalizeName(c.name), c.id);
  }
  const resolveClientId = (text: string | null): string | null => {
    if (!text?.trim()) return null;
    return clientNameToId.get(normalizeName(text)) ?? null;
  };

  // --- 3. Projects (id-preserved) ---
  const localProjectIds = new Set(projects.map((p) => p.id));
  if (projects.length > 0) {
    const { error } = await supabase.from('projects').upsert(
      projects.map((p) => ({
        id: p.id,
        organization_id: organizationId,
        client_id: resolveClientId(p.clientId),
        stage_id: stageIdMap.get(p.stageId) ?? p.stageId,
        name: p.name,
        project_type: p.projectType,
        contract_value_cents: p.contractValueCents,
        position: p.order,
        priority: p.priority,
        start_date: p.startDate,
        due_date: p.dueDate,
        waiting_for_client: p.waitingForClient,
        waiting_since: p.waitingSince,
        approval_status: p.approvalStatus,
        responsible_name: p.responsibleName,
        next_action: p.nextAction,
        notes: p.notes,
        stage_entered_at: p.stageEnteredAt,
        archived_at: p.archivedAt,
        completed_at: p.completedAt,
        created_at: p.createdAt,
        updated_at: p.updatedAt,
      })),
      { onConflict: 'id', ignoreDuplicates: true }
    );
    if (error) errors.push(`projects: ${error.message}`);
  }

  // --- 4. Tags (name-matched) ---
  const { data: remoteTags } = await supabase.from('project_tags').select('id, name').eq('organization_id', organizationId);
  const tagIdMap = await reconcileByName<ProjectTag>(
    'project_tags',
    organizationId,
    tags,
    (remoteTags as { id: string; name: string }[]) ?? [],
    (tg) => ({ name: tg.name })
  );

  // --- 5. project_tag_links + 6. project_tasks (checklist) ---
  const tagLinkRows: Record<string, unknown>[] = [];
  const taskRows: Record<string, unknown>[] = [];
  for (const p of projects) {
    for (const tagId of p.tagIds) {
      const mapped = tagIdMap.get(tagId);
      if (mapped) tagLinkRows.push({ project_id: p.id, tag_id: mapped, organization_id: organizationId });
    }
    for (const item of p.checklist) {
      taskRows.push({
        id: item.id,
        organization_id: organizationId,
        project_id: p.id,
        title: item.title,
        completed: item.completed,
        position: item.order,
        created_at: item.createdAt,
      });
    }
  }
  if (tagLinkRows.length > 0) {
    const { error } = await supabase.from('project_tag_links').upsert(tagLinkRows, { onConflict: 'project_id,tag_id', ignoreDuplicates: true });
    if (error) errors.push(`project_tag_links: ${error.message}`);
  }
  if (taskRows.length > 0) {
    const { error } = await supabase.from('project_tasks').upsert(taskRows, { onConflict: 'id', ignoreDuplicates: true });
    if (error) errors.push(`project_tasks: ${error.message}`);
  }

  // --- 7. project_history ---
  const historyRows: Record<string, unknown>[] = [];
  for (const [projectId, entries] of historyByProject) {
    for (const entry of entries) {
      historyRows.push({
        id: entry.id,
        organization_id: organizationId,
        project_id: projectId,
        from_stage_id: entry.fromStageId ? (stageIdMap.get(entry.fromStageId) ?? null) : null,
        to_stage_id: entry.toStageId ? (stageIdMap.get(entry.toStageId) ?? null) : null,
        created_at: entry.timestamp,
      });
    }
  }
  if (historyRows.length > 0) {
    const { error } = await supabase.from('project_history').upsert(historyRows, { onConflict: 'id', ignoreDuplicates: true });
    if (error) errors.push(`project_history: ${error.message}`);
  }

  // --- 8. financial_categories (name+type matched) ---
  const { data: remoteCategories } = await supabase.from('financial_categories').select('id, name, type').eq('organization_id', organizationId);
  const categoryIdMap = await reconcileByName<FinancialCategory>(
    'financial_categories',
    organizationId,
    categories,
    (remoteCategories as { id: string; name: string; type: string }[]) ?? [],
    (c) => ({ name: c.name, type: c.type, is_default: false }),
    (row) => `${normalizeName(row.name)}::${row.type}`
  );

  // --- 9. financial_recurrences (id-preserved) ---
  if (recurrences.length > 0) {
    const { error } = await supabase.from('financial_recurrences').upsert(
      recurrences.map((r) => ({
        id: r.id,
        organization_id: organizationId,
        frequency: r.frequency,
        recurrence_interval: r.interval,
        start_date: r.startDate,
        end_date: r.endDate,
        created_at: r.createdAt,
      })),
      { onConflict: 'id', ignoreDuplicates: true }
    );
    if (error) errors.push(`financial_recurrences: ${error.message}`);
  }
  const recurrenceIdSet = new Set(recurrences.map((r) => r.id));

  // --- 10. financial_transactions (id-preserved; project_id only kept when it's a real local project id) ---
  if (transactions.length > 0) {
    const rows = transactions.map((tx: FinancialTransaction) => {
      const rawProjectId = tx.projectId;
      const validProjectLink = rawProjectId != null && isValidUuid(rawProjectId) && localProjectIds.has(rawProjectId);
      const legacyProjectText = rawProjectId && !validProjectLink ? rawProjectId : null;
      const notes = legacyProjectText
        ? `${tx.notes ? tx.notes + '\n\n' : ''}[Projeto (texto legado): ${legacyProjectText}]`
        : tx.notes;

      return {
        id: tx.id,
        organization_id: organizationId,
        type: tx.type,
        description: tx.description,
        amount_cents: tx.amountCents,
        category_id: categoryIdMap.get(tx.categoryId) ?? tx.categoryId,
        transaction_date: tx.transactionDate,
        due_date: tx.dueDate,
        settled_date: tx.settledDate,
        settled: tx.settled,
        project_id: validProjectLink ? rawProjectId : null,
        client_id: resolveClientId(tx.clientId),
        recurrence_id: tx.recurrenceRuleId && recurrenceIdSet.has(tx.recurrenceRuleId) ? tx.recurrenceRuleId : null,
        payment_method: tx.paymentMethod,
        payment_method_note: tx.paymentMethodNote,
        notes,
        created_at: tx.createdAt,
        updated_at: tx.updatedAt,
      };
    });
    const { error } = await supabase.from('financial_transactions').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    if (error) errors.push(`financial_transactions: ${error.message}`);
  }

  // --- Verify: every local project/transaction id we attempted must now exist remotely ---
  if (projects.length > 0) {
    const { data: verifyProjects } = await supabase.from('projects').select('id').eq('organization_id', organizationId).in('id', [...localProjectIds]);
    const foundIds = new Set(((verifyProjects as { id: string }[]) ?? []).map((r) => r.id));
    const missing = [...localProjectIds].filter((id) => !foundIds.has(id));
    if (missing.length > 0) errors.push(`${missing.length} project(s) failed to verify remotely`);
  }
  if (transactions.length > 0) {
    const localTxIds = transactions.map((t) => t.id);
    const { data: verifyTx } = await supabase.from('financial_transactions').select('id').eq('organization_id', organizationId).in('id', localTxIds);
    const foundIds = new Set(((verifyTx as { id: string }[]) ?? []).map((r) => r.id));
    const missing = localTxIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) errors.push(`${missing.length} transaction(s) failed to verify remotely`);
  }

  return { ok: errors.length === 0, preview, clientsCreated: clientsToCreate.length, errors };
}
