import { useMemo, useState } from 'react';
import { Download, Users, X } from 'lucide-react';
import { ToolLayout } from '../components/ToolLayout';
import { FiltersBar } from '../components/financial/FiltersBar';
import { AdvancedFiltersPanel, AdvancedFilters, BLANK_ADVANCED_FILTERS } from '../components/financial/AdvancedFiltersPanel';
import { SummaryCards } from '../components/financial/SummaryCards';
import { CashflowChart } from '../components/financial/CashflowChart';
import { CategoryBreakdownChart } from '../components/financial/CategoryBreakdownChart';
import { UpcomingDueDates } from '../components/financial/UpcomingDueDates';
import { TransactionsTable } from '../components/financial/TransactionsTable';
import { TransactionFormModal, TransactionFormInitial } from '../components/financial/TransactionFormModal';
import { ConfirmDeleteModal } from '../components/financial/ConfirmDeleteModal';
import { ClientsModal } from '../components/financial/ClientsModal';
import { useLanguage } from '../i18n';
import { useAuth } from '../lib/auth/AuthProvider';
import { useFinancialData } from '../lib/financial/useFinancialData';
import { useClientsData } from '../lib/clients/useClientsData';
import { useProjectsPicker } from '../lib/projects/useProjectsPicker';
import { PeriodPreset, PeriodRange, rangeForPreset, todayISO } from '../lib/financial/dates';
import {
  balance,
  categoryBreakdown,
  dueWithinDays,
  forecastBalance,
  granularityForRange,
  overdueTransactions,
  payable,
  receivable,
  totalExpense,
  totalIncome,
  upcomingDueDates,
} from '../lib/financial/calculations';
import { downloadCsv, transactionsToCsv } from '../lib/financial/csvExport';
import { formatMoneyCents, parseAmountToCents } from '../lib/financial/money';
import { deriveStatus, FinancialTransaction, periodDateOf, TransactionType } from '../lib/financial/types';
import { FinancialAttachmentInfo } from '../lib/financial/useFinancialData';

type StatusFocus = 'receivable' | 'payable' | 'overdueReceivable' | 'overduePayable' | null;

