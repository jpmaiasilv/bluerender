import { Outlet } from 'react-router-dom';
import { SettingsNav } from '../components/settings/SettingsNav';
import { useWalletContext } from '../layouts/RootLayout';
import { useLanguage } from '../i18n';

/**
 * The settings shell: title/subtitle + a white container split into the
 * internal settings nav and the active section. Each section is a nested
 * route (see App.tsx) so a section is deep-linkable, e.g. /configuracoes/plano.
 * Re-forwards RootLayout's outlet context (wallet balance, upgrade modal
 * trigger) into its own nested Outlet so section components can read it too.
 */
export function SettingsPage() {
  const { messages } = useLanguage();
  const walletContext = useWalletContext();

  return (
    <div className="w-full overflow-y-auto px-8 py-8">
      <h1 className="text-xl font-semibold text-ink">{messages.settings.title}</h1>
      <p className="mt-1 text-sm text-ink-secondary">{messages.settings.subtitle}</p>

      <div className="mt-6 flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-card md:flex-row">
        <SettingsNav />
        <div className="min-h-[420px] flex-1">
          <Outlet context={walletContext} />
        </div>
      </div>
    </div>
  );
}
