import { ProjectFileRepositories } from './projectFileRepositoryProvider';
import { ProjectFile, ProjectFileInput, ProjectFileUpdate } from './types';
import { UploadedObject } from './repository';

/** Thin service layer, mirrors ClientService/SupportService's shape. */
export class ProjectFileService {
  constructor(private repos: ProjectFileRepositories) {}

  listFiles(projectId: string): Promise<ProjectFile[]> {
    return this.repos.projectFiles.listFiles(projectId);
  }

  getFile(id: string): Promise<ProjectFile | null> {
    return this.repos.projectFiles.getFile(id);
  }

  createFile(projectId: string | null, input: ProjectFileInput): Promise<ProjectFile> {
    return this.repos.projectFiles.createFile(projectId, input);
  }

  updateFile(id: string, patch: ProjectFileUpdate): Promise<ProjectFile> {
    return this.repos.projectFiles.updateFile(id, patch);
  }

  deleteFile(id: string, storagePath: string): Promise<void> {
    return this.repos.projectFiles.deleteFile(id, storagePath);
  }

  uploadToStorage(projectId: string | null, file: File): Promise<UploadedObject> {
    return this.repos.projectFiles.uploadToStorage(projectId, file);
  }

  getSignedUrl(path: string): Promise<string | null> {
    return this.repos.projectFiles.getSignedUrl(path);
  }

  downloadFile(path: string): Promise<Blob | null> {
    return this.repos.projectFiles.downloadFile(path);
  }

  getUploaderNames(userIds: string[]): Promise<Record<string, string>> {
    return this.repos.projectFiles.getUploaderNames(userIds);
  }
}
