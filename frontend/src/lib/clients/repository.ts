import { Client, ClientInput } from './types';

/** The only contract the UI and ClientService are allowed to depend on. */
export interface ClientRepository {
  createClient(input: ClientInput & { id?: string }): Promise<Client>;
  updateClient(id: string, patch: Partial<ClientInput>): Promise<Client>;
  deleteClient(id: string): Promise<void>;
  getClient(id: string): Promise<Client | null>;
  /** `search` matches against name/company (case-insensitive, substring). */
  listClients(search?: string): Promise<Client[]>;
}
