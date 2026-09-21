import { assertNoError, requireSupabase } from '../supabaseRepositoryHelpers';
import { ClientRepository } from './repository';
import { Client, ClientInput } from './types';
import { ClientRow, mapClientRow } from './mappers';

/** Organization-scoped — every query relies on RLS (is_organization_member)
 * to restrict rows; `organizationId` is only ever used to stamp new rows,
 * never as the actual authorization boundary. */
export class SupabaseClientRepository implements ClientRepository {
  constructor(private organizationId: string) {}

  async createClient(input: ClientInput & { id?: string }): Promise<Client> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from('clients')
      .insert({
        id: input.id,
        organization_id: this.organizationId,
        name: input.name,
        company: input.company,
        email: input.email,
        phone: input.phone,
        address: input.address,
        notes: input.notes,
      })
      .select()
      .single();
    assertNoError(error);
    return mapClientRow(data as ClientRow);
  }

  async updateClient(id: string, patch: Partial<ClientInput>): Promise<Client> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from('clients')
      .update({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.company !== undefined ? { company: patch.company } : {}),
        ...(patch.email !== undefined ? { email: patch.email } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
        ...(patch.address !== undefined ? { address: patch.address } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      })
      .eq('id', id)
      .select()
      .single();
    assertNoError(error);
    return mapClientRow(data as ClientRow);
  }

  async deleteClient(id: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase.from('clients').delete().eq('id', id);
    assertNoError(error);
  }

  async getClient(id: string): Promise<Client | null> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.from('clients').select('*').eq('id', id).maybeSingle();
    assertNoError(error);
    return data ? mapClientRow(data as ClientRow) : null;
  }

  async listClients(search?: string): Promise<Client[]> {
    const supabase = requireSupabase();
    let query = supabase.from('clients').select('*').order('name', { ascending: true });
    if (search?.trim()) {
      // Strip characters that have syntactic meaning in a PostgREST .or()
      // filter string (comma separates conditions, parens group them) so a
      // search term can never inject extra clauses.
      const q = search.trim().replace(/[,()]/g, ' ');
      query = query.or(`name.ilike.%${q}%,company.ilike.%${q}%`);
    }
    const { data, error } = await query;
    assertNoError(error);
    return (data as ClientRow[] ?? []).map(mapClientRow);
  }
}
