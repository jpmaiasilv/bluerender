import { ReactNode } from 'react';
import { useInView } from '../../lib/useInView';

interface Props {
  children: ReactNode;
  className?: string;
  delayMs?: number;
}

/** Fades/slides content in once as it enters the viewport. No-ops visually under `prefers-reduced-motion` (Tailwind's `motion-reduce:` variant). */
export function Reveal({ children, className = '', delayMs = 0 }: Props) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out motion-reduce:transition-none motion-reduce:opacity-100 motion-reduce:translate-y-0 ${
        inView ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
      } ${className}`}
      style={{ transitionDelay: inView ? `${delayMs}ms` : '0ms' }}
    >
      {children}
    </div>
  );
}
