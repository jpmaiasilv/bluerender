// --- Support tickets: core domain types ---
//
// New module, backed only by Supabase (see supabaseRepository.ts) — no
// IndexedDB implementation, mirrors lib/clients's shape.

export type SupportCategory = 'question' | 'technical' | 'financial' | 'suggestion' | 'other';
export type SupportStatus = 'submitted' | 'in_review' | 'answered' | 'resolved';

export interface SupportTicket {
  id: string;
  organizationId: string;
  userId: string;
  category: SupportCategory;
  subject: string;
  message: string;
  status: SupportStatus;
  /** Storage object path inside the private "support-attachments" bucket — never a public URL. */
  attachmentPath: string | null;
  adminResponse: string | null;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupportTicketInput {
  category: SupportCategory;
  subject: string;
  message: string;
  attachmentPath?: string | null;
}
