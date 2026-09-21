import { useCallback, useEffect, useMemo, useState } from 'react';
import { getFinancialRepositories } from './repositoryProvider';
import { FinancialService, RecurrenceInput } from './service';
import { FinancialCategory, FinancialTransaction, InstallmentInput, TransactionInput } from './types';
import { getProjectFileRepositories } from '../projectFiles/projectFileRepositoryProvider';
import { ProjectFileService } from '../projectFiles/service';

export interface FinancialAttachmentInfo {
  fileId: string;
  name: string;
  signedUrl: string | null;
}

/**
 * The only place the Financial page's UI touches the service layer. Keeps a
 * simple "mutate then reload" model — this module's data volume (a small
 * office's transactions) never justifies a heavier state/caching layer, and
 * it keeps every card/chart/list trivially consistent after any change.
 *
 * `organizationId` is null while AuthProvider is still resolving
 * currentOrganization — no query runs until it's known.
 */
export function useFinancialData(organizationId: string | null) {
  const service = useMemo(() => (organizationId ? new FinancialService(getFinancialRepositories(organizationId)) : null), [organizationId]);
  const requireService = useCallback(() => {
    if (!service) throw new Error('Organization not ready');
    return service;
  }, [service]);
  // Attachments are project_files rows (Storage), not a Financial concern —
  // reuses the exact same module "Arquivos da obra" is built on.
  const projectFileService = useMemo(
    () => (organizationId ? new ProjectFileService(getProjectFileRepositories(organizationId)) : null),
    [organizationId]
  );
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [categories, setCategories] = useState<FinancialCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!service) return;
    try {
      const [tx, cats] = await Promise.all([requireService().listTransactions(), requireService().listCategories()]);
      setTransactions(tx);
      setCategories(cats);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [service, requireService]);

  useEffect(() => {
    if (!service) return;
    void reload();
  }, [service, reload]);

  const createTransaction = useCallback(
    async (input: TransactionInput, recurrence?: RecurrenceInput, installment?: InstallmentInput) => {
      const created = await requireService().createTransaction(input, recurrence, installment);
      await reload();
      return created;
    },
    [requireService, reload]
  );

  const updateTransaction = useCallback(
    async (id: string, patch: Partial<TransactionInput>) => {
      const updated = await requireService().updateTransaction(id, patch);
      await reload();
      return updated;
    },
    [requireService, reload]
  );

  const deleteTransaction = useCallback(
    async (id: string) => {
      await requireService().deleteTransaction(id);
      await reload();
    },
    [requireService, reload]
  );

  const duplicateTransaction = useCallback(
    async (source: FinancialTransaction) => {
      const copy = await requireService().duplicateTransaction(source);
      await reload();
      return copy;
    },
    [requireService, reload]
  );

  const markSettled = useCallback(
    async (id: string) => {
      await requireService().markSettled(id);
      await reload();
    },
    [requireService, reload]
  );

  const markUnsettled = useCallback(
    async (id: string) => {
      await requireService().markUnsettled(id);
      await reload();
    },
    [requireService, reload]
  );

  const createCategory = useCallback(
    async (name: string, type: 'income' | 'expense') => {
      const category = await requireService().createCategory(name, type);
      await reload();
      return category;
    },
    [requireService, reload]
  );

  const deleteCategory = useCallback(
    async (id: string) => {
      await requireService().deleteCategory(id);
      await reload();
    },
    [requireService, reload]
  );

  const deleteInstallmentGroupFrom = useCallback(
    async (groupId: string, fromInstallmentNumber: number) => {
      await requireService().deleteInstallmentGroupFrom(groupId, fromInstallmentNumber);
      await reload();
    },
    [requireService, reload]
  );

  /** Uploads the file to Storage and creates its project_files row
   * (category "financial") in one step, returning the id to store on
   * TransactionInput.attachmentFileId. `projectId` null means a general
   * office expense — the file exists but won't show under any obra. */
  const uploadAttachment = useCallback(
    async (file: File, projectId: string | null): Promise<string> => {
      if (!projectFileService) throw new Error('Organization not ready');
      const uploaded = await projectFileService.uploadToStorage(projectId, file);
      const created = await projectFileService.createFile(projectId, {
        name: file.name,
        originalName: file.name,
        category: 'financial',
        description: null,
        storagePath: uploaded.path,
        mimeType: uploaded.mimeType,
        fileSize: uploaded.fileSize,
      });
      return created.id;
    },
    [projectFileService]
  );

  const getAttachment = useCallback(
    async (fileId: string): Promise<FinancialAttachmentInfo | null> => {
      if (!projectFileService) return null;
      const file = await projectFileService.getFile(fileId);
      if (!file) return null;
      const signedUrl = await projectFileService.getSignedUrl(file.storagePath);
      return { fileId: file.id, name: file.name, signedUrl };
    },
    [projectFileService]
  );

  return {
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
    markUnsettled,
    createCategory,
    deleteCategory,
    uploadAttachment,
    getAttachment,
  };
}
