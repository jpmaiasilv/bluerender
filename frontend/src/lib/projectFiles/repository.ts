import { ProjectFile, ProjectFileInput, ProjectFileUpdate } from './types';

export interface UploadedObject {
  path: string;
  mimeType: string | null;
  fileSize: number;
}

/** The only contract the UI and ProjectFileService are allowed to depend on. */
export interface ProjectFileRepository {
  listFiles(projectId: string): Promise<ProjectFile[]>;
  /** Single file by id — used e.g. by Financeiro to resolve an attachment's metadata from its stored file id. */
  getFile(id: string): Promise<ProjectFile | null>;
  /** `projectId` null creates an org-level file with no obra link (e.g. a general office expense's receipt) — never shows up under any obra's "Arquivos da obra". */
  createFile(projectId: string | null, input: ProjectFileInput): Promise<ProjectFile>;
  updateFile(id: string, patch: ProjectFileUpdate): Promise<ProjectFile>;
  /** Deletes the DB row first, then the Storage object — never leaves an orphaned Storage file if the row delete fails. */
  deleteFile(id: string, storagePath: string): Promise<void>;
  uploadToStorage(projectId: string | null, file: File): Promise<UploadedObject>;
  /** Short-lived signed URL for displaying a private file inline (preview/new-tab); null if it can't be resolved. */
  getSignedUrl(path: string): Promise<string | null>;
  /** Fetches the file bytes directly (works for the private bucket without a signed URL) — used for the "Baixar" action. */
  downloadFile(path: string): Promise<Blob | null>;
  /** id -> display name, for the "uploaded by" column. Missing/empty names are omitted, never fabricated. */
  getUploaderNames(userIds: string[]): Promise<Record<string, string>>;
}
