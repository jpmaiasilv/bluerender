import { useEffect, useRef, useState } from 'react';
import { Loader2, Paperclip, X } from 'lucide-react';
import { Modal } from '../Modal';
import { SelectField } from '../SelectField';
import { useLanguage } from '../../i18n';
import { todayISO } from '../../lib/financial/dates';
import { centsToAmountString, parseAmountToCents } from '../../lib/financial/money';
import { RecurrenceInput } from '../../lib/financial/service';
import {
  FinancialCategory,
  FinancialTransaction,
  InstallmentInput,
  PAYMENT_METHODS,
  PaymentMethod,
  TransactionInput,
  TransactionType,
} from '../../lib/financial/types';
import { FinancialAttachmentInfo } from '../../lib/financial/useFinancialData';
import { Client } from '../../lib/clients/types';
import { Project } from '../../lib/projects/types';
import { PROJECT_FILE_ACCEPT, MAX_PROJECT_FILE_BYTES, isAllowedProjectFileName } from '../../config/projectFiles';

const NEW_CATEGORY_VALUE = '__new__';
const NEW_CLIENT_VALUE = '__new_client__';
const NO_CLIENT_VALUE = '';
const NO_PROJECT_VALUE = '';

export interface TransactionFormInitial {
  transaction?: FinancialTransaction;
  defaultType?: TransactionType;
  /** Prefills client/project when opened from a client's or obra's own screen. */
  defaultClientId?: string | null;
  defaultProjectId?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  categories: FinancialCategory[];
  clients: Client[];
  projects: Project[];
  initial: TransactionFormInitial | null;
  /** Resolved attachment for `initial.transaction`, if it has one — fetched by the caller (FinancialPage/ProjectFinancialTab) since it owns the async lookup. */
  initialAttachment: FinancialAttachmentInfo | null;
  onSubmit: (input: TransactionInput, recurrence?: RecurrenceInput, installment?: InstallmentInput) => Promise<void>;
  onCreateCategory: (name: string, type: TransactionType) => Promise<FinancialCategory>;
  onCreateClient: (name: string) => Promise<Client>;
  onUploadAttachment: (file: File, projectId: string | null) => Promise<string>;
}

function blankInput(type: TransactionType, categoryId: string, defaults?: TransactionFormInitial | null): TransactionInput {
  const today = todayISO();
  return {
    type,
    description: '',
    amountCents: 0,
    categoryId,
    transactionDate: today,
    dueDate: null,
    settled: true,
    settledDate: today,
    projectId: defaults?.defaultProjectId ?? null,
    clientId: defaults?.defaultClientId ?? null,
    paymentMethod: null,
    paymentMethodNote: null,
    notes: null,
    isRecurring: false,
    recurrenceRuleId: null,
    installmentGroupId: null,
    installmentNumber: null,
    installmentTotal: null,
    attachmentFileId: null,
  };
}

