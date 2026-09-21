import { ClientRepositories } from './clientRepositoryProvider';
import { Client, ClientInput } from './types';

/** Thin service layer, mirrors ProjectService/FinancialService's shape.
 * ProjectFormModal/TransactionFormModal use it for their client picker;
 * ClientsModal (Financeiro › Clientes) uses the full CRUD surface. */
export class ClientService {
  constructor(private repos: ClientRepositories) {}

  async listClients(search?: string): Promise<Client[]> {
    return this.repos.clients.listClients(search);
  }

  async getClient(id: string): Promise<Client | null> {
    return this.repos.clients.getClient(id);
  }

  async createClient(input: ClientInput): Promise<Client> {
    return this.repos.clients.createClient(input);
  }

  async updateClient(id: string, patch: Partial<ClientInput>): Promise<Client> {
    return this.repos.clients.updateClient(id, patch);
  }

  async deleteClient(id: string): Promise<void> {
    return this.repos.clients.deleteClient(id);
  }
}
