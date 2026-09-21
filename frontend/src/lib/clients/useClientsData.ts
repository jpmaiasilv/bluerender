import { useCallback, useEffect, useMemo, useState } from 'react';
import { getClientRepositories } from './clientRepositoryProvider';
import { ClientService } from './service';
import { Client, ClientInput } from './types';

/** Shared by ProjectFormModal/TransactionFormModal's client picker (list +
 * quick-add) and by ClientsModal's full management UI (list + add/edit/delete).
 * `organizationId` null means the org hasn't resolved yet: returns an empty,
 * non-loading list rather than throwing. */
export function useClientsData(organizationId: string | null) {
  const service = useMemo(() => (organizationId ? new ClientService(getClientRepositories(organizationId)) : null), [organizationId]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(Boolean(organizationId));

  const reload = useCallback(async () => {
    if (!service) return;
    try {
      const list = await service.listClients();
      setClients(list);
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createClient = useCallback(
    async (input: ClientInput) => {
      if (!service) throw new Error('Organization not ready');
      const created = await service.createClient(input);
      await reload();
      return created;
    },
    [service, reload]
  );

  const updateClient = useCallback(
    async (id: string, patch: Partial<ClientInput>) => {
      if (!service) throw new Error('Organization not ready');
      const updated = await service.updateClient(id, patch);
      await reload();
      return updated;
    },
    [service, reload]
  );

  const deleteClient = useCallback(
    async (id: string) => {
      if (!service) throw new Error('Organization not ready');
      await service.deleteClient(id);
      await reload();
    },
    [service, reload]
  );

  return { clients, loading, createClient, updateClient, deleteClient, reload };
}
