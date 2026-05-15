// One-time import: walks roles/Volunteer Position Job Descriptions/ and
// upserts every .docx into the `roles` table (along with `committees`).
//
// Idempotent: re-running re-parses every file and overwrites the row by
// role_key. After Phase 4 cutover, edits happen via the portal UI and the
// .docx files become legacy; this script remains only for re-importing if
// the doc tree changes pre-cutover.
//
// Run with: node --env-file=.env.local.dev scripts/import-role-docs.js
// NEVER run against prod without explicit per-task approval.

const { neon } = require('@neondatabase/serverless');
const mammoth = require('mammoth');
const fs = require('fs');
const path = require('path');

const DOC_ROOT = path.join(__dirname, '..', 'roles', 'Volunteer Position Job Descriptions');

// Filename (without .docx) → canonical role_key. Same keys as the legacy
// seed-role-descriptions.js so cross-references in script.js (DUTY_TO_ROLE_KEY)
// keep working through the cutover.
const FILENAME_TO_ROLE_KEY = {
  'AM and PM Classroom Instructor': 'classroom_instructor',
  'Admin_Organization': 'admin_organization',
  'Afternoon Class Liaison': 'afternoon_class_liaison',
  'Archives': 'archives',
  'Building Closer': 'building_closer',
  'Building Opener': 'opener',
  'Classroom Assistant': 'classroom_assistant',
  'Cleaning Crew Liaison': 'cleaning_crew_liaison',
  'Field Trip Coordinator': 'field_trip_coordinator',
  'Floater': 'floater',
  'Fundraising Coordinator': 'fundraising_coordinator',
  'Gratitude_Encouragement Leader': 'gratitude_encouragement',
  'Morning Class Liaison': 'morning_class_liaison',
  'Parent Social Events_': 'parent_social_events',
  'Public Communications': 'public_communications',
  'Safety Coordinator': 'safety_coordinator',
  'Special Events Liaison': 'special_events_liaison',
  'Summer Social Events_': 'summer_social_events',
  'Supply Coordinator': 'supply_coordinator',
  'Welcome Coordinator': 'welcome_coordinator',
  'Yearbook Coordinator_': 'yearbook_coordinator',
  'R&W Communications Director': 'communications_director',
  'R&W Membership Director Board Position': 'membership_director',
  'R&W President of the Board': 'president',
  'R&W Secretary of the Board': 'secretary',
  'R&W Sustaining Director Board Position': 'sustaining_director',
  'R&W Treasurer Board Position': 'treasurer',
  'R&W Vice-President of the Board_': 'vice_president',
};

