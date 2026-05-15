// Cleaning Crew Management + Role Descriptions API
//
// GET    /api/cleaning                          → all areas, assignments, config
// POST   /api/cleaning?action=assignment        → add an assignment
// PATCH  /api/cleaning?action=assignment&id=N   → update an assignment
// DELETE /api/cleaning?action=assignment&id=N   → remove an assignment
// PATCH  /api/cleaning?action=area&id=N         → update area name/tasks
// POST   /api/cleaning?action=area              → add a new area
// DELETE /api/cleaning?action=area&id=N         → remove an area (cascades)
// PATCH  /api/cleaning?action=config            → update liaison name
// GET    /api/cleaning?action=roles             → all role descriptions
// PATCH  /api/cleaning?action=roles&id=N        → update a role description
// GET    /api/cleaning?action=role-holders       → holders for a school year
// POST   /api/cleaning?action=role-holders       → assign a holder
// DELETE /api/cleaning?action=role-holders&id=N → remove a holder

const { neon } = require('@neondatabase/serverless');
const { OAuth2Client } = require('google-auth-library');
const { ALLOWED_ORIGINS } = require('./_config');
const { canEditAsRole, isSuperUser } = require('./_permissions');

// Editing a role_descriptions row is gated by which bucket of fields
// you're touching. Meta = title / hierarchy / lifecycle, reserved for
// the President (and super user). Content = overview / duties /
// playbook / job_length / last_reviewed_* — those can also be edited
// by anyone whose volunteer-sheet role is an ancestor of the target
// row (so the VP can update any Programming Committee role, the
// Cleaning Crew Liaison can update the area rows they oversee, etc.).
const META_FIELDS = new Set([
  'title', 'committee', 'parent_role_id', 'category',
  'display_order', 'status'
]);
const CONTENT_FIELDS = new Set([
  'overview', 'duties', 'job_length', 'playbook'
]);
// last_reviewed_by / last_reviewed_date are stamped server-side from
// the authenticated user + today's date whenever any of these fields
// changes — never trust client-supplied values.
const REVIEW_TRIGGER_FIELDS = new Set([
  'overview', 'duties', 'job_length', 'playbook'
]);

// Vercel runs in UTC, so we have to anchor "today" to Indianapolis
// (Eastern time, year-round) explicitly — otherwise an edit submitted
// after 8 PM ET stamps tomorrow's date.
function formatTodayMDY() {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Indianapolis',
    month: 'numeric',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date());
}
// Categories are validated client-side AND server-side. Roles v2 dropped
// 'cleaning_area' and 'class' — cleaning lives in cleaning_areas /
// cleaning_assignments, classes have a separate home, and `roles` covers
// humans on the org chart only.
const VALID_CATEGORIES = ['board', 'committee_role'];
const VALID_STATUSES = ['active', 'archived'];

async function canEditRoleMeta(userEmail) {
  if (!userEmail) return false;
  if (isSuperUser(userEmail)) return true;
  return await canEditAsRole(userEmail, 'President');
}

// Walks up parent_role_id (max depth 5 — really 3 in practice) on the
// new `roles` table and collects titles. User can edit content if they
// hold ANY of those titles in role_holders_v2, or if they pass the meta
// gate (President + super user).
async function canEditRoleContent(userEmail, sql, roleId) {
  if (await canEditRoleMeta(userEmail)) return true;
  const titles = [];
  let currentId = roleId;
  const seen = new Set();
  for (let depth = 0; depth < 5 && currentId && !seen.has(currentId); depth++) {
    seen.add(currentId);
    const row = await sql`SELECT title, parent_role_id FROM roles WHERE id = ${currentId}`;
    if (row.length === 0) break;
    titles.push(row[0].title);
    currentId = row[0].parent_role_id;
  }
  for (const title of titles) {
    if (await canEditAsRole(userEmail, title)) return true;
  }
  return false;
}

// Resolve a free-text committee name to a committees.id. Returns null if
// the input is empty (clears the committee_id), or undefined if the name
// doesn't match an existing committee (caller should 400). Committees
// can't be created via this path — they live in the committees table
// and are managed separately.
async function resolveCommitteeId(sql, committeeName) {
  const name = String(committeeName == null ? '' : committeeName).trim();
  if (!name) return null;
  const row = await sql`SELECT id FROM committees WHERE LOWER(name) = LOWER(${name}) LIMIT 1`;
  return row.length > 0 ? row[0].id : undefined;
}

