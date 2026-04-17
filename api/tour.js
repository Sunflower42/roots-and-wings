// Public intake endpoint.
// Handles two kinds of submissions, distinguished by body.kind:
//   - 'tour'         : forwards a tour request via Resend (default, legacy)
//   - 'registration' : saves a new registration to the DB + emails membership
//   - 'registration-payment' : PATCH-style update of an existing registration's
//                              PayPal status after onApprove fires
// Also supports GET ?list=registrations for authed VPs/membership coordinators.

const { Resend } = require('resend');
const { neon } = require('@neondatabase/serverless');
const { OAuth2Client } = require('google-auth-library');
const { ALLOWED_ORIGINS } = require('./_config');

const GOOGLE_CLIENT_ID = '915526936965-ibd6qsd075dabjvuouon38n7ceq4p01i.apps.googleusercontent.com';
const ALLOWED_DOMAIN = 'rootsandwingsindy.com';
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID);

const REGISTRATION_FEE = 50;
const DEFAULT_SEASON = '2025-2026';
const VALID_TRACKS = ['Morning Only', 'Afternoon Only', 'Both', 'Other'];
const VALID_PHOTO = ['yes', 'no'];

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

async function verifyWorkspaceAuth(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken: authHeader.slice(7), audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const email = payload.email || '';
    if ((email.split('@')[1] || '') !== ALLOWED_DOMAIN) return null;
    return { email };
  } catch (e) { return null; }
}

function setCors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.indexOf(origin) !== -1) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

