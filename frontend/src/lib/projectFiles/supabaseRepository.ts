import { assertNoError, requireSupabase } from '../supabaseRepositoryHelpers';
import { ProjectFileRepository, UploadedObject } from './repository';
import { ProjectFile, ProjectFileInput, ProjectFileUpdate } from './types';
import { ProjectFileRow, mapProjectFileRow } from './mappers';

const BUCKET = 'project-files';
const SIGNED_URL_TTL_SECONDS = 3600;

/** Organization-scoped — every query relies on RLS (is_organization_member)
 * to restrict rows; `organizationId` is only ever used to stamp new rows and
 * namespace storage paths, never as the actual authorization boundary. */
export class SupabaseProjectFileRepository implements ProjectFileRepository {
  constructor(private organizationId: string) {}

  async listFiles(projectId: string): Promise<ProjectFile[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from('project_files')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    assertNoError(error);
    return ((data as ProjectFileRow[]) ?? []).map(mapProjectFileRow);
  }

  async getFile(id: string): Promise<ProjectFile | null> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.from('project_files').select('*').eq('id', id).maybeSingle();
    assertNoError(error);
    return data ? mapProjectFileRow(data as ProjectFileRow) : null;
  }

  async createFile(projectId: string | null, input: ProjectFileInput): Promise<ProjectFile> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from('project_files')
      .insert({
        organization_id: this.organizationId,
        project_id: projectId,
        name: input.name,
        original_name: input.originalName,
        category: input.category,
        description: input.description,
        storage_path: input.storagePath,
        mime_type: input.mimeType,
        file_size: input.fileSize,
      })
      .select()
      .single();
    assertNoError(error);
    return mapProjectFileRow(data as ProjectFileRow);
  }

  async updateFile(id: string, patch: ProjectFileUpdate): Promise<ProjectFile> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from('project_files')
      .update({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
      })
      .eq('id', id)
      .select()
      .single();
    assertNoError(error);
    return mapProjectFileRow(data as ProjectFileRow);
  }

  async deleteFile(id: string, storagePath: string): Promise<void> {
    const supabase = requireSupabase();
    // Storage first: if this fails we abort and the DB row survives (retryable).
    // Deleting the DB row first and having the Storage removal fail afterward
    // would leave a real orphan — a file no longer referenced anywhere.
    const { error: storageError } = await supabase.storage.from(BUCKET).remove([storagePath]);
    if (storageError) throw new Error(storageError.message);
    const { error } = await supabase.from('project_files').delete().eq('id', id);
    assertNoError(error);
  }

  async uploadToStorage(projectId: string | null, file: File): Promise<UploadedObject> {
    const supabase = requireSupabase();
    const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-150);
    const path = projectId
      ? `${this.organizationId}/${projectId}/${crypto.randomUUID()}-${safeName}`
      : `${this.organizationId}/geral/${crypto.randomUUID()}-${safeName}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
    if (error) throw new Error(error.message);
    return { path, mimeType: file.type || null, fileSize: file.size };
  }

  async getSignedUrl(path: string): Promise<string | null> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data) return null;
    return data.signedUrl;
  }

  async downloadFile(path: string): Promise<Blob | null> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.storage.from(BUCKET).download(path);
    if (error || !data) return null;
    return data;
  }

  async getUploaderNames(userIds: string[]): Promise<Record<string, string>> {
    if (userIds.length === 0) return {};
    const supabase = requireSupabase();
    const { data, error } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
    if (error || !data) return {};
    const result: Record<string, string> = {};
    for (const row of data as { id: string; full_name: string | null }[]) {
      if (row.full_name && row.full_name.trim()) result[row.id] = row.full_name.trim();
    }
    return result;
  }
}
