import webpush from 'web-push';
import { supabaseAdmin } from './supabase';

let vapidConfigured = false;

function ensureVapid() {
  if (vapidConfigured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:noreply@example.com',
    publicKey,
    privateKey
  );
  vapidConfigured = true;
  return true;
}

export async function sendPush(payload: {
  userId: string;
  ticker: string;
  signal: string;
  score: number;
  briefId: string;
}) {
  if (!ensureVapid()) return;

  const sb = supabaseAdmin();
  const { data: subs } = await sb
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', payload.userId);

  if (!subs?.length) return;

  const message = JSON.stringify({
    title: `${payload.ticker}: ${payload.signal} (${payload.score})`,
    body: `Earnings brief ready. Tap to view.`,
    url: `/briefs/${payload.briefId}`,
  });

  await Promise.all(
    subs.map(sub =>
      webpush
        .sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          message
        )
        .catch(err => {
          // 410 Gone — subscription expired, clean it up
          if (err.statusCode === 410) {
            return sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
          }
          console.error('Push error:', err);
        })
    )
  );
}
