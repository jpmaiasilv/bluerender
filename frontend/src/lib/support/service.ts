import { SupportRepositories } from './supportRepositoryProvider';
import { SupportTicket, SupportTicketInput } from './types';

/** Thin service layer, mirrors ClientService/ProjectService's shape. */
export class SupportService {
  constructor(private repos: SupportRepositories) {}

  async listTickets(): Promise<SupportTicket[]> {
    return this.repos.support.listTickets();
  }

  async createTicket(input: SupportTicketInput): Promise<SupportTicket> {
    return this.repos.support.createTicket(input);
  }

  async uploadAttachment(file: File): Promise<string> {
    return this.repos.support.uploadAttachment(file);
  }

  async getAttachmentSignedUrl(path: string): Promise<string | null> {
    return this.repos.support.getAttachmentSignedUrl(path);
  }
}
