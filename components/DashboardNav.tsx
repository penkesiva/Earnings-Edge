'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Home', exact: true },
  { href: '/watchlist', label: 'Watchlist' },
  { href: '/trade', label: 'Trade' },
  { href: '/history', label: 'History' },
  { href: '/status', label: 'Status' },
  { href: '/settings', label: 'Settings' },
] as const;

function linkActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardNav({ showSettings }: { showSettings: boolean }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 sm:gap-5 text-sm overflow-x-auto -mx-1 px-1">
      {LINKS.filter(link => link.href !== '/settings' || showSettings).map(link => {
        const active = linkActive(pathname, link.href, 'exact' in link && link.exact);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`nav-link py-2 px-2 sm:px-0 sm:py-1 shrink-0 font-medium ${
              active ? 'nav-link--active' : ''
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
