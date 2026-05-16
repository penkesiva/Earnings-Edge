export const THEME_COOKIE = 'ee_theme';

/** Runs before paint — keep in sync with applyTheme() in ThemeToggle. */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');if(!t){var m=document.cookie.match(/${THEME_COOKIE}=(light|dark)/);t=m&&m[1]}if(t==='light')document.documentElement.classList.add('light');else document.documentElement.classList.remove('light')}catch(e){}})();`;

export function applyTheme(isLight: boolean): void {
  document.documentElement.classList.toggle('light', isLight);
  const value = isLight ? 'light' : 'dark';
  try {
    localStorage.setItem('theme', value);
  } catch {
    /* private mode */
  }
  document.cookie = `${THEME_COOKIE}=${value};path=/;max-age=31536000;SameSite=Lax`;
}

export function readStoredTheme(): 'light' | 'dark' | null {
  if (typeof window === 'undefined') return null;
  try {
    const ls = localStorage.getItem('theme');
    if (ls === 'light' || ls === 'dark') return ls;
  } catch {
    /* ignore */
  }
  const m = document.cookie.match(new RegExp(`${THEME_COOKIE}=(light|dark)`));
  if (m?.[1] === 'light' || m?.[1] === 'dark') return m[1];
  return null;
}
