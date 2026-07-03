import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BuildStamp } from '@/components/BuildStamp';
import { SignOutButton } from '@/components/SignOutButton';
import { DashboardNav } from '@/components/DashboardNav';
import { authGateEnabled } from '@/lib/authAllowlist';

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

  const showSignOut = authGateEnabled();

  return (
    <div className="relative z-10 max-w-[1400px] mx-auto px-3 sm:px-6 py-3 sm:py-4">
      <header className="app-header pb-3 mb-5 sm:mb-8">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2 shrink-0 min-w-0 group">
            <span className="w-2 h-2 bg-accent pulse-dot rounded-full shrink-0 shadow-[0_0_8px_var(--color-accent-border)]" />
            <span className="text-base sm:text-lg font-serif font-bold tracking-tight truncate">
              Earnings <span className="text-accent">Edge</span>
            </span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {showSignOut ? <SignOutButton /> : null}
            <ThemeToggle />
            <div className="hidden sm:block text-xs text-fg-subtle whitespace-nowrap tabular-nums">
              {now} PT
            </div>
            <div className="sm:hidden text-[10px] text-fg-dim tabular-nums">{now}</div>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-border-subtle sm:mt-4 sm:flex sm:items-center sm:justify-between sm:gap-6">
          <DashboardNav showSettings={showSignOut} />
        </div>
      </header>

      <main>{children}</main>

      <footer className="mt-10 sm:mt-16 pt-4 border-t border-border-subtle text-xs text-fg-dim flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <span>Decision support, not advice. Sizing is yours.</span>
        <BuildStamp />
      </footer>
    </div>
  );
}
