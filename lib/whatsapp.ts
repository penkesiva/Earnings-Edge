/**
 * WhatsApp notifications via Twilio REST API (no SDK dependency).
 *
 * Env:
 *   TWILIO_ACCOUNT_SID    — AC... from the Twilio console
 *   TWILIO_AUTH_TOKEN     — auth token for the same account
 *   TWILIO_WHATSAPP_FROM  — your WhatsApp-enabled Twilio number, e.g. +14155238886
 *   NOTIFY_WHATSAPP_TO    — your personal WhatsApp number, e.g. +1415XXXXXXX
 *
 * Numbers may be given with or without the whatsapp: prefix.
 */

function normalizeWhatsAppAddress(raw: string): string {
  const t = raw.trim();
  return t.startsWith('whatsapp:') ? t : `whatsapp:${t}`;
}

export function whatsappConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_WHATSAPP_FROM?.trim() &&
      process.env.NOTIFY_WHATSAPP_TO?.trim(),
  );
}

export async function sendWhatsAppMessage(
  body: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_WHATSAPP_FROM?.trim();
  const to = process.env.NOTIFY_WHATSAPP_TO?.trim();

  if (!sid || !token || !from || !to) {
    return { ok: false, error: 'Twilio WhatsApp env vars not configured.' };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const params = new URLSearchParams({
    From: normalizeWhatsAppAddress(from),
    To: normalizeWhatsAppAddress(to),
    // WhatsApp caps a message at 1600 chars.
    Body: body.slice(0, 1500),
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
      cache: 'no-store',
    });

    if (!res.ok) {
      const detail = await res.text();
      return { ok: false, error: `Twilio ${res.status}: ${detail.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
