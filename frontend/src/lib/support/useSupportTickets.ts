import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupportRepositories } from './supportRepositoryProvider';
import { SupportService } from './service';
import { SupportTicket, SupportTicketInput } from './types';

/** `organizationId` null means the org hasn't resolved yet: returns an empty,
 * non-loading list rather than throwing — mirrors useClientsData. */
export function useSupportTickets(organizationId: string | null) {
  const service = useMemo(
    () => (organizationId ? new SupportService(getSupportRepositories(organizationId)) : null),
    [organizationId]
  );
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(Boolean(organizationId));

  const reload = useCallback(async () => {
    if (!service) return;
    setLoading(true);
    try {
      const list = await service.listTickets();
      setTickets(list);
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createTicket = useCallback(
    async (input: SupportTicketInput) => {
      if (!service) throw new Error('Organization not ready');
      const created = await service.createTicket(input);
      await reload();
      return created;
    },
    [service, reload]
  );

  const uploadAttachment = useCallback(
    async (file: File) => {
      if (!service) throw new Error('Organization not ready');
      return service.uploadAttachment(file);
    },
    [service]
  );

  const getAttachmentSignedUrl = useCallback(
    async (path: string) => {
      if (!service) return null;
      return service.getAttachmentSignedUrl(path);
    },
    [service]
  );

  return { tickets, loading, createTicket, uploadAttachment, getAttachmentSignedUrl, reload };
}
