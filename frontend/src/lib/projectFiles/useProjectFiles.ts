import { useCallback, useEffect, useMemo, useState } from 'react';
import { getProjectFileRepositories } from './projectFileRepositoryProvider';
import { ProjectFileService } from './service';
import { ProjectFile, ProjectFileCategory, ProjectFileUpdate } from './types';

export interface UploadProjectFileInput {
  file: File;
  name: string;
  category: ProjectFileCategory;
  description: string | null;
}

/** Both ids null means "not ready yet": returns an empty, non-loading list
 * rather than throwing — mirrors useClientsData/useSupportTickets. */
export function useProjectFiles(organizationId: string | null, projectId: string | null) {
  const service = useMemo(
    () => (organizationId ? new ProjectFileService(getProjectFileRepositories(organizationId)) : null),
    [organizationId]
  );
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [uploaderNames, setUploaderNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(Boolean(organizationId && projectId));

  const reload = useCallback(async () => {
    if (!service || !projectId) return;
    setLoading(true);
    try {
      const list = await service.listFiles(projectId);
      setFiles(list);
      const ids = Array.from(new Set(list.map((f) => f.uploadedBy).filter((id): id is string => Boolean(id))));
      if (ids.length > 0) {
        const names = await service.getUploaderNames(ids);
        setUploaderNames(names);
      }
    } finally {
      setLoading(false);
    }
  }, [service, projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const uploadFile = useCallback(
    async (input: UploadProjectFileInput) => {
      if (!service || !projectId) throw new Error('Project not ready');
      const uploaded = await service.uploadToStorage(projectId, input.file);
      const created = await service.createFile(projectId, {
        name: input.name,
        originalName: input.file.name,
        category: input.category,
        description: input.description,
        storagePath: uploaded.path,
        mimeType: uploaded.mimeType,
        fileSize: uploaded.fileSize,
      });
      await reload();
      return created;
    },
    [service, projectId, reload]
  );

  const updateFile = useCallback(
    async (id: string, patch: ProjectFileUpdate) => {
      if (!service) throw new Error('Project not ready');
      const updated = await service.updateFile(id, patch);
      await reload();
      return updated;
    },
    [service, reload]
  );

  const deleteFile = useCallback(
    async (id: string, storagePath: string) => {
      if (!service) throw new Error('Project not ready');
      await service.deleteFile(id, storagePath);
      await reload();
    },
    [service, reload]
  );

  const getSignedUrl = useCallback(
    async (path: string) => {
      if (!service) return null;
      return service.getSignedUrl(path);
    },
    [service]
  );

  const downloadFile = useCallback(
    async (path: string) => {
      if (!service) return null;
      return service.downloadFile(path);
    },
    [service]
  );

  return { files, uploaderNames, loading, uploadFile, updateFile, deleteFile, getSignedUrl, downloadFile, reload };
}