// role_key → { committee, category, display_order }. The committee is the
// canonical name that will land in the `committees` table; category is
// 'board' for the 7 chairs and 'committee_role' for everyone else.
// display_order keeps the natural board ordering (President first) and a
// stable alpha sort within each committee for non-board roles.
const ROLE_META = {
  // Board (chair each committee)
  president:              { committee: 'Facility Committee',      category: 'board',           display_order:  1 },
  vice_president:         { committee: 'Programming Committee',   category: 'board',           display_order:  2 },
  membership_director:    { committee: 'Membership Committee',    category: 'board',           display_order:  3 },
  treasurer:              { committee: 'Finance Committee',       category: 'board',           display_order:  4 },
  sustaining_director:    { committee: 'Support Committee',       category: 'board',           display_order:  5 },
  secretary:              { committee: 'Administrative Committee',category: 'board',           display_order:  6 },
  communications_director:{ committee: 'Communications Committee',category: 'board',           display_order:  7 },
  // Facility Committee
  building_closer:        { committee: 'Facility Committee',      category: 'committee_role',  display_order: 10 },
  opener:                 { committee: 'Facility Committee',      category: 'committee_role',  display_order: 11 },
  cleaning_crew_liaison:  { committee: 'Facility Committee',      category: 'committee_role',  display_order: 12 },
  safety_coordinator:     { committee: 'Facility Committee',      category: 'committee_role',  display_order: 13 },
  floater:                { committee: 'Facility Committee',      category: 'committee_role',  display_order: 14 },
  // Programming Committee
  morning_class_liaison:  { committee: 'Programming Committee',   category: 'committee_role',  display_order: 20 },
  afternoon_class_liaison:{ committee: 'Programming Committee',   category: 'committee_role',  display_order: 21 },
  classroom_instructor:   { committee: 'Programming Committee',   category: 'committee_role',  display_order: 22 },
  classroom_assistant:    { committee: 'Programming Committee',   category: 'committee_role',  display_order: 23 },
  // Finance Committee
  field_trip_coordinator: { committee: 'Finance Committee',       category: 'committee_role',  display_order: 30 },
  fundraising_coordinator:{ committee: 'Finance Committee',       category: 'committee_role',  display_order: 31 },
  supply_coordinator:     { committee: 'Finance Committee',       category: 'committee_role',  display_order: 32 },
  // Support Committee
  special_events_liaison: { committee: 'Support Committee',       category: 'committee_role',  display_order: 40 },
  gratitude_encouragement:{ committee: 'Support Committee',       category: 'committee_role',  display_order: 41 },
  parent_social_events:   { committee: 'Support Committee',       category: 'committee_role',  display_order: 42 },
  summer_social_events:   { committee: 'Support Committee',       category: 'committee_role',  display_order: 43 },
  // Administrative Committee
  admin_organization:     { committee: 'Administrative Committee',category: 'committee_role',  display_order: 50 },
  archives:               { committee: 'Administrative Committee',category: 'committee_role',  display_order: 51 },
  // Membership Committee
  welcome_coordinator:    { committee: 'Membership Committee',    category: 'committee_role',  display_order: 60 },
  public_communications:  { committee: 'Membership Committee',    category: 'committee_role',  display_order: 61 },
  // Communications Committee
  yearbook_coordinator:   { committee: 'Communications Committee',category: 'committee_role',  display_order: 70 },
};

// Title overrides for docs whose first bold line isn't the clean role name.
// Add an entry here when the .docx title needs cleanup at import time
// rather than via the post-import editing UI.
const TITLE_OVERRIDES = {
  classroom_instructor: 'Classroom Instructor', // doc title is "Classroom Instructor(s) Job Description"
};

// Committee display order on the org chart / dropdowns.
const COMMITTEE_DISPLAY_ORDER = {
  'Facility Committee':       1,
  'Programming Committee':    2,
  'Finance Committee':        3,
  'Support Committee':        4,
  'Administrative Committee': 5,
  'Membership Committee':     6,
  'Communications Committee': 7,
};

// Board-only display fields — sourced from current members.html portal grid
// (members.html:378-428). Lifted out of hardcoded HTML so the portal can
// render from DB once Phase 4 lands.
const BOARD_OVERLAY = {
  president: {
    icon_emoji: '🌳',
    role_email: 'president@rootsandwingsindy.com',
    card_summary: ['Building & grounds oversight', 'FMC relationship & facility coordination'],
  },
  vice_president: {
    icon_emoji: '🌿',
    role_email: 'vp@rootsandwingsindy.com',
    card_summary: ['Class planning & session scheduling', 'Supporting class leads & assistants'],
  },
  membership_director: {
    icon_emoji: '🌻',
    role_email: 'membership@rootsandwingsindy.com',
    card_summary: ['Enrollment & new family onboarding', 'Registration & class placement'],
  },
  treasurer: {
    icon_emoji: '🧮',
    role_email: 'treasurer@rootsandwingsindy.com',
    card_summary: ['Billing, fees & reimbursements', 'Financial assistance & fundraising'],
  },
  sustaining_director: {
    icon_emoji: '💚',
    role_email: 'sustaining@rootsandwingsindy.com',
    card_summary: ['Member retention & satisfaction', 'Special event support & burnout monitoring'],
  },
  secretary: {
    icon_emoji: '✏️',
    role_email: 'secretary@rootsandwingsindy.com',
    card_summary: ['Meeting minutes & official records', 'Government filings & archives'],
  },
  communications_director: {
    icon_emoji: '💬',
    role_email: 'communications@rootsandwingsindy.com',
    card_summary: ['Google Workspace & member comms', 'Surveys, yearbook & newsletter'],
  },
};

