import Link from 'next/link';

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
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4 mb-6 sm:mb-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
          <Link href="/" className="flex items-center gap-3">
            <span className="w-2 h-2 bg-signal-buy pulse-dot rounded-full" />
            <span className="text-sm font-bold tracking-widest">EARNINGS EDGE</span>
          </Link>
          <nav className="flex gap-4 sm:gap-6 text-xs text-fg-muted overflow-x-auto">
            <Link href="/" className="hover:text-fg transition-colors">TODAY</Link>
            <Link href="/watchlist" className="hover:text-fg transition-colors">WATCHLIST</Link>
            <Link href="/history" className="hover:text-fg transition-colors">HISTORY</Link>
          </nav>
        </div>
        <div className="text-xs text-fg-subtle sm:text-right">
          {now} PT
        </div>
      </header>

      <main>{children}</main>

      <footer className="mt-16 pt-4 border-t border-border-subtle text-xs text-fg-dim">
        Decision support, not advice. Sizing is yours.
      </footer>
    </div>
  );
}
