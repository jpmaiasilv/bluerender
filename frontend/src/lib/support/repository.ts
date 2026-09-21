import { SupportTicket, SupportTicketInput } from './types';

/** The only contract the UI and SupportService are allowed to depend on. */
export interface SupportRepository {
  createTicket(input: SupportTicketInput): Promise<SupportTicket>;
  /** Newest first. */
  listTickets(): Promise<SupportTicket[]>;
  /** Returns the storage object path to store on the ticket (never a public URL — the bucket is private). */
  uploadAttachment(file: File): Promise<string>;
  /** Short-lived signed URL for displaying a private attachment; null if it can't be resolved. */
  getAttachmentSignedUrl(path: string): Promise<string | null>;
}