// Mammoth escapes punctuation (`5\.13\.26`, `Vice\-President`). Reverse it
// for any non-alphanumeric character so extracted values render cleanly.
// Also strips Word's hidden bookmark anchors (`<a id="_gjdgxs"></a>`) that
// mammoth inlines into paragraph text — these have no rendered effect and
// just pollute the imported content.
function unescape(s) {
  return String(s == null ? '' : s)
    .replace(/<a\s+id="[^"]*"><\/a>/gi, '')
    .replace(/\\([^a-zA-Z0-9])/g, '$1');
}

// Parse common review-line date formats: "9/20/2025", "9/20/25", "5.13.26".
// Returns ISO date string (YYYY-MM-DD) or null if unparseable.
function parseReviewDate(s) {
  const m = String(s).trim().match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})$/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  let year = parseInt(m[3], 10);
  if (year < 100) year += year < 50 ? 2000 : 1900;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Parse a single revision chunk ("Updated 9/20/2025 M. Bellner" /
// "C. Cruz 5/27/24" / "5.13.26 M. Bellner"). Tolerates date-first and
// name-first orderings; strips leading "Updated:" prefix. Returns
// {date, by} or null if no parseable date is present.
function parseRevisionChunk(chunk) {
  const cleaned = chunk.replace(/^\s*(?:updated|edited)\s*:?\s*/i, '').trim();
  if (!cleaned) return null;
  // Date-first: "9/20/2025 M. Bellner"
  let m = cleaned.match(/^([\d\/\.\-]+)\s+(.+)$/);
  if (m) {
    const iso = parseReviewDate(m[1]);
    if (iso) return { date: iso, by: m[2].trim() };
  }
  // Name-first: "C. Cruz 5/27/24"
  m = cleaned.match(/^(.+?)\s+([\d\/\.\-]+)\s*$/);
  if (m) {
    const iso = parseReviewDate(m[2]);
    if (iso) return { date: iso, by: m[1].trim() };
  }
  return null;
}

// Pulls revision lines from the top of the doc. A line may contain multiple
// entries separated by `;` ("Updated: C. Cruz 5/27/24; Updated: M. Bellner
// 6/3/25"). Stops at the first line that doesn't yield a parseable entry —
// that's the title.
function extractRevisionHistory(lines) {
  const history = [];
  let i = 0;
  for (; i < lines.length; i++) {
    // Strip bold/italic wrappers — Floater wraps its revision lines in
    // `__9/23/25 M. Bellner__`, which would otherwise be claimed as the
    // title by extractTitle. Stop the moment a line fails to parse as a
    // revision; that line is the title.
    const raw = stripWrappers(unescape(lines[i].trim()));
    if (!raw) continue;
    const chunks = raw.split(/;\s*/);
    const parsed = chunks.map(parseRevisionChunk);
    if (parsed.some(p => !p)) break;
    parsed.forEach(p => history.push(p));
  }
  return { history, rest: lines.slice(i) };
}

// First non-empty, non-org-header line after the revision block is the title.
// Mammoth wraps the title in `__X__` or `__*X*__` — strip both. Skip a
// preceding "Roots and Wings Homeschool[, Inc.]" line if present.
function extractTitle(lines) {
  for (let i = 0; i < lines.length; i++) {
    const raw = unescape(lines[i].trim());
    if (!raw) continue;
    if (/^roots\s+and\s+wings\s+homeschool/i.test(raw)) continue;
    const m = raw.match(/^_{1,2}\*?(.+?)\*?_{1,2}\s*$/);
    const title = (m ? m[1] : raw).trim();
    return { title, rest: lines.slice(i + 1) };
  }
  return { title: '', rest: lines };
}

// Recognized section labels. Mapped to normalized internal keys.
const SECTION_LABELS = {
  'job length': 'job_length',
  'overview': 'overview',
  'job duties': 'duties',
  'major job duties': 'duties',
  'duties': 'duties',
  'job duties overview': 'duties',
  'job responsibilities': 'duties',
  'responsibilities': 'duties',
};

// Strips bold (`__X__` / `__*X*__`), colons, and whitespace from both ends
// of a label line. Permissive about whether the colon lives inside or
// outside the bold markers — both patterns appear in the docs
// ("__Job Length: __", "__Job Duties__:"). Returns the normalized
// SECTION_LABELS key or null.
function sectionKey(line) {
  let s = unescape(line).trim();
  // Iteratively strip leading/trailing `_`, `*`, `:` and whitespace —
  // covers any nesting of bold/italic/colon ordering.
  let prev = '';
  while (s !== prev) {
    prev = s;
    s = s.replace(/^[\s_*:]+/, '').replace(/[\s_*:]+$/, '');
  }
  return SECTION_LABELS[s.toLowerCase()] || null;
}

// Matches a list item — handles `- foo`, `* foo`, and `1. foo` / `1) foo`
// with optional leading indent. Returns the item text or null.
function listItemText(line) {
  const m = line.match(/^\s*(?:[-*]|\d+[\.\)])\s+(.+)$/);
  return m ? unescape(m[1].trim()) : null;
}

