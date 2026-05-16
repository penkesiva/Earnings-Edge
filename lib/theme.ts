export const THEME_COOKIE = 'ee_theme';

/** Single source of truth for pre-paint theme (inline script + SSR cookie should match). */
export const THEME_INIT_SCRIPT = `(function(){try{var ls=localStorage.getItem('theme');var m=document.cookie.match(/ee_theme=(light|dark)/);var ck=m&&m[1];var t=ls||ck||'dark';if(ls&&ck&&ls!==ck)t=ls;if(!ls&&ck){try{localStorage.setItem('theme',ck)}catch(e){}t=ck}if(t==='light'){document.documentElement.classList.add('light');document.cookie='ee_theme=light;path=/;max-age=31536000;SameSite=Lax'}else{document.documentElement.classList.remove('light');document.cookie='ee_theme=dark;path=/;max-age=31536000;SameSite=Lax'}}catch(e){}})();`;

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

export function readStoredTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark';
  try {
    const ls = localStorage.getItem('theme');
    if (ls === 'light' || ls === 'dark') return ls;
  } catch {
    /* ignore */
  }
  const m = document.cookie.match(new RegExp(`${THEME_COOKIE}=(light|dark)`));
  if (m?.[1] === 'light' || m?.[1] === 'dark') return m[1];
  return document.documentElement.classList.contains('light') ? 'light' : 'dark';
}
