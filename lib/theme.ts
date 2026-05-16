export const THEME_COOKIE = 'ee_theme';

/** User choice. Default for new visitors is auto (time-of-day). */
export type ThemePreference = 'auto' | 'light' | 'dark';

/** Local hour when light theme starts (inclusive). Uses device timezone (PST, EST, etc.). */
export const LIGHT_THEME_START_HOUR = 7;
/** Local hour when light theme ends (exclusive) — dark from this hour onward. */
export const LIGHT_THEME_END_HOUR = 19;

export function isDaytimeLocal(date = new Date()): boolean {
  const hour = date.getHours();
  return hour >= LIGHT_THEME_START_HOUR && hour < LIGHT_THEME_END_HOUR;
}

export function resolveIsLight(preference: ThemePreference, date = new Date()): boolean {
  if (preference === 'light') return true;
  if (preference === 'dark') return false;
  return isDaytimeLocal(date);
}

export function parseThemePreference(value: string | null | undefined): ThemePreference {
  if (value === 'light' || value === 'dark' || value === 'auto') return value;
  return 'auto';
}

export function readThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'auto';
  try {
    const ls = localStorage.getItem('theme');
    if (ls === 'light' || ls === 'dark' || ls === 'auto') return ls;
  } catch {
    /* ignore */
  }
  const m = document.cookie.match(new RegExp(`${THEME_COOKIE}=(auto|light|dark)`));
  if (m?.[1] === 'auto' || m?.[1] === 'light' || m?.[1] === 'dark') return m[1];
  return 'auto';
}

export function applyThemePreference(preference: ThemePreference): void {
  const isLight = resolveIsLight(preference);
  document.documentElement.classList.toggle('light', isLight);
  try {
    localStorage.setItem('theme', preference);
  } catch {
    /* private mode */
  }
  document.cookie = `${THEME_COOKIE}=${preference};path=/;max-age=31536000;SameSite=Lax`;
}

/** @deprecated use applyThemePreference */
export function applyTheme(isLight: boolean): void {
  applyThemePreference(isLight ? 'light' : 'dark');
}

/** Resolved appearance (after auto schedule). */
export function readResolvedIsLight(): boolean {
  return resolveIsLight(readThemePreference());
}

/**
 * Inline pre-paint script — must stay in sync with resolveIsLight() above.
 * Uses Date#getHours() = browser local timezone (PST on West Coast, EST on East Coast).
 */
export const THEME_INIT_SCRIPT = `(function(){try{var START=${LIGHT_THEME_START_HOUR},END=${LIGHT_THEME_END_HOUR};function day(){var h=new Date().getHours();return h>=START&&h<END}function lit(t){if(t==='light')return true;if(t==='dark')return false;return day()}var ls=localStorage.getItem('theme');var m=document.cookie.match(/ee_theme=(auto|light|dark)/);var ck=m&&m[1];var t=ls||ck||'auto';if(ls&&ck&&ls!==ck)t=ls;if(!ls&&ck){try{localStorage.setItem('theme',ck)}catch(e){}t=ck}if(t!=='light'&&t!=='dark'&&t!=='auto')t='auto';var on=lit(t);if(on)document.documentElement.classList.add('light');else document.documentElement.classList.remove('light');document.cookie='ee_theme='+t+';path=/;max-age=31536000;SameSite=Lax'}catch(e){}})();`;
