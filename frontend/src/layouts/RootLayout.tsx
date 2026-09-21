import { useEffect, useState } from 'react';
import { Outlet, useOutletContext } from 'react-router-dom';
import { AppSidebar } from '../components/AppSidebar';
import { Header } from '../components/Header';
import { UpgradeModal } from '../components/UpgradeModal';
import { ManagementSyncBanner } from '../components/ManagementSyncBanner';
import { addTestCredits, fetchWalletBalance } from '../lib/api';

export interface WalletContext {
  walletBalance: number;
  /** False until the first real /api/wallet fetch resolves — lets a tool show a skeleton instead of a misleading "0 credits" cost preview. */
  walletLoaded: boolean;
  refreshWallet: () => void;
  openUpgradeModal: () => void;
}

/** Tool pages read the shared wallet state via `const { walletBalance } = useWalletContext();`. */
export function useWalletContext(): WalletContext {
  return useOutletContext<WalletContext>();
}

export function RootLayout() {
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletLoaded, setWalletLoaded] = useState(false);
  const [addingCredits, setAddingCredits] = useState(false);
  const [isUpgradeModalOpen, setUpgradeModalOpen] = useState(false);

  function refreshWallet() {
    fetchWalletBalance()
      .then((balance) => {
        setWalletBalance(balance);
        setWalletLoaded(true);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    refreshWallet();
  }, []);

  async function handleAddTestCredits() {
    setAddingCredits(true);
    try {
      const balance = await addTestCredits();
      setWalletBalance(balance);
    } catch {
      // Non-critical dev affordance — silently ignore, balance just stays as-is.
    } finally {
      setAddingCredits(false);
    }
  }

  const openUpgradeModal = () => setUpgradeModalOpen(true);
  const context: WalletContext = { walletBalance, walletLoaded, refreshWallet, openUpgradeModal };

  return (
    <div className="flex h-screen bg-surface-secondary">
      <AppSidebar onOpenUpgrade={openUpgradeModal} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          balance={walletBalance}
          onAddTestCredits={handleAddTestCredits}
          addingCredits={addingCredits}
          onOpenUpgrade={openUpgradeModal}
        />
        <main className="flex flex-1 overflow-hidden">
          <Outlet context={context} />
        </main>
      </div>

      <UpgradeModal open={isUpgradeModalOpen} onClose={() => setUpgradeModalOpen(false)} />
      <ManagementSyncBanner />
    </div>
  );
}
