'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import {
  applyThemePreference,
  readThemePreference,
  resolveIsLight,
} from '@/lib/theme';

const AUTO_CHECK_MS = 60_000;

/** Re-apply theme on navigation and tick auto mode at hour boundaries. */
export function ThemeSync() {
  const pathname = usePathname();

  useEffect(() => {
    const pref = readThemePreference();
    applyThemePreference(pref);
  }, [pathname]);

  useEffect(() => {
    const pref = readThemePreference();
    if (pref !== 'auto') return;

    const id = window.setInterval(() => {
      const current = readThemePreference();
      if (current !== 'auto') return;
      const shouldBeLight = resolveIsLight('auto');
      const isLight = document.documentElement.classList.contains('light');
      if (shouldBeLight !== isLight) {
        applyThemePreference('auto');
      }
    }, AUTO_CHECK_MS);

    return () => window.clearInterval(id);
  }, [pathname]);

  return null;
}