// ── Tour request (legacy) ──
async function handleTour(body, res) {
  const { name, email, phone, numKids, ages } = body;

  if (!name || !email || !phone || !numKids || !ages) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  if (String(name).length > 200 || String(email).length > 200 ||
      String(phone).length > 50 || String(ages).length > 200) {
    return res.status(400).json({ error: 'Input too long.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email format.' });
  }

  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safePhone = escapeHtml(phone);
  const safeNumKids = escapeHtml(numKids);
  const safeAges = escapeHtml(ages);

  const resend = new Resend(process.env.RESEND_API_KEY);
  try {
    const { error } = await resend.emails.send({
      from: 'Roots & Wings Website <noreply@rootsandwingsindy.com>',
      to: 'membership@rootsandwingsindy.com',
      replyTo: email,
      subject: `New Tour Request from ${safeName}`,
      html: `
        <h2>New Tour Request</h2>
        <table style="border-collapse:collapse;font-family:sans-serif;">
          <tr><td style="padding:8px 16px 8px 0;font-weight:bold;">Name</td><td style="padding:8px 0;">${safeName}</td></tr>
          <tr><td style="padding:8px 16px 8px 0;font-weight:bold;">Email</td><td style="padding:8px 0;"><a href="mailto:${safeEmail}">${safeEmail}</a></td></tr>
          <tr><td style="padding:8px 16px 8px 0;font-weight:bold;">Phone</td><td style="padding:8px 0;">${safePhone}</td></tr>
          <tr><td style="padding:8px 16px 8px 0;font-weight:bold;">Number of Kids</td><td style="padding:8px 0;">${safeNumKids}</td></tr>
          <tr><td style="padding:8px 16px 8px 0;font-weight:bold;">Ages</td><td style="padding:8px 0;">${safeAges}</td></tr>
        </table>
      `,
    });
    if (error) {
      console.error('Tour email error:', error);
      return res.status(500).json({ error: 'Failed to send. Please try again.' });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Tour email error:', err);
    return res.status(500).json({ error: 'Failed to send. Please try again.' });
  }
}

// ── Registration (public, no auth) ──
async function handleRegistration(body, res) {
  const email = String(body.email || '').trim().toLowerCase();
  const main_learning_coach = String(body.main_learning_coach || '').trim();
  const address = String(body.address || '').trim();
  const phone = String(body.phone || '').trim();
  const track = String(body.track || '').trim();
  const track_other = String(body.track_other || '').trim();
  const existing_family_name = String(body.existing_family_name || '').trim();
  const placement_notes = String(body.placement_notes || '').trim().slice(0, 2000);
  const waiver_member_agreement = body.waiver_member_agreement === true;
  const waiver_photo_consent = String(body.waiver_photo_consent || '').trim().toLowerCase();
  const waiver_liability = body.waiver_liability === true;
  const signature_name = String(body.signature_name || '').trim();
  const signature_date = String(body.signature_date || '').trim();
  const student_signature = String(body.student_signature || '').trim();
  const season = String(body.season || DEFAULT_SEASON).trim();
  const kids = Array.isArray(body.kids) ? body.kids : [];

  // Validate email
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required.' });
  }
  if (!main_learning_coach) return res.status(400).json({ error: 'Main Learning Coach name required.' });
  if (!address) return res.status(400).json({ error: 'Address required.' });
  if (!phone) return res.status(400).json({ error: 'Phone number required.' });
  if (VALID_TRACKS.indexOf(track) === -1) return res.status(400).json({ error: 'Select AM / PM / Both.' });
  if (kids.length === 0) return res.status(400).json({ error: 'At least one child required.' });
  if (kids.length > 10) return res.status(400).json({ error: 'Too many children.' });
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (!k || !k.name || !k.birth_date) {
      return res.status(400).json({ error: 'Each child needs a name and birth date.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k.birth_date)) {
      return res.status(400).json({ error: 'Birth date must be YYYY-MM-DD.' });
    }
  }
  if (!waiver_member_agreement) return res.status(400).json({ error: 'Member agreement acknowledgment required.' });
  if (!waiver_liability) return res.status(400).json({ error: 'Liability waiver acknowledgment required.' });
  if (VALID_PHOTO.indexOf(waiver_photo_consent) === -1) return res.status(400).json({ error: 'Photo/media consent required.' });
  if (!signature_name) return res.status(400).json({ error: 'Signature required.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(signature_date)) return res.status(400).json({ error: 'Signature date required.' });

  // Length caps
  if (email.length > 200 || main_learning_coach.length > 200 || address.length > 500 ||
      phone.length > 50 || signature_name.length > 200 || student_signature.length > 200) {
    return res.status(400).json({ error: 'One or more fields are too long.' });
  }

  const sql = getSql();

  try {
    const inserted = await sql`
      INSERT INTO registrations (
        season, email, existing_family_name, main_learning_coach, address, phone,
        track, track_other, kids, placement_notes,
        waiver_member_agreement, waiver_photo_consent, waiver_liability,
        signature_name, signature_date, student_signature,
        payment_status, payment_amount
      ) VALUES (
        ${season}, ${email}, ${existing_family_name || null}, ${main_learning_coach}, ${address}, ${phone},
        ${track}, ${track_other}, ${JSON.stringify(kids)}::jsonb, ${placement_notes},
        ${waiver_member_agreement}, ${waiver_photo_consent}, ${waiver_liability},
        ${signature_name}, ${signature_date}, ${student_signature},
        'pending', ${REGISTRATION_FEE}
      )
      RETURNING id, created_at
    `;
    const id = inserted[0].id;

    // Fire off a confirmation email (best effort — don't fail the request if it errors)
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const kidsList = kids.map(k => `<li>${escapeHtml(k.name)} &mdash; ${escapeHtml(k.birth_date)}</li>`).join('');
      await resend.emails.send({
        from: 'Roots & Wings Website <noreply@rootsandwingsindy.com>',
        to: 'membership@rootsandwingsindy.com',
        replyTo: email,
        subject: `New ${season} Registration — ${main_learning_coach}`,
        html: `
          <h2>New Registration Submitted</h2>
          <table style="border-collapse:collapse;font-family:sans-serif;">
            <tr><td style="padding:6px 16px 6px 0;font-weight:bold;">Season</td><td>${escapeHtml(season)}</td></tr>
            <tr><td style="padding:6px 16px 6px 0;font-weight:bold;">Main Learning Coach</td><td>${escapeHtml(main_learning_coach)}</td></tr>
            <tr><td style="padding:6px 16px 6px 0;font-weight:bold;">Email</td><td><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
            <tr><td style="padding:6px 16px 6px 0;font-weight:bold;">Phone</td><td>${escapeHtml(phone)}</td></tr>
            <tr><td style="padding:6px 16px 6px 0;font-weight:bold;">Address</td><td>${escapeHtml(address)}</td></tr>
            <tr><td style="padding:6px 16px 6px 0;font-weight:bold;">Track</td><td>${escapeHtml(track)}${track_other ? ' — ' + escapeHtml(track_other) : ''}</td></tr>
            <tr><td style="padding:6px 16px 6px 0;font-weight:bold;">Returning family</td><td>${existing_family_name ? escapeHtml(existing_family_name) : '(new)'}</td></tr>
            <tr><td style="padding:6px 16px 6px 0;font-weight:bold;">Photo consent</td><td>${escapeHtml(waiver_photo_consent)}</td></tr>
            <tr><td style="padding:6px 16px 6px 0;font-weight:bold;">Signature</td><td>${escapeHtml(signature_name)} on ${escapeHtml(signature_date)}</td></tr>
          </table>
          <h3>Children</h3>
          <ul>${kidsList}</ul>
          ${placement_notes ? `<h3>Placement notes</h3><p>${escapeHtml(placement_notes)}</p>` : ''}
          <p><em>Payment: pending &mdash; $${REGISTRATION_FEE} Fall Membership Fee.</em></p>
        `,
      });
    } catch (mailErr) {
      console.error('Registration email error (non-fatal):', mailErr);
    }

    return res.status(201).json({
      id,
      fee: REGISTRATION_FEE,
      success: true
    });
  } catch (err) {
    if (err.message && err.message.toLowerCase().indexOf('unique') !== -1) {
      return res.status(409).json({ error: 'A registration already exists for this email this season. Please contact membership@rootsandwingsindy.com.' });
    }
    console.error('Registration insert error:', err);
    return res.status(500).json({ error: 'Could not save registration. Please try again.' });
  }
}

// ── Update payment status after PayPal approve (public; identified by id) ──
async function handleRegistrationPayment(body, res) {
  const id = parseInt(body.id, 10);
  const paypal_transaction_id = String(body.paypal_transaction_id || '').trim();
  if (!id) return res.status(400).json({ error: 'id required' });
  if (!paypal_transaction_id) return res.status(400).json({ error: 'paypal_transaction_id required' });

  const sql = getSql();
  try {
    const updated = await sql`
      UPDATE registrations
      SET payment_status = 'paid',
          paypal_transaction_id = ${paypal_transaction_id},
          updated_at = NOW()
      WHERE id = ${id} AND payment_status <> 'paid'
      RETURNING id, email, main_learning_coach
    `;
    if (updated.length === 0) {
      return res.status(404).json({ error: 'Registration not found or already paid.' });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Registration payment update error:', err);
    return res.status(500).json({ error: 'Could not update payment status.' });
  }
}

// ── List registrations (Workspace auth required) ──
async function handleList(req, res) {
  const auth = await verifyWorkspaceAuth(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  const season = String(req.query.season || DEFAULT_SEASON);
  const sql = getSql();
  try {
    const rows = await sql`
      SELECT id, season, email, existing_family_name, main_learning_coach, address, phone,
             track, track_other, kids, placement_notes,
             waiver_member_agreement, waiver_photo_consent, waiver_liability,
             signature_name, signature_date, student_signature,
             payment_status, paypal_transaction_id, payment_amount,
             created_at, updated_at
      FROM registrations
      WHERE season = ${season}
      ORDER BY created_at DESC
    `;
    return res.status(200).json({ registrations: rows });
  } catch (err) {
    console.error('Registration list error:', err);
    return res.status(500).json({ error: 'Could not load registrations.' });
  }
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    if (req.query.list === 'registrations') return handleList(req, res);
    return res.status(400).json({ error: 'Unknown GET action.' });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const kind = String(body.kind || 'tour').toLowerCase();
    if (kind === 'tour') return handleTour(body, res);
    if (kind === 'registration') return handleRegistration(body, res);
    if (kind === 'registration-payment') return handleRegistrationPayment(body, res);
    return res.status(400).json({ error: 'Unknown kind.' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
