'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  applyThemePreference,
  isDaytimeLocal,
  readResolvedIsLight,
  readThemePreference,
  type ThemePreference,
} from '@/lib/theme';

const CYCLE: ThemePreference[] = ['auto', 'light', 'dark'];

function nextPreference(current: ThemePreference): ThemePreference {
  const i = CYCLE.indexOf(current);
  return CYCLE[(i + 1) % CYCLE.length];
}

function label(pref: ThemePreference, isLight: boolean): string {
  if (pref === 'auto') {
    return isLight ? '◎ AUTO · DAY' : '◎ AUTO · NIGHT';
  }
  return pref === 'light' ? '☀ LIGHT' : '◗ DARK';
}

function titleFor(pref: ThemePreference): string {
  if (pref === 'auto') {
    return 'Theme follows your local time (7am–7pm light). Click to lock light, then dark, then auto.';
  }
  if (pref === 'light') return 'Locked to light theme. Click for dark, then auto.';
  return 'Locked to dark theme. Click for auto (time-of-day).';
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
    const pref = readThemePreference();
    const next = nextPreference(pref);
    applyThemePreference(next);
    setPreference(next);
    setIsLight(resolveIsLightClient(next));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={titleFor(preference)}
      className="text-xs text-fg-subtle hover:text-fg border border-border hover:border-fg-subtle px-2 py-1 transition-colors tracking-widest shrink-0 max-w-[140px] truncate"
    >
      {label(preference, isLight)}
    </button>
  );
}

function resolveIsLightClient(pref: ThemePreference): boolean {
  if (pref === 'light') return true;
  if (pref === 'dark') return false;
  return isDaytimeLocal();
}
