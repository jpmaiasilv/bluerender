import { ProjectFile, ProjectFileCategory } from './types';

export interface ProjectFileRow {
  id: string;
  organization_id: string;
  project_id: string | null;
  uploaded_by: string | null;
  name: string;
  original_name: string;
  category: ProjectFileCategory;
  description: string | null;
  storage_path: string;
  mime_type: string | null;
  file_size: number;
  created_at: string;
  updated_at: string;
}

export function mapProjectFileRow(row: ProjectFileRow): ProjectFile {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    uploadedBy: row.uploaded_by,
    name: row.name,
    originalName: row.original_name,
    category: row.category,
    description: row.description,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