export function FinancialPage() {
  const { messages, locale } = useLanguage();
  const t = messages.financial;
  const { currentOrganization } = useAuth();
  const {
    transactions,
    categories,
    loading,
    error,
    createTransaction,
    updateTransaction,
    deleteTransaction,
    deleteInstallmentGroupFrom,
    duplicateTransaction,
    markSettled,
    createCategory,
    uploadAttachment,
    getAttachment,
  } = useFinancialData(currentOrganization?.id ?? null);
  const { clients, createClient, updateClient, deleteClient } = useClientsData(currentOrganization?.id ?? null);
  const projects = useProjectsPicker(currentOrganization?.id ?? null);

  const [preset, setPreset] = useState<PeriodPreset>('thisMonth');
  const [range, setRange] = useState<PeriodRange>(() => rangeForPreset('thisMonth'));
  const [typeFilter, setTypeFilter] = useState<TransactionType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>(BLANK_ADVANCED_FILTERS);
  const [statusFocus, setStatusFocus] = useState<StatusFocus>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [formInitial, setFormInitial] = useState<TransactionFormInitial | null>(null);
  const [attachmentInfo, setAttachmentInfo] = useState<FinancialAttachmentInfo | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FinancialTransaction | null>(null);
  const [clientsModalOpen, setClientsModalOpen] = useState(false);

  const today = todayISO();

  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? '';
  const clientName = (id: string | null) => (id ? (clients.find((c) => c.id === id)?.name ?? '') : '');
  const projectName = (id: string | null) => (id ? (projects.find((p) => p.id === id)?.name ?? '') : '');

  const periodTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      const d = periodDateOf(tx);
      if (d < range.start || d > range.end) return false;
      if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
      if (advancedFilters.clientId && tx.clientId !== advancedFilters.clientId) return false;
      if (advancedFilters.projectId && tx.projectId !== advancedFilters.projectId) return false;
      if (advancedFilters.categoryId && tx.categoryId !== advancedFilters.categoryId) return false;
      if (advancedFilters.paymentMethod && tx.paymentMethod !== advancedFilters.paymentMethod) return false;
      if (advancedFilters.status !== 'all' && deriveStatus(tx, today) !== advancedFilters.status) return false;
      if (advancedFilters.valueMin) {
        const min = parseAmountToCents(advancedFilters.valueMin);
        if (tx.amountCents < min) return false;
      }
      if (advancedFilters.valueMax) {
        const max = parseAmountToCents(advancedFilters.valueMax);
        if (tx.amountCents > max) return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const haystack = `${tx.description} ${projectName(tx.projectId)} ${clientName(tx.clientId)} ${categoryName(tx.categoryId)} ${
          tx.notes ?? ''
        }`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [transactions, range, typeFilter, advancedFilters, search, clients, projects, today]);

  // "A receber"/"A pagar" cards and their "em atraso" hints focus the table
  // onto exactly what was clicked — receivable/payable stay period-scoped
  // (matching the card's own value), overdue always looks across every
  // transaction so a stale invoice from a prior period is never hidden.
  const focusedTransactions = useMemo(() => {
    if (statusFocus === 'receivable') return periodTransactions.filter((tx) => tx.type === 'income' && !tx.settled);
    if (statusFocus === 'payable') return periodTransactions.filter((tx) => tx.type === 'expense' && !tx.settled);
    if (statusFocus === 'overdueReceivable') return overdueTransactions(transactions, today).filter((tx) => tx.type === 'income');
    if (statusFocus === 'overduePayable') return overdueTransactions(transactions, today).filter((tx) => tx.type === 'expense');
    return periodTransactions;
  }, [statusFocus, periodTransactions, transactions, today]);

  const sortedTable = useMemo(
    () => [...focusedTransactions].sort((a, b) => (a.transactionDate < b.transactionDate ? 1 : a.transactionDate > b.transactionDate ? -1 : 0)),
    [focusedTransactions]
  );

  const granularity = useMemo(() => granularityForRange(range), [range]);
  const expenseByCategory = useMemo(() => categoryBreakdown(periodTransactions, categories, range, 'expense'), [periodTransactions, categories, range]);
  const upcoming = useMemo(() => upcomingDueDates(transactions, 8, today), [transactions, today]);
  const overdueAll = useMemo(() => overdueTransactions(transactions, today), [transactions, today]);
  const overdueReceivableCents = overdueAll.filter((tx) => tx.type === 'income').reduce((s, tx) => s + tx.amountCents, 0);
  const overduePayableCents = overdueAll.filter((tx) => tx.type === 'expense').reduce((s, tx) => s + tx.amountCents, 0);

  const periodIncomeCents = totalIncome(periodTransactions, range);
  const periodExpenseCents = totalExpense(periodTransactions, range);
  const periodResultCents = periodIncomeCents - periodExpenseCents;
  const periodMarginPercent = periodIncomeCents > 0 ? (periodResultCents / periodIncomeCents) * 100 : null;

  function openNewForm(defaultType: TransactionType) {
    setAttachmentInfo(null);
    setFormInitial({ defaultType });
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

  function handleExportCsv() {
    const csv = transactionsToCsv(sortedTable, categories, today, messages, { clientName, projectName });
    downloadCsv(csv, `financeiro-${today}.csv`);
  }

  const hasAnyTransactions = transactions.length > 0;

  return (
    <ToolLayout
      title={messages.nav.items.financial}
      description={messages.toolDescriptions.financial}
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={sortedTable.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download size={14} />
            {t.exportCsv}
          </button>
          <button
            type="button"
            onClick={() => setClientsModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-ink"
          >
            <Users size={14} />
            {t.clientsButton}
          </button>
          <button
            type="button"
            onClick={() => openNewForm('income')}
            className="rounded-lg bg-sapphire px-4 py-1.5 text-sm font-medium text-white transition hover:bg-sapphire-hover"
          >
            {t.newTransaction}
          </button>
        </div>
      }
    >
      <FiltersBar
        preset={preset}
        range={range}
        onPresetChange={(p, r) => {
          setPreset(p);
          setRange(r);
        }}
        onCustomRangeChange={setRange}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        search={search}
        onSearchChange={setSearch}
        extraControls={
          <AdvancedFiltersPanel value={advancedFilters} onChange={setAdvancedFilters} clients={clients} projects={projects} categories={categories} />
        }
      />

      <div className="flex-1 overflow-y-auto px-6 py-6 lg:px-8">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-sapphire border-t-transparent" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-danger/30 bg-danger/5 py-20 text-center">
            <p className="text-sm text-danger">{messages.settings.errorLoading}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-ink"
            >
              {messages.settings.tryAgain}
            </button>
          </div>
        ) : !hasAnyTransactions ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-surface-secondary/60 py-20 text-center">
            <p className="text-sm text-ink-secondary">{t.emptyState.title}</p>
            <button
              type="button"
              onClick={() => openNewForm('income')}
              className="rounded-lg bg-sapphire px-4 py-2 text-sm font-medium text-white transition hover:bg-sapphire-hover"
            >
              {t.emptyState.addFirst}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <SummaryCards
              balanceCents={balance(periodTransactions, range)}
              incomeCents={periodIncomeCents}
              expenseCents={periodExpenseCents}
              receivableCents={receivable(periodTransactions, range)}
              payableCents={payable(periodTransactions, range)}
              forecastCents={forecastBalance(transactions)}
              receivableNext30Cents={dueWithinDays(transactions, 'income', 30, today)}
              payableNext30Cents={dueWithinDays(transactions, 'expense', 30, today)}
              overdueReceivableCents={overdueReceivableCents}
              overduePayableCents={overduePayableCents}
              onFocusReceivable={() => setStatusFocus('receivable')}
              onFocusPayable={() => setStatusFocus('payable')}
              onFocusOverdueReceivable={() => setStatusFocus('overdueReceivable')}
              onFocusOverduePayable={() => setStatusFocus('overduePayable')}
            />

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4 shadow-card">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{t.resultSummary.title}</p>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                <span className="text-ink-secondary">
                  {t.resultSummary.income}: <span className="font-semibold text-success">{formatMoneyCents(periodIncomeCents, locale)}</span>
                </span>
                <span className="text-ink-secondary">
                  {t.resultSummary.expense}: <span className="font-semibold text-danger">{formatMoneyCents(periodExpenseCents, locale)}</span>
                </span>
                <span className="text-ink-secondary">
                  {t.resultSummary.result}:{' '}
                  <span className={`font-semibold ${periodResultCents >= 0 ? 'text-success' : 'text-danger'}`}>
                    {formatMoneyCents(periodResultCents, locale)}
                  </span>
                </span>
                {periodMarginPercent !== null && (
                  <span className="text-ink-secondary">
                    {t.resultSummary.margin}: <span className="font-semibold text-ink">{periodMarginPercent.toFixed(1)}%</span>
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <div className="xl:col-span-2">
                <CashflowChart transactions={periodTransactions} range={range} granularity={granularity} />
              </div>
              <CategoryBreakdownChart items={expenseByCategory} />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="lg:col-span-1">
                <UpcomingDueDates items={upcoming} categoryName={categoryName} clientName={clientName} projectName={projectName} onMarkSettled={(tx) => void markSettled(tx.id)} />
              </div>
              <div className="rounded-xl border border-border bg-surface p-4 shadow-card lg:col-span-2">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink">{t.table.title}</h3>
                  {statusFocus && (
                    <button
                      type="button"
                      onClick={() => setStatusFocus(null)}
                      className="flex items-center gap-1 rounded-full bg-sapphire-light px-2.5 py-1 text-xs font-medium text-sapphire hover:bg-sapphire/20"
                    >
                      {
                        {
                          receivable: t.cards.receivable,
                          payable: t.cards.payable,
                          overdueReceivable: `${t.status.overdue} · ${t.cards.receivable}`,
                          overduePayable: `${t.status.overdue} · ${t.cards.payable}`,
                        }[statusFocus]
                      }
                      <X size={12} />
                    </button>
                  )}
                </div>
                <TransactionsTable
                  transactions={sortedTable}
                  categoryName={categoryName}
                  clientName={clientName}
                  projectName={projectName}
                  onEdit={(tx) => void openEditForm(tx)}
                  onDuplicate={(tx) => void handleDuplicate(tx)}
                  onDelete={setDeleteTarget}
                  onToggleSettled={(tx) => void markSettled(tx.id)}
                />
              </div>
            </div>
          </div>
        )}
      </div>

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
        onUploadAttachment={(file, projectId) => uploadAttachment(file, projectId)}
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

      <ClientsModal
        open={clientsModalOpen}
        onClose={() => setClientsModalOpen(false)}
        clients={clients}
        onCreate={createClient}
        onUpdate={updateClient}
        onDelete={deleteClient}
      />
    </ToolLayout>
  );
}
