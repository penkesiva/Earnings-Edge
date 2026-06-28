/** Comma-separated emails in AUTH_ALLOWED_EMAILS. Unset/empty = any signed-in Google user. */

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

export function authRequired(): boolean {
  const v = process.env.AUTH_REQUIRED?.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

/** Login gate: AUTH_REQUIRED, SITE_PASSWORD, or non-empty AUTH_ALLOWED_EMAILS. */
export function authGateEnabled(): boolean {
  return (
    authRequired() ||
    !!(process.env.SITE_PASSWORD?.trim() || process.env.AUTH_ALLOWED_EMAILS?.trim())
  );
}
