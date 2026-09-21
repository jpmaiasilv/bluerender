import { useMemo, useState } from 'react';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Modal } from '../Modal';
import { useLanguage } from '../../i18n';
import { Client, ClientInput } from '../../lib/clients/types';

interface Props {
  open: boolean;
  onClose: () => void;
  clients: Client[];
  onCreate: (input: ClientInput) => Promise<Client>;
  onUpdate: (id: string, patch: Partial<ClientInput>) => Promise<Client>;
  onDelete: (id: string) => Promise<void>;
}

const BLANK: ClientInput = { name: '', company: null, email: null, phone: null, address: null, notes: null };

/** Financeiro › Clientes: search the org's clients, add new ones, edit or delete existing ones. Any client added/edited here shows up immediately in TransactionFormModal's/ProjectFormModal's own client picker — they share the same `clients` list via useClientsData. */
export function ClientsModal({ open, onClose, clients, onCreate, onUpdate, onDelete }: Props) {
  const { messages } = useLanguage();
  const t = messages.financial.clientsModal;

  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ClientInput>(BLANK);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => [c.name, c.company, c.email, c.phone].filter(Boolean).some((v) => v!.toLowerCase().includes(q)));
  }, [clients, search]);

  function openNewForm() {
    setEditingId(null);
    setForm(BLANK);
    setError(null);
    setFormOpen(true);
  }

  function openEditForm(client: Client) {
    setEditingId(client.id);
    setForm({ name: client.name, company: client.company, email: client.email, phone: client.phone, address: client.address, notes: client.notes });
    setError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(BLANK);
    setError(null);
  }

  function handleClose() {
    closeForm();
    setSearch('');
    onClose();
  }

  function field(key: keyof ClientInput, value: string) {
    setForm((f) => ({ ...f, [key]: value.trim() ? value : null }));
  }

  async function handleSave() {
    const name = form.name.trim();
    if (!name) {
      setError(t.nameRequired);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingId) await onUpdate(editingId, { ...form, name });
      else await onCreate({ ...form, name });
      closeForm();
    } catch {
      setError(t.saveError);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(client: Client) {
    if (!window.confirm(t.deleteConfirm(client.name))) return;
    setDeletingId(client.id);
    setError(null);
    try {
      await onDelete(client.id);
      if (editingId === client.id) closeForm();
    } catch {
      setError(t.deleteError);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} labelledBy="clients-modal-title" panelClassName="w-full max-w-[640px]">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-border px-6 pb-4 pt-6">
          <h2 id="clients-modal-title" className="pr-8 text-base font-semibold text-ink">
            {t.title}
          </h2>
          <div className="mt-3 flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.searchPlaceholder}
                className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-sapphire focus:ring-1 focus:ring-sapphire"
              />
            </div>
            <button
              type="button"
              onClick={openNewForm}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-sapphire px-3.5 py-2 text-sm font-medium text-white transition hover:bg-sapphire-hover"
            >
              <Plus size={15} />
              {t.addButton}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {formOpen && (
            <div className="mb-4 flex flex-col gap-3 rounded-xl border border-sapphire/30 bg-sapphire-soft p-4">
              <h3 className="text-sm font-semibold text-ink">{editingId ? t.editTitle : t.newTitle}</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink-secondary">{t.nameLabel}</span>
                  <input
                    type="text"
                    autoFocus
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-sapphire focus:ring-1 focus:ring-sapphire"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink-secondary">{t.companyLabel}</span>
                  <input
                    type="text"
                    value={form.company ?? ''}
                    onChange={(e) => field('company', e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-sapphire focus:ring-1 focus:ring-sapphire"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink-secondary">{t.emailLabel}</span>
                  <input
                    type="email"
                    value={form.email ?? ''}
                    onChange={(e) => field('email', e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-sapphire focus:ring-1 focus:ring-sapphire"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink-secondary">{t.phoneLabel}</span>
                  <input
                    type="tel"
                    value={form.phone ?? ''}
                    onChange={(e) => field('phone', e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-sapphire focus:ring-1 focus:ring-sapphire"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-xs font-medium text-ink-secondary">{t.addressLabel}</span>
                  <input
                    type="text"
                    value={form.address ?? ''}
                    onChange={(e) => field('address', e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-sapphire focus:ring-1 focus:ring-sapphire"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-xs font-medium text-ink-secondary">{t.notesLabel}</span>
                  <textarea
                    rows={2}
                    value={form.notes ?? ''}
                    onChange={(e) => field('notes', e.target.value)}
                    className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-sapphire focus:ring-1 focus:ring-sapphire"
                  />
                </label>
              </div>
              {error && <p className="text-sm text-danger">{error}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={closeForm} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink-secondary hover:border-sapphire/40">
                  {t.cancel}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSave()}
                  className="rounded-lg bg-sapphire px-4 py-2 text-sm font-medium text-white hover:bg-sapphire-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {t.save}
                </button>
              </div>
            </div>
          )}

          {!formOpen && error && <p className="mb-3 text-sm text-danger">{error}</p>}

          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-muted">{search.trim() ? t.noResults : t.empty}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {filtered.map((client) => (
                <li key={client.id} className="group flex items-center gap-3 rounded-lg border border-border bg-surface px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{client.name}</p>
                    <p className="truncate text-xs text-ink-muted">{[client.company, client.email, client.phone].filter(Boolean).join(' · ') || '—'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openEditForm(client)}
                    aria-label={t.edit}
                    title={t.edit}
                    className="shrink-0 rounded-md p-1.5 text-ink-muted transition hover:bg-surface-secondary hover:text-sapphire"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={deletingId === client.id}
                    onClick={() => void handleDelete(client)}
                    aria-label={t.delete}
                    title={t.delete}
                    className="shrink-0 rounded-md p-1.5 text-ink-muted transition hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
