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
    <div className="relative z-10 max-w-[1400px] mx-auto px-4 sm:px-6 py-4">
      <header className="flex items-center justify-between gap-3 border-b border-border pb-3 mb-5 sm:mb-8">
        {/* Left: logo + nav */}
        <div className="flex items-center gap-4 sm:gap-8 min-w-0">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <span className="w-2 h-2 bg-signal-buy pulse-dot rounded-full" />
            <span className="text-sm font-bold tracking-widest">EARNINGS EDGE</span>
          </Link>
          <nav className="flex gap-4 sm:gap-6 text-xs text-fg-muted overflow-x-auto">
            <Link href="/" className="hover:text-fg transition-colors py-1">TODAY</Link>
            <Link href="/watchlist" className="hover:text-fg transition-colors py-1">WATCHLIST</Link>
            <Link href="/history" className="hover:text-fg transition-colors py-1">HISTORY</Link>
          </nav>
        </div>
        {/* Right: theme toggle + time */}
        <div className="flex items-center gap-3 shrink-0">
          <ThemeToggle />
          <div className="hidden sm:block text-xs text-fg-subtle text-right">
            {now} PT
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="mt-12 sm:mt-16 pt-4 border-t border-border-subtle text-xs text-fg-dim">
        Decision support, not advice. Sizing is yours.
      </footer>
    </div>
  );
}
