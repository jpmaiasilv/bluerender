import { useState } from 'react';
import { ToolLayout } from '../components/ToolLayout';
import { SupportContactCard } from '../components/help/SupportContactCard';
import { SupportHistoryCard } from '../components/help/SupportHistoryCard';
import { UpdatesCard } from '../components/help/UpdatesCard';
import { HelpShortcuts } from '../components/help/HelpShortcuts';
import { useAuth } from '../lib/auth/AuthProvider';
import { useSupportTickets } from '../lib/support/useSupportTickets';
import { SupportCategory } from '../lib/support/types';
import { useLanguage } from '../i18n';

function scrollToContactForm() {
  document.getElementById('fale-com-a-gente')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function HelpPage() {
  const { messages } = useLanguage();
  const { currentOrganization } = useAuth();
  const { tickets, loading, createTicket, uploadAttachment, getAttachmentSignedUrl } = useSupportTickets(
    currentOrganization?.id ?? null
  );
  const [category, setCategory] = useState<SupportCategory>('question');

  function focusFormWithCategory(nextCategory: SupportCategory) {
    setCategory(nextCategory);
    scrollToContactForm();
  }

  return (
    <ToolLayout title={messages.helpPage.title} description={messages.helpPage.subtitle}>
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col gap-6">
            <SupportContactCard
              category={category}
              onCategoryChange={setCategory}
              onUploadAttachment={uploadAttachment}
              onSubmit={async (input) => {
                await createTicket(input);
              }}
            />
            <SupportHistoryCard tickets={tickets} loading={loading} getAttachmentSignedUrl={getAttachmentSignedUrl} />
          </div>

          <UpdatesCard />
        </div>

        <HelpShortcuts onFocusForm={focusFormWithCategory} />
      </div>
    </ToolLayout>
  );
}
