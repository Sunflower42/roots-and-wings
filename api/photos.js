// Profile photo API
//
// GET /api/photos
//     Auth required (@rootsandwingsindy.com JWT). Returns
//     { photos: { email: thumbnailPhotoUrl, ... } } for the full Workspace
//     directory, via the Admin SDK.
//     Side effect: caches the 7 board members' photos into the
//     `board_photos` table so the public site can render them without
//     requiring sign-in.
//
// GET /api/photos?scope=board
//     No auth required. Returns the cached board member photos for the
//     public site. Shape:
//     { board: [ { email, photo_url, role_title, full_name }, ... ] }

const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const { neon } = require('@neondatabase/serverless');
const { ALLOWED_ORIGINS } = require('./_config');
const { getRoleHolderEmails } = require('./_permissions');

const GOOGLE_CLIENT_ID = '915526936965-ibd6qsd075dabjvuouon38n7ceq4p01i.apps.googleusercontent.com';
const ALLOWED_DOMAIN = 'rootsandwingsindy.com';
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Board role titles as they appear in the volunteer-committees sheet (Chair
// rows). Kept in sync with the cards in index.html.
const BOARD_ROLE_TITLES = [
  'President',
  'Vice President',
  'Treasurer',
  'Secretary',
  'Membership Director',
  'Sustaining Director',
  'Communications Director'
];

async function verifyGoogleAuth(req) {
  var authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  try {
    var ticket = await oauthClient.verifyIdToken({
      idToken: authHeader.slice(7),
      audience: GOOGLE_CLIENT_ID
    });
    var payload = ticket.getPayload();
    var domain = (payload.email || '').split('@')[1] || '';
    return domain === ALLOWED_DOMAIN;
  } catch (e) {
    return false;
  }
}

function getAdminAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/admin.directory.user.readonly'],
    clientOptions: { subject: 'communications@rootsandwingsindy.com' }
  });
}

function getSql() {
  if (!process.env.DATABASE_URL) return null;
  return neon(process.env.DATABASE_URL);
}

// Build a set of Workspace emails that belong to parents who opted out of
// photo use. Defense in depth: the client-side rendering already honors
// photo_consent via getPhotoUrl, this prevents opted-out photos from ever
// leaving the API and from being cached to the public board_photos table.
//
// Derivation: family_email's local part is "<firstLC><familyLastInitial>".
// For any parent in that family, the Workspace email is
// "<parentFirstLC><familyLastInitial>@<domain>". Returns empty on any DB
// error so we fail open — the client-side gate is the primary enforcement.
async function getOptedOutAdultEmails(workspaceUsers) {
  const sql = getSql();
  if (!sql) return new Set();
  try {
    // Each opted-out person now lives as a row in `people` keyed by their
    // own Workspace email, so we can directly intersect against the
    // workspaceUsers map without re-deriving emails from family_email +
    // first-name initials.
    const rows = await sql`
      SELECT email FROM people WHERE photo_consent = FALSE
    `;
    const optedOut = new Set();
    for (const r of rows) {
      const e = String(r.email || '').toLowerCase();
      if (e && workspaceUsers[e]) optedOut.add(e);
    }
    return optedOut;
  } catch (err) {
    console.warn('opted-out adult lookup failed (fail open):', err.message);
    return new Set();
  }
}

// Pull fresh Workspace photos from the Admin SDK and return email -> { url, name }.
async function fetchWorkspaceUsers() {
  const auth = getAdminAuth();
  const admin = google.admin({ version: 'directory_v1', auth });

  const users = [];
  let pageToken = null;
  do {
    const params = {
      domain: ALLOWED_DOMAIN,
      maxResults: 500,
      projection: 'basic',
      fields: 'users(primaryEmail,thumbnailPhotoUrl,name),nextPageToken'
    };
    if (pageToken) params.pageToken = pageToken;
    const result = await admin.users.list(params);
    if (result.data.users) users.push(...result.data.users);
    pageToken = result.data.nextPageToken;
  } while (pageToken);

  const byEmail = {};
  users.forEach(u => {
    if (u.thumbnailPhotoUrl) {
      byEmail[u.primaryEmail] = {
        url: u.thumbnailPhotoUrl,
        name: (u.name && u.name.fullName) || ''
      };
    }
  });
  return byEmail;
}

