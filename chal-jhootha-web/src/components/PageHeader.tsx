import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useLocation } from 'wouter';
import { ThemeToggle } from './ThemeToggle';

type PageHeaderProps = {
  title: string;
  backTo?: string;
  action?: ReactNode;
};

export function PageHeader({ title, backTo = '/', action }: PageHeaderProps) {
  const [, setLocation] = useLocation();

  return (
    <header className="page-container mb-7 flex min-h-12 items-center justify-between gap-3">
      <button
        type="button"
        onClick={() => setLocation(backTo)}
        className="brutal-btn brutal-btn-compact inline-flex shrink-0 items-center gap-2 bg-surface text-ink"
      >
        <ArrowLeft size={17} strokeWidth={2.5} />
        <span>Back</span>
      </button>
      <p className="min-w-0 flex-1 truncate text-center font-mono text-xs font-bold uppercase tracking-[0.14em] text-ink-muted">
        {title}
      </p>
      <div className="flex shrink-0 items-center gap-2">
        {action}
        <ThemeToggle />
      </div>
    </header>
  );
}