export function TransactionFormModal({
  open,
  onClose,
  categories,
  clients,
  projects,
  initial,
  initialAttachment,
  onSubmit,
  onCreateCategory,
  onCreateClient,
  onUploadAttachment,
}: Props) {
  const { messages } = useLanguage();
  const t = messages.financial.form;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editing = initial?.transaction ?? null;
  const [form, setForm] = useState<TransactionInput>(() => blankInput(initial?.defaultType ?? 'income', ''));
  const [amountText, setAmountText] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [repeatMonthly, setRepeatMonthly] = useState(false);
  const [repeatUntil, setRepeatUntil] = useState('');
  const [installmentOn, setInstallmentOn] = useState(false);
  const [installmentCount, setInstallmentCount] = useState('2');
  const [installmentFirstDueDate, setInstallmentFirstDueDate] = useState(todayISO());
  const [addingClient, setAddingClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [saving, setSaving] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        type: editing.type,
        description: editing.description,
        amountCents: editing.amountCents,
        categoryId: editing.categoryId,
        transactionDate: editing.transactionDate,
        dueDate: editing.dueDate,
        settled: editing.settled,
        settledDate: editing.settledDate,
        projectId: editing.projectId,
        clientId: editing.clientId,
        paymentMethod: editing.paymentMethod,
        paymentMethodNote: editing.paymentMethodNote,
        notes: editing.notes,
        isRecurring: editing.isRecurring,
        recurrenceRuleId: editing.recurrenceRuleId,
        installmentGroupId: editing.installmentGroupId,
        installmentNumber: editing.installmentNumber,
        installmentTotal: editing.installmentTotal,
        attachmentFileId: editing.attachmentFileId,
      });
      setAmountText(centsToAmountString(editing.amountCents));
      setRepeatMonthly(false);
      setInstallmentOn(false);
      setAttachmentName(initialAttachment?.name ?? null);
    } else {
      const type = initial?.defaultType ?? 'income';
      const firstCategory = categories.find((c) => c.type === type)?.id ?? '';
      setForm(blankInput(type, firstCategory, initial));
      setAmountText('');
      setRepeatMonthly(false);
      setRepeatUntil('');
      setInstallmentOn(false);
      setInstallmentCount('2');
      setInstallmentFirstDueDate(todayISO());
      setAttachmentName(null);
    }
    setNewCategoryName('');
    setAddingCategory(false);
    setAddingClient(false);
    setNewClientName('');
    setAttachmentError(null);
  }, [open, editing, initial, categories, initialAttachment]);

  if (!open) return null;

  const categoriesForType = categories.filter((c) => c.type === form.type);
  // Once a client is picked, narrow the project list to that client's obras —
  // before that (or with no client at all) every project stays selectable.
  const projectsForClient = form.clientId ? projects.filter((p) => p.clientId === form.clientId) : projects;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.description.trim() || form.amountCents <= 0 || !form.categoryId) return;
    if (installmentOn && (!installmentCount || Number(installmentCount) < 2 || !installmentFirstDueDate)) return;
    setSaving(true);
    try {
      const recurrence: RecurrenceInput | undefined =
        !editing && repeatMonthly && !installmentOn ? { frequency: 'monthly', interval: 1, endDate: repeatUntil || null } : undefined;
      const installment: InstallmentInput | undefined =
        !editing && installmentOn
          ? { count: Math.floor(Number(installmentCount)), firstDueDate: installmentFirstDueDate, frequency: 'monthly' }
          : undefined;
      await onSubmit({ ...form, isRecurring: Boolean(recurrence) }, recurrence, installment);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    const category = await onCreateCategory(name, form.type);
    setForm((f) => ({ ...f, categoryId: category.id }));
    setNewCategoryName('');
    setAddingCategory(false);
  }

  async function handleCreateClient() {
    const name = newClientName.trim();
    if (!name) return;
    const client = await onCreateClient(name);
    setForm((f) => ({ ...f, clientId: client.id }));
    setNewClientName('');
    setAddingClient(false);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!isAllowedProjectFileName(file.name)) {
      setAttachmentError(t.attachmentInvalidFormat);
      return;
    }
    if (file.size > MAX_PROJECT_FILE_BYTES) {
      setAttachmentError(t.attachmentTooLarge);
      return;
    }
    setAttachmentError(null);
    setUploadingAttachment(true);
    try {
      const id = await onUploadAttachment(file, form.projectId);
      setForm((f) => ({ ...f, attachmentFileId: id }));
      setAttachmentName(file.name);
    } catch {
      setAttachmentError(t.attachmentError);
    } finally {
      setUploadingAttachment(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="transaction-modal-title" panelClassName="w-full max-w-[560px]">
      <form onSubmit={handleSubmit} className="flex max-h-[85vh] flex-col">
        <div className="border-b border-border px-6 py-4">
          <h2 id="transaction-modal-title" className="text-base font-semibold text-ink">
            {editing ? t.titleEdit : t.titleNew}
          </h2>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-surface-secondary p-1">
            {(['income', 'expense'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setForm((f) => ({ ...f, type, categoryId: categories.find((c) => c.type === type)?.id ?? '' }))}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  form.type === type ? 'bg-sapphire text-white shadow-sm' : 'text-ink-secondary hover:text-sapphire'
                }`}
              >
                {type === 'income' ? t.typeIncome : t.typeExpense}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.description}</span>
            <input
              type="text"
              required
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-sapphire focus:ring-1 focus:ring-sapphire"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.amount}</span>
              <input
                type="text"
                inputMode="decimal"
                required
                placeholder="0,00"
                value={amountText}
                onChange={(e) => {
                  setAmountText(e.target.value);
                  setForm((f) => ({ ...f, amountCents: parseAmountToCents(e.target.value) }));
                }}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-sapphire focus:ring-1 focus:ring-sapphire"
              />
            </label>

            {addingCategory ? (
              <div className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.newCategoryPlaceholder}</span>
                <div className="flex gap-1">
                  <input
                    type="text"
                    autoFocus
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleCreateCategory();
                      }
                    }}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-sapphire focus:ring-1 focus:ring-sapphire"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCreateCategory()}
                    className="shrink-0 rounded-lg bg-sapphire px-3 text-sm font-medium text-white hover:bg-sapphire-hover"
                  >
                    {t.createCategoryAction}
                  </button>
                </div>
              </div>
            ) : (
              <SelectField
                label={t.category}
                value={form.categoryId || NEW_CATEGORY_VALUE}
                options={[
                  ...categoriesForType.map((c) => ({ value: c.id, label: c.name })),
                  { value: NEW_CATEGORY_VALUE, label: t.newCategory },
                ]}
                onChange={(v) => (v === NEW_CATEGORY_VALUE ? setAddingCategory(true) : setForm((f) => ({ ...f, categoryId: v })))}
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.transactionDate}</span>
              <input
                type="date"
                required
                value={form.transactionDate}
                onChange={(e) => setForm((f) => ({ ...f, transactionDate: e.target.value }))}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-sapphire focus:ring-1 focus:ring-sapphire"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.dueDate}</span>
              <input
                type="date"
                value={form.dueDate ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value || null }))}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-sapphire focus:ring-1 focus:ring-sapphire"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-surface-secondary p-1">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, settled: true, settledDate: f.settledDate ?? todayISO() }))}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                form.settled ? 'bg-sapphire text-white shadow-sm' : 'text-ink-secondary hover:text-sapphire'
              }`}
            >
              {form.type === 'income' ? t.settledYesIncome : t.settledYesExpense}
            </button>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, settled: false, settledDate: null }))}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                !form.settled ? 'bg-sapphire text-white shadow-sm' : 'text-ink-secondary hover:text-sapphire'
              }`}
            >
              {t.settledNo}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {addingClient ? (
              <div className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.clientOptional}</span>
                <div className="flex gap-1">
                  <input
                    type="text"
                    autoFocus
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleCreateClient();
                      }
                    }}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-sapphire focus:ring-1 focus:ring-sapphire"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCreateClient()}
                    className="shrink-0 rounded-lg bg-sapphire px-3 text-sm font-medium text-white hover:bg-sapphire-hover"
                  >
                    {t.addClient}
                  </button>
                </div>
              </div>
            ) : (
              <SelectField
                label={t.clientOptional}
                value={form.clientId ?? NO_CLIENT_VALUE}
                options={[
                  { value: NO_CLIENT_VALUE, label: '—' },
                  ...clients.map((c) => ({ value: c.id, label: c.name })),
                  { value: NEW_CLIENT_VALUE, label: t.newClient },
                ]}
                onChange={(v) => {
                  if (v === NEW_CLIENT_VALUE) {
                    setAddingClient(true);
                    return;
                  }
                  // Switching client drops a project that doesn't belong to it —
                  // never leaves the form pointing at a mismatched obra.
                  setForm((f) => {
                    const nextClientId = v || null;
                    const stillValid = f.projectId && projects.find((p) => p.id === f.projectId)?.clientId === nextClientId;
                    return { ...f, clientId: nextClientId, projectId: stillValid ? f.projectId : null };
                  });
                }}
              />
            )}
            <SelectField
              label={t.projectOptional}
              value={form.projectId ?? NO_PROJECT_VALUE}
              options={[{ value: NO_PROJECT_VALUE, label: '—' }, ...projectsForClient.map((p) => ({ value: p.id, label: p.name }))]}
              onChange={(v) => setForm((f) => ({ ...f, projectId: v || null }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label={t.paymentMethod}
              value={form.paymentMethod ?? ''}
              options={[{ value: '', label: '—' }, ...PAYMENT_METHODS.map((m) => ({ value: m, label: messages.financial.paymentMethods[m] }))]}
              onChange={(v) => setForm((f) => ({ ...f, paymentMethod: (v || null) as PaymentMethod | null }))}
            />
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.paymentNote}</span>
              <input
                type="text"
                value={form.paymentMethodNote ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, paymentMethodNote: e.target.value || null }))}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-sapphire focus:ring-1 focus:ring-sapphire"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.notes}</span>
            <textarea
              rows={2}
              value={form.notes ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value || null }))}
              className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-sapphire focus:ring-1 focus:ring-sapphire"
            />
          </label>

          {!editing && (
            <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={installmentOn}
                  onChange={(e) => {
                    setInstallmentOn(e.target.checked);
                    if (e.target.checked) setRepeatMonthly(false);
                  }}
                  className="accent-sapphire"
                />
                {t.installmentToggle}
              </label>
              {installmentOn && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.installmentCount}</span>
                    <input
                      type="number"
                      min={2}
                      max={360}
                      value={installmentCount}
                      onChange={(e) => setInstallmentCount(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-sapphire focus:ring-1 focus:ring-sapphire"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.installmentFirstDue}</span>
                    <input
                      type="date"
                      value={installmentFirstDueDate}
                      onChange={(e) => setInstallmentFirstDueDate(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-sapphire focus:ring-1 focus:ring-sapphire"
                    />
                  </label>
                  {Number(installmentCount) >= 2 && form.amountCents > 0 && (
                    <p className="col-span-2 text-xs text-ink-muted">
                      {t.installmentPreview(Math.floor(Number(installmentCount)), centsToAmountString(Math.floor(form.amountCents / Math.floor(Number(installmentCount)))))}
                    </p>
                  )}
                </div>
              )}

              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={repeatMonthly}
                  onChange={(e) => {
                    setRepeatMonthly(e.target.checked);
                    if (e.target.checked) setInstallmentOn(false);
                  }}
                  className="accent-sapphire"
                />
                {t.repeat}
              </label>
              {repeatMonthly && (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.repeatUntilOptional}</span>
                  <input
                    type="date"
                    value={repeatUntil}
                    onChange={(e) => setRepeatUntil(e.target.value)}
                    className="w-full max-w-[200px] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-sapphire focus:ring-1 focus:ring-sapphire"
                  />
                </label>
              )}
            </div>
          )}

          <div>
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.attachment}</span>
            {form.attachmentFileId && attachmentName ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-ink-secondary">
                <Paperclip size={14} />
                {initialAttachment?.signedUrl ? (
                  <a
                    href={initialAttachment.signedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 truncate text-sapphire hover:underline"
                  >
                    {attachmentName}
                  </a>
                ) : (
                  <span className="flex-1 truncate">{attachmentName}</span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setForm((f) => ({ ...f, attachmentFileId: null }));
                    setAttachmentName(null);
                  }}
                  className="text-ink-muted hover:text-danger"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAttachment}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-ink-secondary transition hover:border-sapphire/50 hover:text-sapphire disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploadingAttachment ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />}
                {uploadingAttachment ? t.attachmentUploading : t.attachmentHint}
              </button>
            )}
            <input ref={fileInputRef} type="file" accept={PROJECT_FILE_ACCEPT} className="hidden" onChange={handleFileChange} />
            {attachmentError && <p className="mt-1 text-xs text-danger">{attachmentError}</p>}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-ink"
          >
            {t.cancel}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-sapphire px-4 py-2 text-sm font-medium text-white transition hover:bg-sapphire-hover disabled:opacity-50"
          >
            {t.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}