// Iteratively strip `_`, `*`, `:`, whitespace from both ends — covers any
// nesting of markdown bold/italic/colon wrapping that mammoth emits.
function stripWrappers(s) {
  let prev = '';
  let out = String(s == null ? '' : s);
  while (out !== prev) {
    prev = out;
    out = out.replace(/^[\s_*:]+/, '').replace(/[\s_*:]+$/, '');
  }
  return out;
}

// Normalize a term_length line/paragraph into a clean pill value:
// "1 year" / "2 year" / "1 session". Strips bold markers, casing,
// surrounding text ("commitment", "Position", "Assigned for one session"
// → "1 session"), and trailing junk like Field Trip's bizarre
// "...commitment-Part of the Finance Committee..." run-on.
function cleanTermLength(s) {
  const raw = stripWrappers(unescape(s)).replace(/\s+/g, ' ').trim();
  const lc = raw.toLowerCase();
  // First "<digit> year|session" wins — handles "1 Year Commitment",
  // "1-year position", "2 year commitment", "1 year commitment-Part of…"
  const m = lc.match(/(\d+)\s*[-\s]?\s*(year|session)/);
  if (m) return m[1] + ' ' + m[2];
  // Word-form session: "Assigned for one session" / "per session"
  if (/\bone\s+session\b/.test(lc) || /\bper\s+session\b/.test(lc)) return '1 session';
  return raw;
}

// True for short paragraphs/bullets that read as "1 year commitment" /
// "2 years" / "1-year position" — captured as term_length when they appear
// directly after the title with no "Job Length:" label.
function looksLikeTermLength(line) {
  const s = stripWrappers(unescape(String(line == null ? '' : line)));
  return /^\d+[-\s]?(year|session)\b/i.test(s) || /commitment/i.test(s);
}

