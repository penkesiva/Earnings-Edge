'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  applyThemePreference,
  readResolvedIsLight,
  readThemePreference,
  type ThemePreference,
} from '@/lib/theme';

/** Button label = theme you switch to (opposite of current appearance). */
function label(isLight: boolean): string {
  return isLight ? '◗ DARK' : '☀ LIGHT';
}

function titleFor(pref: ThemePreference, isLight: boolean): string {
  const target = isLight ? 'dark' : 'light';
  if (pref === 'auto') {
    return `Using auto (7am–7pm light). Click to switch to ${target} theme.`;
  }
  return `Using ${isLight ? 'light' : 'dark'} theme. Click to switch to ${target}.`;
}

export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>('auto');
  const [isLight, setIsLight] = useState(false);

  const sync = useCallback(() => {
    const pref = readThemePreference();
    applyThemePreference(pref);
    setPreference(pref);
    setIsLight(readResolvedIsLight());
  }, []);

  useEffect(() => {
    sync();
  }, [sync]);

  function toggle() {
    const isLightNow = readResolvedIsLight();
    const next: ThemePreference = isLightNow ? 'dark' : 'light';
    applyThemePreference(next);
    setPreference(next);
    setIsLight(!isLightNow);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={titleFor(preference, isLight)}
      className="text-xs text-fg-subtle hover:text-fg border border-border hover:border-fg-subtle px-2 py-1 transition-colors tracking-widest shrink-0 max-w-[140px] truncate"
    >
      {label(isLight)}
    </button>
  );
}

