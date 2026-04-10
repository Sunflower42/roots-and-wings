// Shared web-push helper (underscore prefix = not a Vercel route)

const webpush = require('web-push');

function init() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    console.warn('VAPID keys not configured — push notifications disabled');
    return false;
  }
  webpush.setVapidDetails('mailto:communications@rootsandwingsindy.com', pub, priv);
  return true;
}

async function sendToUser(sql, email, payload) {
  if (!init()) return;
  const subs = await sql`
    SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_email = ${email}
  `;
  const results = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
      results.push({ endpoint: sub.endpoint, ok: true });
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        // Subscription expired — clean up
        await sql`DELETE FROM push_subscriptions WHERE endpoint = ${sub.endpoint}`;
      }
      results.push({ endpoint: sub.endpoint, ok: false, error: err.message });
    }
  }
  return results;
}

async function broadcastAll(sql, payload) {
  if (!init()) return;
  const subs = await sql`SELECT endpoint, p256dh, auth FROM push_subscriptions`;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await sql`DELETE FROM push_subscriptions WHERE endpoint = ${sub.endpoint}`;
      }
    }
  }
}

module.exports = { sendToUser, broadcastAll };