// Builds { term_length, overview, duties, playbook } from the post-title
// content. Anything that doesn't slot into a structured field flows into
// playbook as markdown so nothing is lost.
function extractSections(lines) {
  const result = { term_length: '', overview: '', duties: [], playbook: '' };
  let current = null;
  let buffer = [];

  const flush = () => {
    const nonEmpty = buffer.filter(l => l.trim());
    if (current === 'job_length') {
      // Multiple paragraphs can land in this section ("1 year commitment"
      // + a stray "__  __" empty-bold artifact). Clean each, drop blanks,
      // join with spaces.
      result.term_length = nonEmpty
        .map(cleanTermLength)
        .filter(s => s.length > 0)
        .join(' ');
    } else if (current === 'overview') {
      const paras = nonEmpty.filter(l => listItemText(l) === null);
      result.overview = paras.map(unescape).join('\n\n').trim();
      // Any bullets inside Overview (rare) fall through to playbook.
      const bullets = nonEmpty.filter(l => listItemText(l) !== null);
      if (bullets.length) {
        result.playbook += (result.playbook ? '\n\n' : '') + bullets.map(b => '- ' + listItemText(b)).join('\n');
      }
    } else if (current === 'duties') {
      nonEmpty.forEach(line => {
        const item = listItemText(line);
        if (item) result.duties.push(item);
      });
    } else if (current === 'playbook_overflow') {
      result.playbook += (result.playbook ? '\n\n' : '') + nonEmpty.map(unescape).join('\n');
    } else if (current) {
      // Unknown labeled section — preserve heading + body in playbook.
      const heading = '## ' + current.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      result.playbook += (result.playbook ? '\n\n' : '') + heading + '\n\n' + nonEmpty.map(unescape).join('\n');
    } else {
      // Pre-section content (no label seen yet). Pull term_length from
      // the first qualifying line; treat bullets as duties; and use
      // unlabeled paragraphs (Afternoon Liaison pattern — description
      // sits between the term_length bold line and the bullet list) as
      // overview, falling back to playbook for paragraphs that appear
      // AFTER any duty bullet has been seen.
      let sawDuty = false;
      for (let i = 0; i < nonEmpty.length; i++) {
        const line = nonEmpty[i];
        const item = listItemText(line);
        if (!result.term_length && looksLikeTermLength(item || line)) {
          result.term_length = cleanTermLength(item || line);
        } else if (item) {
          result.duties.push(item);
          sawDuty = true;
        } else if (!sawDuty) {
          // Paragraph before any bullet — read as overview prose.
          result.overview += (result.overview ? '\n\n' : '') + unescape(line);
        } else {
          // Post-duty paragraph — handoff content, lives in playbook.
          result.playbook += (result.playbook ? '\n\n' : '') + unescape(line);
        }
      }
    }
    buffer = [];
  };

  for (const raw of lines) {
    const key = sectionKey(raw);
    if (key) {
      flush();
      current = key;
      continue;
    }
    // A markdown heading (Timeline / How To / Instructions / Troubleshooting
    // / Technical Info, etc. — mammoth converts Word headings to `#`) ends
    // any structured section and switches everything that follows into
    // playbook mode. Without this, Comms Director's Timeline sub-bullets
    // bleed into duties (~111 of them).
    if (/^#{1,6}\s+/.test(raw.trim())) {
      flush();
      current = 'playbook_overflow';
      buffer.push(raw);
      continue;
    }
    buffer.push(raw);
  }
  flush();

  result.playbook = result.playbook.trim();
  return result;
}

async function importDoc(sql, fullPath, committeeIdByName) {
  const filename = path.basename(fullPath, '.docx');
  const role_key = FILENAME_TO_ROLE_KEY[filename];
  if (!role_key) {
    console.warn(`  skip (no role_key mapping): ${filename}`);
    return;
  }
  const meta = ROLE_META[role_key];
  if (!meta) {
    console.warn(`  skip (no ROLE_META): ${role_key}`);
    return;
  }

  const { value: md } = await mammoth.convertToMarkdown({ path: fullPath });
  const lines = md.split('\n').map(l => l.replace(/\r$/, ''));

  const { history, rest: afterHistory } = extractRevisionHistory(lines);
  const { title: parsedTitle, rest: afterTitle } = extractTitle(afterHistory);
  const title = TITLE_OVERRIDES[role_key] || parsedTitle;
  const sections = extractSections(afterTitle);

  const latest = history[0] || { date: null, by: '' };
  const overlay = BOARD_OVERLAY[role_key] || { icon_emoji: '', role_email: '', card_summary: [] };
  const committee_id = committeeIdByName.get(meta.committee) || null;

  // updated_by tracks the *human* last responsible for this row's
  // content. During import, that's the latest reviewer recorded in the
  // .docx header (M. Bellner, etc.), not the script itself — otherwise
  // the workspace UI displays "Updated by import-role-docs" which is
  // both ugly and not useful.
  const importedBy = latest.by || 'docx import';

  await sql`
    INSERT INTO roles (
      role_key, title, category, committee_id, display_order, status,
      term_length, overview, duties, playbook,
      icon_emoji, card_summary, role_email,
      last_reviewed_by, last_reviewed_date, revision_history,
      updated_by
    ) VALUES (
      ${role_key}, ${title}, ${meta.category}, ${committee_id}, ${meta.display_order}, 'active',
      ${sections.term_length}, ${sections.overview}, ${sections.duties}, ${sections.playbook},
      ${overlay.icon_emoji}, ${overlay.card_summary}, ${overlay.role_email},
      ${latest.by}, ${latest.date}, ${JSON.stringify(history)}::jsonb,
      ${importedBy}
    )
    ON CONFLICT (role_key) DO UPDATE SET
      title = EXCLUDED.title,
      category = EXCLUDED.category,
      committee_id = EXCLUDED.committee_id,
      display_order = EXCLUDED.display_order,
      term_length = EXCLUDED.term_length,
      overview = EXCLUDED.overview,
      duties = EXCLUDED.duties,
      playbook = EXCLUDED.playbook,
      icon_emoji = EXCLUDED.icon_emoji,
      card_summary = EXCLUDED.card_summary,
      role_email = EXCLUDED.role_email,
      last_reviewed_by = EXCLUDED.last_reviewed_by,
      last_reviewed_date = EXCLUDED.last_reviewed_date,
      revision_history = EXCLUDED.revision_history,
      updated_by = EXCLUDED.updated_by
  `;
  console.log(`  ok: ${role_key} (${history.length} review entries, ${sections.duties.length} duties)`);
}

