// Comms Director Workspace — one-off waiver sending & status report.
//
//   POST /api/waiver-send          — Comms sends a waiver link to an ad-hoc
//                                    adult (not tied to a registration).
//                                    Body: { name, email, note? }
//   GET  /api/waiver-send?list=1   — Comms pulls the unified waiver status
//                                    report (backup_coach_waivers + one_off_waivers)
//                                    for the Workspace widget.
//
// Both endpoints require the caller to authenticate as Communications Director
// via canEditAsRole (or be the super user communications@ account).

const crypto = require('crypto');
const { Resend } = require('resend');
const { neon } = require('@neondatabase/serverless');
const { OAuth2Client } = require('google-auth-library');
const { ALLOWED_ORIGINS } = require('./_config');
const { canEditAsRole } = require('./_permissions');

const GOOGLE_CLIENT_ID = '915526936965-ibd6qsd075dabjvuouon38n7ceq4p01i.apps.googleusercontent.com';
const ALLOWED_DOMAIN = 'rootsandwingsindy.com';
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID);

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getSql() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not configured');
  return neon(process.env.DATABASE_URL);
}

async function verifyAuth(req) {
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

function setCors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.indexOf(origin) !== -1) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  if (!(await canEditAsRole(user.email, 'Communications Director'))) {
    return res.status(403).json({ error: 'Only the Communications Director can manage one-off waivers.' });
  }

  try {
    const sql = getSql();

    // ── GET: waiver status report (unified view) ──
    if (req.method === 'GET') {
      const backup = await sql`
        SELECT 'backup' AS source, b.id, b.name, b.email, b.signed_at,
               b.created_at AS sent_at, r.main_learning_coach AS sent_by, r.season
        FROM backup_coach_waivers b
        JOIN registrations r ON r.id = b.registration_id
        ORDER BY b.created_at DESC
      `;
      const oneOff = await sql`
        SELECT 'one_off' AS source, id, name, email, signed_at, sent_at,
               sent_by_email AS sent_by, note
        FROM one_off_waivers
        ORDER BY sent_at DESC
      `;
      return res.status(200).json({ backup, oneOff });
    }

    // ── POST: send a one-off waiver ──
    if (req.method === 'POST') {
      const body = req.body || {};
      const name = String(body.name || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const note = String(body.note || '').trim().slice(0, 500);

      if (!name) return res.status(400).json({ error: 'Recipient name is required.' });
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Valid recipient email is required.' });
      if (name.length > 200) return res.status(400).json({ error: 'Name too long.' });

      const token = crypto.randomUUID().replace(/-/g, '');

      await sql`
        INSERT INTO one_off_waivers (name, email, token, sent_by_email, note)
        VALUES (${name}, ${email}, ${token}, ${user.email}, ${note})
      `;

      const baseUrl = (req.headers['x-forwarded-proto'] && req.headers.host)
        ? `${req.headers['x-forwarded-proto']}://${req.headers.host}`
        : 'https://roots-and-wings-topaz.vercel.app';
      const link = `${baseUrl}/waiver.html?token=${encodeURIComponent(token)}`;

      // Best-effort email — if Resend fails, the row is still stored and
      // Comms can resend by copying the link from the report row.
      let emailed = false;
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: 'Roots & Wings Website <noreply@rootsandwingsindy.com>',
          to: email,
          replyTo: 'membership@rootsandwingsindy.com',
          subject: `Roots & Wings Co-op: Please sign the waiver`,
          html: `
            <h2>Roots &amp; Wings Co-op waiver</h2>
            <p>Hi ${escapeHtml(name)},</p>
            <p>Please review and sign the Roots &amp; Wings Homeschool Co-op waiver before joining us at co-op.</p>
            ${note ? `<p style="background:#f5f0f8;padding:10px 14px;border-left:3px solid #523A79;border-radius:4px;"><em>${escapeHtml(note)}</em></p>` : ''}
            <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#523A79;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Review &amp; sign the waiver</a></p>
            <p style="color:#666;font-size:0.9rem;">Or copy this link into your browser:<br><span style="word-break:break-all;">${escapeHtml(link)}</span></p>
            <p style="color:#666;font-size:0.9rem;margin-top:20px;">Questions? Reply to this email and it'll reach the Membership team.</p>
          `,
        });
        emailed = true;
      } catch (mailErr) {
        console.error('One-off waiver email error (non-fatal):', mailErr);
      }

      return res.status(200).json({ success: true, emailed, link });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('waiver-send error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
