import { useMemo, useState } from 'react';
import { FolderOpen, Search } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { useAuth } from '../../lib/auth/AuthProvider';
import { useProjectFiles } from '../../lib/projectFiles/useProjectFiles';
import { ProjectFile, ProjectFileCategory } from '../../lib/projectFiles/types';
import { fileExtension } from '../../config/projectFiles';
import { formatFileSize } from '../../lib/formatFileSize';
import { formatLocaleDate } from '../../lib/formatLocaleDate';
import { fileTypeIcon, isPreviewableImage, isPreviewablePdf } from './fileTypeIcon';
import { FileRowMenu } from './FileRowMenu';
import { ProjectFileUploadModal } from './ProjectFileUploadModal';
import { ProjectFileEditModal } from './ProjectFileEditModal';
import { DeleteFileConfirmModal } from './DeleteFileConfirmModal';
import { ProjectFilePreviewModal } from './ProjectFilePreviewModal';

const CATEGORY_ORDER: ProjectFileCategory[] = [
  'project',
  'contract',
  'financial',
  'invoice',
  'image',
  'client_document',
  'survey',
  'other',
];

type SortKey = 'newest' | 'oldest' | 'name';

function downloadFileName(file: ProjectFile): string {
  const originalExt = fileExtension(file.originalName);
  if (!originalExt) return file.name;
  return fileExtension(file.name) === originalExt ? file.name : `${file.name}.${originalExt}`;
}

interface Props {
  organizationId: string | null;
  projectId: string;
}

