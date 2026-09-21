import { SupportCategory, SupportStatus, SupportTicket } from './types';

export interface SupportTicketRow {
  id: string;
  organization_id: string;
  user_id: string;
  category: SupportCategory;
  subject: string;
  message: string;
  status: SupportStatus;
  attachment_url: string | null;
  admin_response: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
}

export function mapSupportTicketRow(row: SupportTicketRow): SupportTicket {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    category: row.category,
    subject: row.subject,
    message: row.message,
    status: row.status,
    attachmentPath: row.attachment_url,
    adminResponse: row.admin_response,
    respondedAt: row.responded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
