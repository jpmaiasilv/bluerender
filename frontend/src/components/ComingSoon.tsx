import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n';

interface Props {
  icon: LucideIcon;
  title: string;
  message: string;
}

/** Elegant placeholder for a tool page whose backend doesn't exist yet — never simulates a result. */
export function ComingSoon({ icon: Icon, title, message }: Props) {
  const { messages } = useLanguage();

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 py-20 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-sapphire-light">
        <Icon size={28} className="text-sapphire" strokeWidth={1.75} />
      </div>
      <span className="mb-3 rounded-full bg-sapphire-light px-3 py-1 text-xs font-semibold text-sapphire">
        {messages.comingSoon.badge}
      </span>
      <h1 className="text-xl font-semibold text-ink">{title}</h1>
      <p className="mt-2 max-w-md text-sm text-ink-secondary">{message}</p>
      <Link to="/painel" className="mt-6 text-sm font-medium text-sapphire hover:underline">
        {messages.comingSoon.backToHome}
      </Link>
    </div>
  );
}