export function ProjectFilesTab({ organizationId, projectId }: Props) {
  const { messages, locale } = useLanguage();
  const { user } = useAuth();
  const t = messages.projectFiles;
  const { files, uploaderNames, loading, uploadFile, updateFile, deleteFile, getSignedUrl, downloadFile } = useProjectFiles(
    organizationId,
    projectId
  );

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('newest');
  const [categoryFilter, setCategoryFilter] = useState<ProjectFileCategory | 'all'>('all');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editingFile, setEditingFile] = useState<ProjectFile | null>(null);
  const [deletingFile, setDeletingFile] = useState<ProjectFile | null>(null);
  const [previewFile, setPreviewFile] = useState<ProjectFile | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: files.length };
    for (const category of CATEGORY_ORDER) map[category] = 0;
    for (const file of files) map[file.category] = (map[file.category] ?? 0) + 1;
    return map;
  }, [files]);

  const filteredSorted = useMemo(() => {
    const query = search.trim().toLowerCase();
    let list = files;
    if (categoryFilter !== 'all') list = list.filter((f) => f.category === categoryFilter);
    if (query) list = list.filter((f) => f.name.toLowerCase().includes(query));
    const sorted = [...list];
    if (sortKey === 'newest') sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    else if (sortKey === 'oldest') sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    else sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [files, search, categoryFilter, sortKey]);

  async function handleView(file: ProjectFile) {
    const url = await getSignedUrl(file.storagePath);
    if (!url) return;
    if (isPreviewableImage(file.mimeType, file.originalName)) {
      setPreviewFile(file);
      setPreviewUrl(url);
    } else if (isPreviewablePdf(file.mimeType, file.originalName)) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  async function handleDownload(file: ProjectFile) {
    const blob = await downloadFile(file.storagePath);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadFileName(file);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function openUpload() {
    setUploadOpen(true);
  }

  return (
    <div className="flex flex-col gap-5 px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">{t.title}</h2>
          <p className="mt-0.5 text-sm text-ink-secondary">{t.subtitle}</p>
        </div>
        {files.length > 0 && (
          <button
            type="button"
            onClick={openUpload}
            className="shrink-0 rounded-lg bg-sapphire px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:bg-sapphire-hover"
          >
            {t.addButton}
          </button>
        )}
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-ink-muted">…</p>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-surface-secondary px-6 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sapphire-light">
            <FolderOpen size={22} className="text-sapphire" />
          </div>
          <p className="font-semibold text-ink">{t.empty.title}</p>
          <p className="max-w-sm text-sm text-ink-secondary">{t.empty.description}</p>
          <button
            type="button"
            onClick={openUpload}
            className="mt-1 rounded-lg bg-sapphire px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:bg-sapphire-hover"
          >
            {t.empty.cta}
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {(['all', ...CATEGORY_ORDER] as const).map((key) => {
              const label = key === 'all' ? t.categoryFilterAll : t.categories[key];
              const active = categoryFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setCategoryFilter(key)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    active ? 'bg-sapphire text-white' : 'border border-border text-ink-secondary hover:border-sapphire/40 hover:text-sapphire'
                  }`}
                >
                  {label} <span className={active ? 'text-white/80' : 'text-ink-muted'}>({counts[key] ?? 0})</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.searchPlaceholder}
                className="w-full rounded-lg border border-border bg-surface py-2 pl-8 pr-3 text-sm text-ink outline-none transition placeholder:text-ink-muted focus:border-sapphire focus:ring-1 focus:ring-sapphire"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-ink-secondary">
              {t.sortLabel}
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none transition focus:border-sapphire focus:ring-1 focus:ring-sapphire"
              >
                <option value="newest">{t.sortOptions.newest}</option>
                <option value="oldest">{t.sortOptions.oldest}</option>
                <option value="name">{t.sortOptions.name}</option>
              </select>
            </label>
          </div>

          {filteredSorted.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-muted">{t.noResults}</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-secondary text-left text-xs font-medium uppercase tracking-wide text-ink-muted">
                    <th className="py-2.5 pl-4 pr-3">{t.columns.name}</th>
                    <th className="py-2.5 pr-3">{t.columns.category}</th>
                    <th className="py-2.5 pr-3">{t.columns.date}</th>
                    <th className="py-2.5 pr-3">{t.columns.uploadedBy}</th>
                    <th className="py-2.5 pr-3">{t.columns.size}</th>
                    <th className="py-2.5 pr-4" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredSorted.map((file) => {
                    const canPreview = isPreviewableImage(file.mimeType, file.originalName) || isPreviewablePdf(file.mimeType, file.originalName);
                    const uploaderLabel =
                      file.uploadedBy && file.uploadedBy === user?.id
                        ? t.uploadedByYou
                        : file.uploadedBy
                          ? (uploaderNames[file.uploadedBy] ?? '—')
                          : '—';
                    return (
                      <tr key={file.id} className="text-ink hover:bg-surface-secondary/60">
                        <td className="max-w-[280px] py-2.5 pl-4 pr-3">
                          <div className="flex items-center gap-2">
                            {fileTypeIcon(file.mimeType, file.originalName)}
                            <div className="min-w-0">
                              <p className="truncate font-medium">{file.name}</p>
                              {file.description && <p className="truncate text-xs text-ink-muted">{file.description}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="whitespace-nowrap py-2.5 pr-3 text-xs text-ink-secondary">{t.categories[file.category]}</td>
                        <td className="whitespace-nowrap py-2.5 pr-3 text-xs text-ink-secondary">{formatLocaleDate(file.createdAt, locale)}</td>
                        <td className="whitespace-nowrap py-2.5 pr-3 text-xs text-ink-secondary">{uploaderLabel}</td>
                        <td className="whitespace-nowrap py-2.5 pr-3 text-xs text-ink-secondary">{formatFileSize(file.fileSize, locale)}</td>
                        <td className="py-2.5 pr-4 text-right">
                          <FileRowMenu
                            file={file}
                            canPreview={canPreview}
                            onView={handleView}
                            onDownload={handleDownload}
                            onEdit={setEditingFile}
                            onDelete={setDeletingFile}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <ProjectFileUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        initialCategory={categoryFilter === 'all' ? 'other' : categoryFilter}
        onUpload={uploadFile}
      />
      <ProjectFileEditModal file={editingFile} onClose={() => setEditingFile(null)} onSave={updateFile} />
      <DeleteFileConfirmModal
        file={deletingFile}
        onClose={() => setDeletingFile(null)}
        onConfirm={(file) => deleteFile(file.id, file.storagePath)}
      />
      <ProjectFilePreviewModal
        file={previewFile}
        signedUrl={previewUrl}
        onClose={() => {
          setPreviewFile(null);
          setPreviewUrl(null);
        }}
      />
    </div>
  );
}
