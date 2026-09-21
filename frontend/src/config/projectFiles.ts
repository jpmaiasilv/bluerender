/**
 * Single source of truth for "Arquivos da obra" upload rules — extensions and
 * the size cap. Keep MAX_PROJECT_FILE_BYTES in sync with the project-files
 * bucket's file_size_limit in supabase/migrations/20260902140000_project_files.sql
 * (Storage enforces the real limit; this is what the UI validates against
 * before even starting an upload).
 */

export const MAX_PROJECT_FILE_BYTES = 50 * 1024 * 1024;

export const ALLOWED_PROJECT_FILE_EXTENSIONS = [
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'dwg',
  'dxf',
] as const;

/** For the file input's `accept` attribute. */
export const PROJECT_FILE_ACCEPT = ALLOWED_PROJECT_FILE_EXTENSIONS.map((ext) => `.${ext}`).join(',');

export function fileExtension(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? (parts.pop() as string).toLowerCase() : '';
}

export function isAllowedProjectFileName(fileName: string): boolean {
  return (ALLOWED_PROJECT_FILE_EXTENSIONS as readonly string[]).includes(fileExtension(fileName));
}