const GOOGLE_CLIENT_ID = '915526936965-ibd6qsd075dabjvuouon38n7ceq4p01i.apps.googleusercontent.com';
const ALLOWED_DOMAIN = 'rootsandwingsindy.com';
const VALID_FLOORS = ['mainFloor', 'upstairs', 'outside', 'floater'];

const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID);

async function verifyGoogleAuth(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  try {
    const ticket = await oauthClient.verifyIdToken({
      idToken: authHeader.slice(7),
      audience: GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();
    const email = payload.email || '';
    const domain = email.split('@')[1] || '';
    if (domain !== ALLOWED_DOMAIN) return null;
    return { email, name: payload.name || '' };
  } catch (e) {
    return null;
  }
}

function getSql() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not configured');
  return neon(process.env.DATABASE_URL);
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.indexOf(origin) !== -1) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyGoogleAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const sql = getSql();
    const action = req.query.action || '';

    // ── GET: return everything ──
    // Excludes action-routed GETs (roles, role-holders) — they have
    // their own handlers below. Without this guard, GET ?action=role-holders
    // falls into this branch and returns cleaning data with no `holders`
    // field, which silently parses as an empty list on the client.
    if (req.method === 'GET' && action !== 'roles' && action !== 'role-holders') {
      const areas = await sql`
        SELECT id, floor_key, area_name, tasks, sort_order
        FROM cleaning_areas ORDER BY sort_order, id
      `;
      const assignments = await sql`
        SELECT ca.id, ca.session_number, ca.cleaning_area_id, ca.family_name, ca.sort_order,
               a.floor_key, a.area_name
        FROM cleaning_assignments ca
        JOIN cleaning_areas a ON a.id = ca.cleaning_area_id
        ORDER BY ca.session_number, a.sort_order, ca.sort_order
      `;
      // Liaison name is now derived from role_holders_v2 — the
      // cleaning_config table was retired in Phase 5. Joins through
      // people for the live name (resolves to '' for board-mailbox
      // assignees with no people row, same fallback behavior as the
      // old config text field's empty-string default).
      const liaisonRows = await sql`
        SELECT
          NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), '') AS person_name
        FROM role_holders_v2 rhv
        JOIN roles r ON r.id = rhv.role_id
        LEFT JOIN people p ON LOWER(p.email) = LOWER(rhv.person_email)
        WHERE r.role_key = 'cleaning_crew_liaison'
          AND rhv.ended_at IS NULL
        ORDER BY rhv.school_year DESC, rhv.id ASC
        LIMIT 1
      `;

      // Build sessions object matching CLEANING_CREW shape
      const sessions = {};
      assignments.forEach(a => {
        const s = a.session_number;
        if (!sessions[s]) sessions[s] = { mainFloor: {}, upstairs: {}, outside: {} };
        if (a.floor_key === 'floater') {
          if (!sessions[s].floater) sessions[s].floater = [];
          sessions[s].floater.push(a.family_name);
        } else {
          if (!sessions[s][a.floor_key]) sessions[s][a.floor_key] = {};
          if (!sessions[s][a.floor_key][a.area_name]) sessions[s][a.floor_key][a.area_name] = [];
          sessions[s][a.floor_key][a.area_name].push(a.family_name);
        }
      });

      return res.status(200).json({
        liaison: (liaisonRows[0] && liaisonRows[0].person_name) || '',
        areas,
        assignments,
        sessions
      });
    }

    // ── Roles (v2) ──
    // GET response preserves the old field names (`job_length`, `committee`)
    // so the existing Roles Manager UI continues to work unchanged through
    // the Phase 4 frontend cutover. Internally:
    //   - term_length is exposed as job_length
    //   - committees.name is exposed as committee (via JOIN)
    if (action === 'roles') {
      if (req.method === 'GET') {
        const includeArchived = req.query.includeArchived === '1';
        const rows = includeArchived
          ? await sql`
              SELECT r.id, r.role_key, r.title,
                     r.term_length AS job_length,
                     r.overview, r.duties,
                     c.name AS committee,
                     r.parent_role_id, r.category, r.display_order, r.status,
                     r.last_reviewed_by, r.last_reviewed_date, r.playbook,
                     r.icon_emoji, r.card_summary, r.role_email,
                     r.revision_history,
                     r.updated_at, r.updated_by
              FROM roles r
              LEFT JOIN committees c ON c.id = r.committee_id
              ORDER BY r.category, r.display_order, r.title
            `
          : await sql`
              SELECT r.id, r.role_key, r.title,
                     r.term_length AS job_length,
                     r.overview, r.duties,
                     c.name AS committee,
                     r.parent_role_id, r.category, r.display_order, r.status,
                     r.last_reviewed_by, r.last_reviewed_date, r.playbook,
                     r.icon_emoji, r.card_summary, r.role_email,
                     r.revision_history,
                     r.updated_at, r.updated_by
              FROM roles r
              LEFT JOIN committees c ON c.id = r.committee_id
              WHERE r.status = 'active'
              ORDER BY r.category, r.display_order, r.title
            `;
        // Normalize "" committee for client compat — legacy rows had
        // empty-string here, not NULL.
        const roles = rows.map(r => Object.assign({}, r, { committee: r.committee || '' }));
        return res.status(200).json({ roles });
      }

      if (req.method === 'POST') {
        // Create a new role. President + super user only.
        if (!(await canEditRoleMeta(user.email))) {
          return res.status(403).json({ error: 'Only the President (or super user) can create roles.' });
        }
        const body = req.body || {};
        const role_key = String(body.role_key || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
        const title = String(body.title || '').trim();
        if (!role_key || !title) return res.status(400).json({ error: 'role_key and title are required' });

        const category = VALID_CATEGORIES.indexOf(body.category) !== -1 ? body.category : 'committee_role';
        const status = VALID_STATUSES.indexOf(body.status) !== -1 ? body.status : 'active';
        const parent_role_id = body.parent_role_id ? parseInt(body.parent_role_id, 10) : null;
        const term_length = String(body.job_length || body.term_length || '').trim();
        const overview = String(body.overview || '').trim();
        const dutiesArr = Array.isArray(body.duties) ? body.duties.map(d => String(d).trim()).filter(Boolean) : [];
        const display_order = Number.isFinite(parseInt(body.display_order, 10)) ? parseInt(body.display_order, 10) : 0;

        let committee_id = null;
        if (body.committee_id !== undefined && body.committee_id !== null) {
          committee_id = parseInt(body.committee_id, 10);
          if (!Number.isFinite(committee_id)) return res.status(400).json({ error: 'committee_id must be a number' });
        } else if (body.committee !== undefined) {
          const resolved = await resolveCommitteeId(sql, body.committee);
          if (resolved === undefined) return res.status(400).json({ error: 'Unknown committee: ' + body.committee });
          committee_id = resolved;
        }

        if (parent_role_id) {
          const exists = await sql`SELECT id FROM roles WHERE id = ${parent_role_id}`;
          if (exists.length === 0) return res.status(400).json({ error: 'parent_role_id does not exist' });
        }

        try {
          const inserted = await sql`
            INSERT INTO roles (
              role_key, title, term_length, overview, duties, committee_id,
              parent_role_id, category, display_order, status, updated_by
            ) VALUES (
              ${role_key}, ${title}, ${term_length}, ${overview}, ${dutiesArr}, ${committee_id},
              ${parent_role_id}, ${category}, ${display_order}, ${status}, ${user.email}
            )
            RETURNING *
          `;
          return res.status(201).json({ role: inserted[0] });
        } catch (err) {
          if (String(err.message || '').match(/duplicate key|unique constraint/i)) {
            return res.status(409).json({ error: 'A role with that role_key already exists' });
          }
          throw err;
        }
      }

      if (req.method === 'PATCH') {
        const id = parseInt(req.query.id, 10);
        if (!id) return res.status(400).json({ error: 'id required' });
        const body = req.body || {};
        const touchedFields = Object.keys(body).filter(k => META_FIELDS.has(k) || CONTENT_FIELDS.has(k));
        if (touchedFields.length === 0) return res.status(400).json({ error: 'No editable fields supplied' });

        const hitsMeta = touchedFields.some(k => META_FIELDS.has(k));
        if (hitsMeta && !(await canEditRoleMeta(user.email))) {
          return res.status(403).json({ error: 'Only the President (or super user) can change role title, hierarchy, or lifecycle.' });
        }
        // Even for content-only edits, the user needs some stake in the
        // committee subtree. canEditRoleContent covers super-user + President
        // + any ancestor-role holder.
        if (!hitsMeta && !(await canEditRoleContent(user.email, sql, id))) {
          return res.status(403).json({ error: 'You don\'t have permission to edit this role.' });
        }

        // Apply per-field updates. job_length is the legacy field name —
        // the column is `term_length` on the new schema.
        if (body.overview !== undefined) {
          await sql`UPDATE roles SET overview = ${String(body.overview)}, updated_at = NOW(), updated_by = ${user.email} WHERE id = ${id}`;
        }
        if (body.job_length !== undefined) {
          await sql`UPDATE roles SET term_length = ${String(body.job_length)}, updated_at = NOW(), updated_by = ${user.email} WHERE id = ${id}`;
        }
        if (body.duties !== undefined) {
          const dutiesArr = Array.isArray(body.duties) ? body.duties.map(d => String(d).trim()).filter(Boolean) : [];
          await sql`UPDATE roles SET duties = ${dutiesArr}, updated_at = NOW(), updated_by = ${user.email} WHERE id = ${id}`;
        }
        if (body.playbook !== undefined) {
          await sql`UPDATE roles SET playbook = ${String(body.playbook)}, updated_at = NOW(), updated_by = ${user.email} WHERE id = ${id}`;
        }
        if (body.title !== undefined) {
          const title = String(body.title).trim();
          if (!title) return res.status(400).json({ error: 'title cannot be empty' });
          await sql`UPDATE roles SET title = ${title}, updated_at = NOW(), updated_by = ${user.email} WHERE id = ${id}`;
        }
        if (body.committee !== undefined) {
          // Free-text input → committee_id lookup. Empty string clears
          // the committee link; unknown name is a 400 (committees aren't
          // auto-created via this path).
          const resolved = await resolveCommitteeId(sql, body.committee);
          if (resolved === undefined) return res.status(400).json({ error: 'Unknown committee: ' + body.committee });
          await sql`UPDATE roles SET committee_id = ${resolved}, updated_at = NOW(), updated_by = ${user.email} WHERE id = ${id}`;
        }
        if (body.category !== undefined) {
          if (VALID_CATEGORIES.indexOf(body.category) === -1) return res.status(400).json({ error: 'Invalid category' });
          await sql`UPDATE roles SET category = ${body.category}, updated_at = NOW(), updated_by = ${user.email} WHERE id = ${id}`;
        }
        if (body.status !== undefined) {
          if (VALID_STATUSES.indexOf(body.status) === -1) return res.status(400).json({ error: 'Invalid status' });
          await sql`UPDATE roles SET status = ${body.status}, updated_at = NOW(), updated_by = ${user.email} WHERE id = ${id}`;
        }
        if (body.display_order !== undefined) {
          const n = parseInt(body.display_order, 10);
          if (!Number.isFinite(n)) return res.status(400).json({ error: 'display_order must be a number' });
          await sql`UPDATE roles SET display_order = ${n}, updated_at = NOW(), updated_by = ${user.email} WHERE id = ${id}`;
        }
        if (body.parent_role_id !== undefined) {
          const pid = body.parent_role_id === null ? null : parseInt(body.parent_role_id, 10);
          if (pid !== null && !Number.isFinite(pid)) return res.status(400).json({ error: 'parent_role_id must be a number or null' });
          if (pid === id) return res.status(400).json({ error: 'A role cannot be its own parent' });
          if (pid) {
            const exists = await sql`SELECT id FROM roles WHERE id = ${pid}`;
            if (exists.length === 0) return res.status(400).json({ error: 'parent_role_id does not exist' });
          }
          await sql`UPDATE roles SET parent_role_id = ${pid}, updated_at = NOW(), updated_by = ${user.email} WHERE id = ${id}`;
        }

        // Auto-stamp the review fields + append a revision_history entry
        // whenever the descriptive content changed. The history append is
        // new in v2 — captures every save so we don't lose the audit
        // trail the .docx headers used to track manually. Skipped for
        // pure meta edits (archive, hierarchy, display_order) so
        // housekeeping doesn't claim someone "reviewed the description".
        const hitsContent = touchedFields.some(k => REVIEW_TRIGGER_FIELDS.has(k));
        if (hitsContent) {
          const reviewer = (user.name || user.email).trim();
          const today = formatTodayMDY();
          const isoToday = new Date().toISOString().slice(0, 10);
          await sql`
            UPDATE roles
            SET last_reviewed_by = ${reviewer},
                last_reviewed_date = ${isoToday}::date,
                revision_history = ${JSON.stringify({ date: isoToday, by: reviewer })}::jsonb || revision_history,
                updated_at = NOW(),
                updated_by = ${user.email}
            WHERE id = ${id}
          `;
          return res.status(200).json({ ok: true, last_reviewed_by: reviewer, last_reviewed_date: today });
        }
        return res.status(200).json({ ok: true });
      }
    }

    // ── Committee-grouped tree (for the Roles Manager rewrite) ──
    // Returns committees in display order, each with `chair` (the board
    // role pointed at by committees.chair_role_id) and `roles` (every
    // committee_role attached to that committee). Each role carries its
    // current-year holders so the "Open Roles" filter is just
    // `holders.length === 0` client-side.
    if (action === 'tree' && req.method === 'GET') {
      const includeArchived = req.query.includeArchived === '1';
      let schoolYear = req.query.school_year;
      if (!schoolYear || !/^\d{4}-\d{4}$/.test(schoolYear)) {
        const yr = await sql`SELECT MAX(school_year) AS sy FROM role_holders_v2`;
        const now = new Date();
        const fy = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
        schoolYear = (yr[0] && yr[0].sy) || (fy + '-' + (fy + 1));
      }
      const committees = await sql`
        SELECT id, name, chair_role_id, display_order, status
        FROM committees
        WHERE (${includeArchived} OR status = 'active')
        ORDER BY display_order
      `;
      const rolesRows = await sql`
        SELECT
          id, role_key, title, category, committee_id, parent_role_id,
          display_order, status, term_length, overview, duties, playbook,
          icon_emoji, card_summary, role_email,
          last_reviewed_by, last_reviewed_date, revision_history,
          updated_at, updated_by
        FROM roles
        WHERE (${includeArchived} OR status = 'active')
        ORDER BY display_order, title
      `;
      const holderRows = await sql`
        SELECT
          rhv.id, rhv.role_id, rhv.person_email, rhv.school_year,
          rhv.started_at, rhv.ended_at, rhv.notes,
          TRIM(CONCAT_WS(' ', p.first_name, p.last_name)) AS full_name
        FROM role_holders_v2 rhv
        LEFT JOIN people p ON LOWER(p.email) = LOWER(rhv.person_email)
        WHERE rhv.school_year = ${schoolYear}
          AND rhv.ended_at IS NULL
        ORDER BY rhv.started_at
      `;
      const holdersByRoleId = {};
      holderRows.forEach(h => {
        (holdersByRoleId[h.role_id] = holdersByRoleId[h.role_id] || []).push({
          id: h.id,
          person_email: h.person_email,
          full_name: h.full_name || '',
          school_year: h.school_year,
          started_at: h.started_at,
          ended_at: h.ended_at,
          notes: h.notes || ''
        });
      });
      const rolesById = {};
      rolesRows.forEach(r => {
        r.holders = holdersByRoleId[r.id] || [];
        r.duties = Array.isArray(r.duties) ? r.duties : [];
        r.card_summary = Array.isArray(r.card_summary) ? r.card_summary : [];
        rolesById[r.id] = r;
      });
      const tree = committees.map(c => {
        const chair = c.chair_role_id ? (rolesById[c.chair_role_id] || null) : null;
        const members = rolesRows.filter(r =>
          r.committee_id === c.id && r.id !== c.chair_role_id
        ).sort((a, b) => a.display_order - b.display_order);
        return {
          id: c.id,
          name: c.name,
          display_order: c.display_order,
          status: c.status,
          chair,
          roles: members
        };
      });
      const orphans = rolesRows.filter(r => !r.committee_id);
      if (orphans.length) {
        tree.push({
          id: null, name: 'Unassigned', display_order: 9999,
          status: 'active', chair: null, roles: orphans
        });
      }
      return res.status(200).json({ school_year: schoolYear, committees: tree });
    }

    // ── Role Holders (v2) ──
    // Reads from role_holders_v2 + people. Response preserves the legacy
    // field names (`email`, `person_name`, `family_name`) so the existing
    // Roles Manager UI continues to work through Phase 4. person_name and
    // family_name are derived from the people table — person_email is the
    // join key. Holders without a people row (typical for shared board
    // mailboxes like president@) get an empty person_name/family_name.
    if (action === 'role-holders') {
      if (req.method === 'GET') {
        const schoolYear = req.query.school_year || '2025-2026';
        const holders = await sql`
          SELECT
            rhv.id, rhv.role_id,
            rhv.person_email AS email,
            TRIM(CONCAT_WS(' ', p.first_name, p.last_name)) AS person_name,
            COALESCE(p.last_name, '') AS family_name,
            rhv.school_year, rhv.started_at,
            rhv.updated_at, rhv.updated_by
          FROM role_holders_v2 rhv
          LEFT JOIN people p ON LOWER(p.email) = LOWER(rhv.person_email)
          WHERE rhv.school_year = ${schoolYear}
            AND rhv.ended_at IS NULL
          ORDER BY rhv.role_id, person_name
        `;
        return res.status(200).json({ school_year: schoolYear, holders });
      }

      if (req.method === 'POST') {
        const { role_id, email, school_year } = req.body || {};
        const roleId = parseInt(role_id, 10);
        if (!roleId || !email) {
          return res.status(400).json({ error: 'role_id and email required' });
        }
        const yr = String(school_year || '2025-2026').trim();
        const personEmail = String(email).trim().toLowerCase();
        // Same gate as content edits — President + super user always pass;
        // an ancestor-role holder (e.g., VP for Programming Committee
        // roles) can manage their own committee's assignments.
        const allowed = await canEditRoleContent(user.email, sql, roleId);
        if (!allowed) {
          return res.status(403).json({ error: 'Not authorized to assign holders for this role' });
        }
        const inserted = await sql`
          INSERT INTO role_holders_v2 (role_id, person_email, school_year, updated_by)
          VALUES (${roleId}, ${personEmail}, ${yr}, ${user.email})
          RETURNING id, role_id, person_email, school_year
        `;
        const row = inserted[0];
        // Resolve display names from people for the response so the UI
        // can render the new holder without an extra round-trip.
        const named = await sql`
          SELECT
            TRIM(CONCAT_WS(' ', p.first_name, p.last_name)) AS person_name,
            COALESCE(p.last_name, '') AS family_name
          FROM people p
          WHERE LOWER(p.email) = ${personEmail}
          LIMIT 1
        `;
        const display = named[0] || { person_name: '', family_name: '' };
        return res.status(201).json({
          holder: {
            id: row.id,
            role_id: row.role_id,
            email: row.person_email,
            person_name: display.person_name,
            family_name: display.family_name,
            school_year: row.school_year
          }
        });
      }

      if (req.method === 'DELETE') {
        const id = parseInt(req.query.id, 10);
        if (!id) return res.status(400).json({ error: 'id required' });
        const row = await sql`SELECT role_id FROM role_holders_v2 WHERE id = ${id}`;
        if (row.length === 0) return res.status(404).json({ error: 'Not found' });
        const allowed = await canEditRoleContent(user.email, sql, row[0].role_id);
        if (!allowed) {
          return res.status(403).json({ error: 'Not authorized to remove holders for this role' });
        }
        await sql`DELETE FROM role_holders_v2 WHERE id = ${id}`;
        return res.status(200).json({ ok: true });
      }

      return res.status(405).json({ error: 'Method not allowed' });
    }

    // ── Assignment CRUD ──
    if (action === 'assignment') {
      if (req.method === 'POST') {
        const { session_number, cleaning_area_id, family_name } = req.body || {};
        if (!session_number || !cleaning_area_id || !family_name) {
          return res.status(400).json({ error: 'session_number, cleaning_area_id, family_name required' });
        }
        if (session_number < 1 || session_number > 5) {
          return res.status(400).json({ error: 'session_number must be 1-5' });
        }
        const inserted = await sql`
          INSERT INTO cleaning_assignments (session_number, cleaning_area_id, family_name, updated_by)
          VALUES (${session_number}, ${cleaning_area_id}, ${String(family_name).trim()}, ${user.email})
          RETURNING id, session_number, cleaning_area_id, family_name
        `;
        return res.status(201).json({ assignment: inserted[0] });
      }

      if (req.method === 'PATCH') {
        const id = parseInt(req.query.id, 10);
        if (!id) return res.status(400).json({ error: 'id required' });
        const { cleaning_area_id, family_name } = req.body || {};
        if (!cleaning_area_id && !family_name) {
          return res.status(400).json({ error: 'cleaning_area_id or family_name required' });
        }
        let updated;
        if (cleaning_area_id && family_name) {
          updated = await sql`
            UPDATE cleaning_assignments SET cleaning_area_id = ${cleaning_area_id},
              family_name = ${String(family_name).trim()}, updated_at = NOW(), updated_by = ${user.email}
            WHERE id = ${id} RETURNING id
          `;
        } else if (cleaning_area_id) {
          updated = await sql`
            UPDATE cleaning_assignments SET cleaning_area_id = ${cleaning_area_id},
              updated_at = NOW(), updated_by = ${user.email}
            WHERE id = ${id} RETURNING id
          `;
        } else {
          updated = await sql`
            UPDATE cleaning_assignments SET family_name = ${String(family_name).trim()},
              updated_at = NOW(), updated_by = ${user.email}
            WHERE id = ${id} RETURNING id
          `;
        }
        if (updated.length === 0) return res.status(404).json({ error: 'Not found' });
        return res.status(200).json({ ok: true });
      }

      if (req.method === 'DELETE') {
        const id = parseInt(req.query.id, 10);
        if (!id) return res.status(400).json({ error: 'id required' });
        const deleted = await sql`DELETE FROM cleaning_assignments WHERE id = ${id} RETURNING id`;
        if (deleted.length === 0) return res.status(404).json({ error: 'Not found' });
        return res.status(200).json({ ok: true });
      }
    }

    // ── Area CRUD ──
    if (action === 'area') {
      if (req.method === 'POST') {
        const { floor_key, area_name, tasks } = req.body || {};
        if (!floor_key || !area_name) {
          return res.status(400).json({ error: 'floor_key and area_name required' });
        }
        if (VALID_FLOORS.indexOf(floor_key) === -1) {
          return res.status(400).json({ error: 'Invalid floor_key' });
        }
        const tasksArr = Array.isArray(tasks) ? tasks.map(t => String(t).trim()).filter(Boolean) : [];
        const inserted = await sql`
          INSERT INTO cleaning_areas (floor_key, area_name, tasks, updated_by)
          VALUES (${floor_key}, ${String(area_name).trim()}, ${tasksArr}, ${user.email})
          RETURNING id, floor_key, area_name, tasks, sort_order
        `;
        return res.status(201).json({ area: inserted[0] });
      }

      if (req.method === 'PATCH') {
        const id = parseInt(req.query.id, 10);
        if (!id) return res.status(400).json({ error: 'id required' });
        const { area_name, tasks } = req.body || {};
        if (area_name !== undefined) {
          await sql`
            UPDATE cleaning_areas SET area_name = ${String(area_name).trim()},
              updated_at = NOW(), updated_by = ${user.email}
            WHERE id = ${id}
          `;
        }
        if (tasks !== undefined) {
          const tasksArr = Array.isArray(tasks) ? tasks.map(t => String(t).trim()).filter(Boolean) : [];
          await sql`
            UPDATE cleaning_areas SET tasks = ${tasksArr},
              updated_at = NOW(), updated_by = ${user.email}
            WHERE id = ${id}
          `;
        }
        return res.status(200).json({ ok: true });
      }

      if (req.method === 'DELETE') {
        const id = parseInt(req.query.id, 10);
        if (!id) return res.status(400).json({ error: 'id required' });
        const deleted = await sql`DELETE FROM cleaning_areas WHERE id = ${id} RETURNING id`;
        if (deleted.length === 0) return res.status(404).json({ error: 'Not found' });
        return res.status(200).json({ ok: true });
      }
    }

    // ── Config update (retired in Phase 5) ──
    // The Cleaning Crew Liaison is now a regular role with role_key =
    // 'cleaning_crew_liaison'. Assign/unassign via ?action=role-holders.
    if (action === 'config' && req.method === 'PATCH') {
      return res.status(410).json({
        error: 'cleaning_config has been retired. Assign the Cleaning Crew Liaison via /api/cleaning?action=role-holders (POST/DELETE) against the cleaning_crew_liaison role.'
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Cleaning API error:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Duplicate entry' });
    }
    return res.status(500).json({ error: 'Server error' });
  }
};