async function seedCommittees(sql) {
  const idByName = new Map();
  for (const [name, order] of Object.entries(COMMITTEE_DISPLAY_ORDER)) {
    const rows = await sql`
      INSERT INTO committees (name, display_order, status, updated_by)
      VALUES (${name}, ${order}, 'active', 'import-role-docs')
      ON CONFLICT (name) DO UPDATE SET
        display_order = EXCLUDED.display_order,
        updated_at = NOW(),
        updated_by = EXCLUDED.updated_by
      RETURNING id
    `;
    idByName.set(name, rows[0].id);
  }
  return idByName;
}

async function linkCommitteeChairs(sql) {
  for (const [role_key, meta] of Object.entries(ROLE_META)) {
    if (meta.category !== 'board') continue;
    await sql`
      UPDATE committees c
      SET chair_role_id = r.id, updated_at = NOW(), updated_by = 'import-role-docs'
      FROM roles r
      WHERE r.role_key = ${role_key}
        AND c.name = ${meta.committee}
    `;
  }
}

// After chairs are linked, point each committee_role's parent_role_id at
// the chair of its committee. The Roles Manager tree (script.js:13836)
// groups by parent_role_id; we'd rather it group by committee.chair_role_id
// once Phase 4 rewrites it, but populating parent_role_id keeps the legacy
// tree working during the parallel phase and serves as a no-cost backstop
// for any other reader.
async function linkCommitteeRoleParents(sql) {
  // Only changes the structural FK — explicitly preserves updated_by /
  // updated_at because this is a re-import bookkeeping step, not a real
  // content edit. Touching updated_by here would mask the actual
  // reviewer (the docx import populates it from revision_history).
  await sql`
    UPDATE roles cr
    SET parent_role_id = c.chair_role_id
    FROM committees c
    WHERE cr.committee_id = c.id
      AND cr.category = 'committee_role'
      AND c.chair_role_id IS NOT NULL
      AND (cr.parent_role_id IS DISTINCT FROM c.chair_role_id)
  `;
}

function listDocs() {
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && p.endsWith('.docx')) out.push(p);
    }
  };
  walk(DOC_ROOT);
  return out;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set. Run with: node --env-file=.env.local.dev scripts/import-role-docs.js');
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);

  console.log('Seeding committees...');
  const committeeIdByName = await seedCommittees(sql);
  console.log(`  ok: ${committeeIdByName.size} committees`);

  const docs = listDocs();
  console.log(`\nImporting ${docs.length} role docs from ${DOC_ROOT}...`);
  for (const doc of docs) {
    await importDoc(sql, doc, committeeIdByName);
  }

  console.log('\nLinking committee chairs...');
  await linkCommitteeChairs(sql);
  console.log('  ok');

  console.log('\nLinking committee_role → chair via parent_role_id...');
  await linkCommitteeRoleParents(sql);
  console.log('  ok');

  console.log('\nDone.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
