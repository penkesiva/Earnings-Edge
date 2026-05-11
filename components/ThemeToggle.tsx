'use client';

import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const [isLight, setIsLight] = useState(false);

  // Sync with whatever the anti-FOUC script already applied.
  useEffect(() => {
    setIsLight(document.documentElement.classList.contains('light'));
  }, []);

  function toggle() {
    const next = !isLight;
    document.documentElement.classList.toggle('light', next);
    try { localStorage.setItem('theme', next ? 'light' : 'dark'); } catch { /* private mode */ }
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
