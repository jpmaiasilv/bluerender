import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { useFinancialData } from '../../lib/financial/useFinancialData';
import { useClientsData } from '../../lib/clients/useClientsData';
import { useProjectsPicker } from '../../lib/projects/useProjectsPicker';
import { formatMoneyCents } from '../../lib/financial/money';
import { FinancialTransaction } from '../../lib/financial/types';
import { Project } from '../../lib/projects/types';
import { TransactionFormModal, TransactionFormInitial } from '../financial/TransactionFormModal';
import { ConfirmDeleteModal } from '../financial/ConfirmDeleteModal';
import { TransactionsTable } from '../financial/TransactionsTable';
import { FinancialAttachmentInfo } from '../../lib/financial/useFinancialData';

interface Props {
  organizationId: string | null;
  project: Project;
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' }) {
  const toneClass = tone === 'positive' ? 'text-success' : tone === 'negative' ? 'text-danger' : 'text-ink';
  return (
    <div className="rounded-lg border border-border bg-surface-secondary p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={`mt-1 text-base font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

export function ProjectFinancialTab({ organizationId, project }: Props) {
  const { messages, locale } = useLanguage();
  const t = messages.projectFinancialTab;

  const {
    transactions: allTransactions,
    categories,
    loading,
    createTransaction,
    updateTransaction,
    deleteTransaction,
    deleteInstallmentGroupFrom,
    duplicateTransaction,
    markSettled,
    createCategory,
    uploadAttachment,
    getAttachment,
  } = useFinancialData(organizationId);
  const { clients, createClient } = useClientsData(organizationId);
  const projects = useProjectsPicker(organizationId);

  const [formOpen, setFormOpen] = useState(false);
  const [formInitial, setFormInitial] = useState<TransactionFormInitial | null>(null);
  const [attachmentInfo, setAttachmentInfo] = useState<FinancialAttachmentInfo | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FinancialTransaction | null>(null);

  const transactions = useMemo(() => allTransactions.filter((tx) => tx.projectId === project.id), [allTransactions, project.id]);
  const sorted = useMemo(
    () => [...transactions].sort((a, b) => (a.transactionDate < b.transactionDate ? 1 : a.transactionDate > b.transactionDate ? -1 : 0)),
    [transactions]
  );
  const installments = useMemo(() => sorted.filter((tx) => tx.installmentGroupId), [sorted]);
  const expenses = useMemo(() => sorted.filter((tx) => tx.type === 'expense'), [sorted]);

  const receivedCents = transactions.filter((t) => t.type === 'income' && t.settled).reduce((s, t) => s + t.amountCents, 0);
  const receivableCents = transactions.filter((t) => t.type === 'income' && !t.settled).reduce((s, t) => s + t.amountCents, 0);
  const expensesSettledCents = transactions.filter((t) => t.type === 'expense' && t.settled).reduce((s, t) => s + t.amountCents, 0);
  const payableCents = transactions.filter((t) => t.type === 'expense' && !t.settled).reduce((s, t) => s + t.amountCents, 0);
  const resultRealizedCents = receivedCents - expensesSettledCents;
  const resultForecastCents = receivedCents + receivableCents - expensesSettledCents - payableCents;
  const marginPercent = project.contractValueCents > 0 ? (resultRealizedCents / project.contractValueCents) * 100 : null;

  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? '';
  const clientName = (id: string | null) => (id ? (clients.find((c) => c.id === id)?.name ?? '') : '');
  const projectName = (id: string | null) => (id ? (projects.find((p) => p.id === id)?.name ?? '') : '');

  function openNewForm() {
    setAttachmentInfo(null);
    setFormInitial({ defaultType: 'income', defaultClientId: project.clientId, defaultProjectId: project.id });
    setFormOpen(true);
  }

  async function openEditForm(tx: FinancialTransaction) {
    setFormInitial({ transaction: tx });
    setAttachmentInfo(tx.attachmentFileId ? await getAttachment(tx.attachmentFileId) : null);
    setFormOpen(true);
  }

  async function handleDuplicate(tx: FinancialTransaction) {
    const copy = await duplicateTransaction(tx);
    void openEditForm(copy);
  }

  if (loading) {
    return <p className="px-6 py-8 text-center text-sm text-ink-muted">…</p>;
  }

  return (
    <div className="flex flex-col gap-5 px-6 py-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatCard label={t.contractValue} value={formatMoneyCents(project.contractValueCents, locale)} />
        <StatCard label={t.received} value={formatMoneyCents(receivedCents, locale)} tone="positive" />
        <StatCard label={t.receivable} value={formatMoneyCents(receivableCents, locale)} />
        <StatCard label={t.expenses} value={formatMoneyCents(expensesSettledCents, locale)} tone="negative" />
        <StatCard label={t.resultRealized} value={formatMoneyCents(resultRealizedCents, locale)} tone={resultRealizedCents >= 0 ? 'positive' : 'negative'} />
        <StatCard label={t.resultForecast} value={formatMoneyCents(resultForecastCents, locale)} tone={resultForecastCents >= 0 ? 'positive' : 'negative'} />
        {marginPercent !== null && <StatCard label={t.margin} value={`${marginPercent.toFixed(1)}%`} />}
      </div>

      <button
        type="button"
        onClick={openNewForm}
        className="flex w-fit items-center gap-1.5 rounded-lg bg-sapphire px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:bg-sapphire-hover"
      >
        <Plus size={15} />
        {t.addButton}
      </button>

      {sorted.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-muted">{t.empty}</p>
      ) : (
        <>
          {installments.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t.installmentsTitle}</h3>
              <TransactionsTable
                transactions={installments}
                categoryName={categoryName}
                clientName={clientName}
                projectName={projectName}
                onEdit={(tx) => void openEditForm(tx)}
                onDuplicate={(tx) => void handleDuplicate(tx)}
                onDelete={setDeleteTarget}
                onToggleSettled={(tx) => void markSettled(tx.id)}
              />
            </div>
          )}

          {expenses.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t.expensesTitle}</h3>
              <TransactionsTable
                transactions={expenses}
                categoryName={categoryName}
                clientName={clientName}
                projectName={projectName}
                onEdit={(tx) => void openEditForm(tx)}
                onDuplicate={(tx) => void handleDuplicate(tx)}
                onDelete={setDeleteTarget}
                onToggleSettled={(tx) => void markSettled(tx.id)}
              />
            </div>
          )}

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t.recentTitle}</h3>
            <TransactionsTable
              transactions={sorted}
              categoryName={categoryName}
              clientName={clientName}
              projectName={projectName}
              onEdit={(tx) => void openEditForm(tx)}
              onDuplicate={(tx) => void handleDuplicate(tx)}
              onDelete={setDeleteTarget}
              onToggleSettled={(tx) => void markSettled(tx.id)}
            />
          </div>
        </>
      )}

      <TransactionFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        categories={categories}
        clients={clients}
        projects={projects}
        initial={formInitial}
        initialAttachment={attachmentInfo}
        onSubmit={async (input, recurrence, installment) => {
          if (formInitial?.transaction) {
            await updateTransaction(formInitial.transaction.id, input);
          } else {
            await createTransaction(input, recurrence, installment);
          }
        }}
        onCreateCategory={createCategory}
        onCreateClient={(name) => createClient({ name, company: null, email: null, phone: null, address: null, notes: null })}
        onUploadAttachment={(file, fileProjectId) => uploadAttachment(file, fileProjectId)}
      />

      <ConfirmDeleteModal
        transaction={deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirmSingle={async () => {
          if (deleteTarget) await deleteTransaction(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onConfirmAllFuture={async () => {
          if (deleteTarget?.installmentGroupId && deleteTarget.installmentNumber) {
            await deleteInstallmentGroupFrom(deleteTarget.installmentGroupId, deleteTarget.installmentNumber);
          }
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
