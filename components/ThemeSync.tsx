'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { applyTheme, readStoredTheme } from '@/lib/theme';

/** Re-apply theme on navigation so html.light is never dropped by RSC updates. */
export function ThemeSync() {
  const pathname = usePathname();

  useEffect(() => {
    applyTheme(readStoredTheme() === 'light');
  }, [pathname]);

  return null;
}
