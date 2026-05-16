import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const now = new Date().toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return (
    <div className="relative z-10 max-w-[1400px] mx-auto px-3 sm:px-6 py-3 sm:py-4">
      <header className="border-b border-border pb-3 mb-5 sm:mb-8 space-y-3 sm:space-y-0 sm:flex sm:items-center sm:justify-between sm:gap-3">
        <div className="flex items-center justify-between gap-3 min-w-0">
          <Link href="/" className="flex items-center gap-2 shrink-0 min-w-0">
            <span className="w-2 h-2 bg-signal-buy pulse-dot rounded-full shrink-0" />
            <span className="text-[11px] sm:text-sm font-bold tracking-widest truncate">
              EARNINGS EDGE
            </span>
          </Link>
          <div className="flex items-center gap-2 sm:hidden shrink-0">
            <span className="text-[10px] text-fg-dim font-mono tabular-nums">{now}</span>
            <ThemeToggle />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 sm:gap-8 min-w-0">
          <nav className="flex gap-1 sm:gap-6 text-xs text-fg-muted overflow-x-auto -mx-1 px-1">
            <Link
              href="/"
              className="hover:text-fg transition-colors py-2 px-2 sm:px-0 sm:py-1 shrink-0"
            >
              HOME
            </Link>
            <Link
              href="/watchlist"
              className="hover:text-fg transition-colors py-2 px-2 sm:px-0 sm:py-1 shrink-0"
            >
              WATCHLIST
            </Link>
            <Link
              href="/history"
              className="hover:text-fg transition-colors py-2 px-2 sm:px-0 sm:py-1 shrink-0"
            >
              HISTORY
            </Link>
          </nav>
          <div className="hidden sm:flex items-center gap-3 shrink-0">
            <ThemeToggle />
            <div className="text-xs text-fg-subtle text-right whitespace-nowrap">{now} PT</div>
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="mt-10 sm:mt-16 pt-4 border-t border-border-subtle text-xs text-fg-dim">
        Decision support, not advice. Sizing is yours.
      </footer>
    </div>
  );
}
