import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Modal } from '../Modal';
import { SelectField } from '../SelectField';
import { useLanguage } from '../../i18n';
import { centsToAmountString, parseAmountToCents } from '../../lib/financial/money';
import { PROJECT_PRIORITIES, Project, ProjectInput, ProjectStage, ProjectTag } from '../../lib/projects/types';
import { Client } from '../../lib/clients/types';

const NEW_CLIENT_VALUE = '__new_client__';
const NO_CLIENT_VALUE = '';

interface Props {
  open: boolean;
  onClose: () => void;
  stages: ProjectStage[];
  tags: ProjectTag[];
  clients: Client[];
  initial: Project | null;
  defaultValues?: Partial<ProjectInput>;
  onSubmit: (input: ProjectInput) => Promise<void>;
  onCreateTag: (name: string) => Promise<ProjectTag>;
  onCreateClient: (name: string) => Promise<Client>;
}

function blankInput(defaultStageId: string): ProjectInput {
  return {
    name: '',
    clientId: null,
    projectType: null,
    stageId: defaultStageId,
    priority: 'normal',
    startDate: null,
    dueDate: null,
    contractValueCents: 0,
    responsibleId: null,
    responsibleName: null,
    nextAction: null,
    notes: null,
    tagIds: [],
  };
}

export function ProjectFormModal({ open, onClose, stages, tags, clients, initial, defaultValues, onSubmit, onCreateTag, onCreateClient }: Props) {
  const { messages } = useLanguage();
  const t = messages.projectFlow.form;
  const [form, setForm] = useState<ProjectInput>(() => blankInput(stages[0]?.id ?? ''));
  const [amountText, setAmountText] = useState('');
  const [newTagText, setNewTagText] = useState('');
  const [addingClient, setAddingClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm({
        name: initial.name,
        clientId: initial.clientId,
        projectType: initial.projectType,
        stageId: initial.stageId,
        priority: initial.priority,
        startDate: initial.startDate,
        dueDate: initial.dueDate,
        contractValueCents: initial.contractValueCents,
        responsibleId: initial.responsibleId,
        responsibleName: initial.responsibleName,
        nextAction: initial.nextAction,
        notes: initial.notes,
        tagIds: [...initial.tagIds],
      });
      setAmountText(centsToAmountString(initial.contractValueCents));
    } else {
      const base = blankInput(stages[0]?.id ?? '');
      setForm({ ...base, ...defaultValues });
      setAmountText(defaultValues?.contractValueCents ? centsToAmountString(defaultValues.contractValueCents) : '');
    }
    setNewTagText('');
    setAddingClient(false);
    setNewClientName('');
  }, [open, initial, defaultValues, stages]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.stageId) return;
    setSaving(true);
    try {
      await onSubmit(form);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleAddTag() {
    const name = newTagText.trim();
    if (!name) return;
    const existing = tags.find((tg) => tg.name.toLowerCase() === name.toLowerCase());
    const tag = existing ?? (await onCreateTag(name));
    if (!form.tagIds.includes(tag.id)) setForm((f) => ({ ...f, tagIds: [...f.tagIds, tag.id] }));
    setNewTagText('');
  }

  async function handleCreateClient() {
    const name = newClientName.trim();
    if (!name) return;
    const client = await onCreateClient(name);
    setForm((f) => ({ ...f, clientId: client.id }));
    setNewClientName('');
    setAddingClient(false);
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="project-modal-title" panelClassName="w-full max-w-[560px]">
      <form onSubmit={handleSubmit} className="flex max-h-[85vh] flex-col">
        <div className="border-b border-border px-6 py-4">
          <h2 id="project-modal-title" className="text-base font-semibold text-ink">
            {initial ? t.titleEdit : t.titleNew}
          </h2>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.name}</span>
            <input
              type="text"
              required
              autoFocus
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-sapphire focus:ring-1 focus:ring-sapphire"
            />
          </label>

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
                onChange={(v) => (v === NEW_CLIENT_VALUE ? setAddingClient(true) : setForm((f) => ({ ...f, clientId: v || null })))}
              />
            )}
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.projectType}</span>
              <input
                type="text"
                value={form.projectType ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, projectType: e.target.value || null }))}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-sapphire focus:ring-1 focus:ring-sapphire"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.contractValue}</span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={amountText}
                onChange={(e) => {
                  setAmountText(e.target.value);
                  setForm((f) => ({ ...f, contractValueCents: parseAmountToCents(e.target.value) }));
                }}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-sapphire focus:ring-1 focus:ring-sapphire"
              />
            </label>
            <SelectField
              label={t.initialStage}
              value={form.stageId}
              options={stages.map((s) => ({ value: s.id, label: s.name }))}
              onChange={(v) => setForm((f) => ({ ...f, stageId: v }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.startDate}</span>
              <input
                type="date"
                value={form.startDate ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value || null }))}
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

          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label={t.priority}
              value={form.priority}
              options={PROJECT_PRIORITIES.map((p) => ({ value: p, label: messages.projectFlow.priority.options[p] }))}
              onChange={(v) => setForm((f) => ({ ...f, priority: v as ProjectInput['priority'] }))}
            />
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.responsibleOptional}</span>
              <input
                type="text"
                value={form.responsibleName ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, responsibleName: e.target.value || null }))}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-sapphire focus:ring-1 focus:ring-sapphire"
              />
            </label>
          </div>

          <div>
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.tags}</span>
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1.5">
              {form.tagIds.map((id) => {
                const tag = tags.find((tg) => tg.id === id);
                if (!tag) return null;
                return (
                  <span key={id} className="flex items-center gap-1 rounded-full bg-sapphire-soft px-2 py-0.5 text-xs text-sapphire">
                    {tag.name}
                    <button type="button" onClick={() => setForm((f) => ({ ...f, tagIds: f.tagIds.filter((tid) => tid !== id) }))}>
                      <X size={11} />
                    </button>
                  </span>
                );
              })}
              <input
                type="text"
                value={newTagText}
                onChange={(e) => setNewTagText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleAddTag();
                  }
                }}
                placeholder={t.addTag}
                className="min-w-[100px] flex-1 border-none bg-transparent text-xs text-ink outline-none"
              />
            </div>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.nextActionOptional}</span>
            <input
              type="text"
              value={form.nextAction ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, nextAction: e.target.value || null }))}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-sapphire focus:ring-1 focus:ring-sapphire"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.notes}</span>
            <textarea
              rows={2}
              value={form.notes ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value || null }))}
              className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-sapphire focus:ring-1 focus:ring-sapphire"
            />
          </label>
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
