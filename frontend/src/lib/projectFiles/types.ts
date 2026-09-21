// --- Project files ("Arquivos da obra"): core domain types ---
//
// New module, backed only by Supabase (see supabaseRepository.ts) — mirrors
// lib/clients's and lib/support's shape. A file always belongs to exactly one
// project (see the composite FK in the migration) — never just a client.

export type ProjectFileCategory =
  | 'project'
  | 'contract'
  | 'financial'
  | 'invoice'
  | 'image'
  | 'client_document'
  | 'survey'
  | 'other';

export interface ProjectFile {
  id: string;
  organizationId: string;
  /** Null for a general office file with no obra link (see repository.ts's createFile). */
  projectId: string | null;
  uploadedBy: string | null;
  name: string;
  originalName: string;
  category: ProjectFileCategory;
  description: string | null;
  /** Storage object path inside the private "project-files" bucket — never a public URL. */
  storagePath: string;
  mimeType: string | null;
  fileSize: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFileInput {
  name: string;
  originalName: string;
  category: ProjectFileCategory;
  description: string | null;
  storagePath: string;
  mimeType: string | null;
  fileSize: number;
}

export interface ProjectFileUpdate {
  name?: string;
  category?: ProjectFileCategory;
  description?: string | null;
}
