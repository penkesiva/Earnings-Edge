/** Comma-separated emails in AUTH_ALLOWED_EMAILS (lowercase). Empty = any signed-in user. */

export function parseAllowedEmails(): string[] | null {
  const raw = process.env.AUTH_ALLOWED_EMAILS?.trim();
  if (!raw) return null;
  const list = raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return list.length ? list : null;
}

export function isEmailAllowed(email: string | undefined | null): boolean {
  if (!email) return false;
  const list = parseAllowedEmails();
  if (!list) return true;
  return list.includes(email.toLowerCase());
}

/** Gate login when SITE_PASSWORD and/or AUTH_ALLOWED_EMAILS is set. */
export function authGateEnabled(): boolean {
  return !!(process.env.SITE_PASSWORD?.trim() || process.env.AUTH_ALLOWED_EMAILS?.trim());
}
