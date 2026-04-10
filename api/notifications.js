// Notifications API
//
// GET   /api/notifications                    → list notifications for current user
// PATCH /api/notifications?id=N               → mark one as read
// PATCH /api/notifications?mark_all_read=true → mark all as read

const { neon } = require('@neondatabase/serverless');
const { OAuth2Client } = require('google-auth-library');
const { ALLOWED_ORIGINS } = require('./_config');

const GOOGLE_CLIENT_ID = '915526936965-ibd6qsd075dabjvuouon38n7ceq4p01i.apps.googleusercontent.com';
const ALLOWED_DOMAIN = 'rootsandwingsindy.com';
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID);

async function verifyGoogleAuth(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken: authHeader.slice(7), audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const email = payload.email || '';
    if ((email.split('@')[1] || '') !== ALLOWED_DOMAIN) return null;
    return { email, name: payload.name || '' };
  } catch (e) { return null; }
}

function getSql() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not configured');
  return neon(process.env.DATABASE_URL);
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.indexOf(origin) !== -1) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyGoogleAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const sql = getSql();

    if (req.method === 'GET') {
      const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
      const unreadOnly = req.query.unread_only === 'true';
      let rows;
      if (unreadOnly) {
        rows = await sql`
          SELECT id, type, title, body, link_url, related_absence_id, is_read, created_at
          FROM notifications
          WHERE recipient_email = ${user.email} AND is_read = FALSE
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;
      } else {
        rows = await sql`
          SELECT id, type, title, body, link_url, related_absence_id, is_read, created_at
          FROM notifications
          WHERE recipient_email = ${user.email}
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;
      }
      const unreadCount = await sql`
        SELECT COUNT(*)::int AS count FROM notifications
        WHERE recipient_email = ${user.email} AND is_read = FALSE
      `;
      return res.status(200).json({ notifications: rows, unread_count: unreadCount[0].count });
    }

    if (req.method === 'PATCH') {
      if (req.query.mark_all_read === 'true') {
        await sql`
          UPDATE notifications SET is_read = TRUE
          WHERE recipient_email = ${user.email} AND is_read = FALSE
        `;
        return res.status(200).json({ ok: true });
      }
      const id = parseInt(req.query.id, 10);
      if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'id required' });
      await sql`
        UPDATE notifications SET is_read = TRUE
        WHERE id = ${id} AND recipient_email = ${user.email}
      `;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Notifications API error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
