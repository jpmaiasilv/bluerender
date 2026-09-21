import { assertNoError, requireSupabase } from '../supabaseRepositoryHelpers';
import { SupportRepository } from './repository';
import { SupportTicket, SupportTicketInput } from './types';
import { SupportTicketRow, mapSupportTicketRow } from './mappers';

const BUCKET = 'support-attachments';
const SIGNED_URL_TTL_SECONDS = 3600;

/** Organization-scoped — every query relies on RLS (is_organization_member)
 * to restrict rows; `organizationId` is only ever used to stamp new rows and
 * namespace storage paths, never as the actual authorization boundary. */
export class SupabaseSupportRepository implements SupportRepository {
  constructor(private organizationId: string) {}

  async createTicket(input: SupportTicketInput): Promise<SupportTicket> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from('support_tickets')
      .insert({
        organization_id: this.organizationId,
        category: input.category,
        subject: input.subject,
        message: input.message,
        attachment_url: input.attachmentPath ?? null,
      })
      .select()
      .single();
    assertNoError(error);
    return mapSupportTicketRow(data as SupportTicketRow);
  }

  async listTickets(): Promise<SupportTicket[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from('support_tickets')
      .select('*')
      .order('created_at', { ascending: false });
    assertNoError(error);
    return ((data as SupportTicketRow[]) ?? []).map(mapSupportTicketRow);
  }

  async uploadAttachment(file: File): Promise<string> {
    const supabase = requireSupabase();
    // Path starts with organization_id so the storage RLS policies (folder-scoped
    // is_organization_member check) can enforce per-office isolation.
    const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-100);
    const path = `${this.organizationId}/${crypto.randomUUID()}-${safeName}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (error) throw new Error(error.message);
    return path;
  }

  async getAttachmentSignedUrl(path: string): Promise<string | null> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data) return null;
    return data.signedUrl;
  }
}
