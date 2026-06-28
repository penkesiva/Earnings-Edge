import type { CookieOptions } from '@supabase/ssr';

export type SupabaseCookie = { name: string; value: string; options: CookieOptions };

export type SupabaseCookieMethods = {
  getAll(): { name: string; value: string }[];
  setAll(cookiesToSet: SupabaseCookie[]): void;
};
