'use client';

import { useEffect, useState } from 'react';
import { applyTheme, readStoredTheme } from '@/lib/theme';

export function ThemeToggle() {
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    const stored = readStoredTheme();
    const next = stored === 'light' || (stored === null && document.documentElement.classList.contains('light'));
    applyTheme(next);
    setIsLight(next);
  }, []);

  function toggle() {
    const next = !isLight;
    applyTheme(next);
    setIsLight(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
      className="text-xs text-fg-subtle hover:text-fg border border-border hover:border-fg-subtle px-2 py-1 transition-colors tracking-widest shrink-0"
    >
      {isLight ? '◗ DARK' : '☀ LIGHT'}
    </button>
  );
}
