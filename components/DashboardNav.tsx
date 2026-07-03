'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type NavLink = {
  href: string;
  label: string;
};

const PRIMARY_LINKS: NavLink[] = [
  { href: '/', label: 'Home' },
  { href: '/watchlist', label: 'Watchlist' },
  { href: '/trade', label: 'Trade' },
];

const SECONDARY_LINKS: NavLink[] = [
  { href: '/history', label: 'History' },
  { href: '/status', label: 'Status' },
  { href: '/settings', label: 'Settings' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavItem({ href, label, pathname }: NavLink & { pathname: string }) {
  const active = isActive(pathname, href);
  return (
    <Link
      href={href}
      prefetch={true}
      aria-current={active ? 'page' : undefined}
      className={`nav-link relative z-10 inline-flex items-center justify-center min-h-[44px] px-3 py-2 sm:px-2 sm:py-1.5 sm:min-h-0 rounded-sm text-sm font-medium whitespace-nowrap touch-manipulation ${
        active ? 'nav-link--active bg-accent-muted' : ''
      }`}
    >
      {label}
    </Link>
  );
}

export function DashboardNav({ showSettings }: { showSettings: boolean }) {
  const pathname = usePathname();
  const secondary = SECONDARY_LINKS.filter(
    link => link.href !== '/settings' || showSettings,
  );

  return (
    <nav aria-label="Main navigation" className="w-full min-w-0">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 sm:gap-x-2">
        {PRIMARY_LINKS.map(link => (
          <NavItem key={link.href} {...link} pathname={pathname} />
        ))}
        <span className="hidden sm:inline w-px h-4 bg-border-subtle mx-1" aria-hidden />
        {secondary.map(link => (
          <NavItem key={link.href} {...link} pathname={pathname} />
        ))}
      </div>
    </nav>
  );
}