// Side-effect: upsert the 7 board member photos into board_photos so the
// public site can read them without auth. Silent on failure — we never want
// a caching glitch to break the member-portal directory.
async function upsertBoardPhotos(workspaceUsers, optedOut) {
  const sql = getSql();
  if (!sql) return;

  let roleToEmail;
  try {
    roleToEmail = await getRoleHolderEmails(BOARD_ROLE_TITLES);
  } catch (_) {
    return;
  }

  const optedOutSet = optedOut || new Set();
  const rows = [];
  const deleteEmails = [];
  for (const title of BOARD_ROLE_TITLES) {
    const email = roleToEmail[title];
    if (!email) continue;
    // Opted-out board members: drop any previously cached row so the public
    // site stops serving their face after they flip the choice.
    if (optedOutSet.has(email)) {
      deleteEmails.push(email);
      continue;
    }
    const user = workspaceUsers[email];
    if (!user || !user.url) continue;
    rows.push({ email, url: user.url, title, name: user.name });
  }

  for (const r of rows) {
    try {
      await sql`
        INSERT INTO board_photos (email, photo_url, role_title, full_name, updated_at)
        VALUES (${r.email}, ${r.url}, ${r.title}, ${r.name}, NOW())
        ON CONFLICT (email) DO UPDATE
          SET photo_url  = EXCLUDED.photo_url,
              role_title = EXCLUDED.role_title,
              full_name  = EXCLUDED.full_name,
              updated_at = NOW()
      `;
    } catch (err) {
      console.warn('board_photos upsert failed for', r.email, err.message);
    }
  }
  for (const e of deleteEmails) {
    try {
      await sql`DELETE FROM board_photos WHERE email = ${e}`;
    } catch (err) {
      console.warn('board_photos delete failed for', e, err.message);
    }
  }
}

// ── Public endpoint: return cached board photos, no auth ──
async function handleBoardScope(req, res) {
  const sql = getSql();
  if (!sql) return res.status(200).json({ board: [] });
  try {
    const rows = await sql`
      SELECT email, photo_url, role_title, full_name
      FROM board_photos
      ORDER BY role_title
    `;
    // 30-minute CDN cache; photos change rarely.
    res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=1800');
    return res.status(200).json({ board: rows });
  } catch (err) {
    console.error('board_photos read failed:', err);
    return res.status(500).json({ error: 'Failed to read board photos' });
  }
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.indexOf(origin) !== -1) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Public endpoint — no auth required. Must be checked BEFORE verifyGoogleAuth.
  if (req.query.scope === 'board') {
    // Public cache-control set inside handleBoardScope
    return handleBoardScope(req, res);
  }

  // Authenticated endpoint
  res.setHeader('Cache-Control', 'public, max-age=3600');
  if (!(await verifyGoogleAuth(req))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const workspaceUsers = await fetchWorkspaceUsers();

    // Filter opted-out adults before handing photos back to the portal or
    // caching board photos. This runs BEFORE the response so we don't leak
    // URLs that the DB says are off-limits.
    const optedOut = await getOptedOutAdultEmails(workspaceUsers);
    const allowedUsers = {};
    for (const email of Object.keys(workspaceUsers)) {
      if (!optedOut.has(email)) allowedUsers[email] = workspaceUsers[email];
    }

    // Build the email -> URL map the member portal already consumes.
    const photos = {};
    for (const email of Object.keys(allowedUsers)) {
      photos[email] = allowedUsers[email].url;
    }

    // Fire-and-forget: keep public board photo cache warm. Don't await so
    // slow DB calls never delay the photo response to the portal. The
    // opted-out set is passed along so any board member who flips the
    // opt-out has their stale cached row deleted on the next fetch.
    upsertBoardPhotos(workspaceUsers, optedOut).catch(err =>
      console.warn('upsertBoardPhotos failed:', err && err.message)
    );

    res.status(200).json({ photos });
  } catch (err) {
    console.error('Photos API error:', err);
    res.status(500).json({ error: 'Failed to fetch photos' });
  }
};
