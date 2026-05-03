// Backfill people + kids tables from member_profiles JSONB.
//
// One-time migration step. Reads every member_profiles row and writes one
// `people` row per parent JSONB entry + one `kids` row per kid JSONB entry.
// Idempotent: rows already present are UPSERTed (refreshed from JSONB).
//
// Per parent JSONB entry:
//   - email: prefer entry.email; fall back to family_email for the MLC slot.
//     BLCs without an email get inserted with email = NULL so they still
//     surface in the EMI form.
//   - first_name / last_name: prefer explicit fields; else heuristic-split
//     entry.name (last word → last_name, rest → first_name; single-word
//     name → first_name only).
//   - role: prefer explicit field; else position-based (0=mlc, 1=blc, 2+=parent).
//   - sort_order: position in JSONB array.
//
// Per kid JSONB entry:
//   - first_name comes from entry.name (the JSONB field is `name` for legacy
//     reasons — only the first whitespace-separated token).
//   - last_name from entry.last_name; empty means "use family_name in display."
//
// Run with:
//   node --env-file=.env.local scripts/backfill-people-kids.js            # dry run, prints counts
//   node --env-file=.env.local scripts/backfill-people-kids.js --confirm  # actually write

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { neon } = require('@neondatabase/serverless');

function parseArgs(argv) {
  const out = { confirm: false, family: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--confirm') out.confirm = true;
    if (argv[i] === '--family' && argv[i + 1]) { out.family = argv[i + 1]; i++; }
  }
  return out;
}

function splitName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

// Treat 'all-day' / 'morning' / 'afternoon' / '' as valid; collapse anything
// else to 'all-day' so we don't trip the kids.schedule CHECK constraint.
function normalizeSchedule(s) {
  const v = String(s || '').trim().toLowerCase();
  if (v === 'all-day' || v === 'morning' || v === 'afternoon' || v === '') return v || 'all-day';
  return 'all-day';
}

function normalizeRole(r, idx) {
  const v = String(r || '').trim().toLowerCase();
  if (v === 'mlc' || v === 'blc' || v === 'parent') return v;
  return idx === 0 ? 'mlc' : idx === 1 ? 'blc' : 'parent';
}

async function main() {
  const args = parseArgs(process.argv);
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set. Run with: node --env-file=.env.local scripts/backfill-people-kids.js');
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);

  const rows = args.family
    ? await sql`
        SELECT family_email, family_name, parents, kids
        FROM member_profiles
        WHERE LOWER(family_email) = ${args.family.toLowerCase()}
      `
    : await sql`
        SELECT family_email, family_name, parents, kids
        FROM member_profiles
        ORDER BY family_email
      `;

  let peoplePlanned = 0;
  let peopleSkipped = 0;
  let kidsPlanned = 0;
  const warnings = [];

  // First pass: just count + warn so a dry-run is informative.
  for (const r of rows) {
    const parents = Array.isArray(r.parents) ? r.parents : [];
    const kids = Array.isArray(r.kids) ? r.kids : [];

    parents.forEach((p, idx) => {
      const role = normalizeRole(p && p.role, idx);
      let email = String((p && p.email) || '').trim().toLowerCase();
      if (!email && role === 'mlc') email = String(r.family_email || '').trim().toLowerCase();
      if (!email && (!p || !String(p.name || '').trim())) {
        // Skip totally empty parent entries (rare, but a few legacy rows
        // have a placeholder {} from early form versions).
        peopleSkipped++;
        warnings.push(`  ⚠ ${r.family_email}: parent[${idx}] is empty, skipped`);
      } else {
        peoplePlanned++;
      }
    });
    kidsPlanned += kids.length;
  }

  console.log(`Plan: ${peoplePlanned} people rows, ${kidsPlanned} kids rows from ${rows.length} families.`);
  if (peopleSkipped) {
    console.log(`Skipped ${peopleSkipped} empty parent entries:`);
    warnings.forEach(w => console.log(w));
  }

  if (!args.confirm) {
    console.log('\nDry run only. Re-run with --confirm to write.');
    return;
  }

  // Second pass: actually write. Each family is a transactional unit —
  // delete its existing people+kids, then insert fresh from JSONB. (Doing
  // it as DELETE+INSERT is safer than UPSERT for this one-time backfill
  // because the JSONB is the source of truth and any half-written row
  // from a prior failed run gets cleaned up.)
  let peopleWritten = 0;
  let kidsWritten = 0;
  let famsTouched = 0;
  for (const r of rows) {
    const parents = Array.isArray(r.parents) ? r.parents : [];
    const kids = Array.isArray(r.kids) ? r.kids : [];
    famsTouched++;

    // Delete and re-seed in one connection — Neon's serverless driver
    // doesn't expose explicit BEGIN/COMMIT, but each statement is its own
    // transaction. The window where people/kids could be inconsistent is
    // tiny (single-family scope); acceptable for a one-time backfill.
    await sql`DELETE FROM people WHERE family_email = ${r.family_email}`;
    await sql`DELETE FROM kids   WHERE family_email = ${r.family_email}`;

    for (let idx = 0; idx < parents.length; idx++) {
      const p = parents[idx] || {};
      const role = normalizeRole(p.role, idx);
      let email = String(p.email || '').trim().toLowerCase();
      if (!email && role === 'mlc') email = String(r.family_email || '').trim().toLowerCase();
      // BLCs without an email get email = NULL (allowed by schema).

      let firstName = String(p.first_name || '').trim();
      let lastName = String(p.last_name || '').trim();
      if (!firstName && !lastName) {
        const split = splitName(p.name);
        firstName = split.first;
        lastName = split.last;
      }
      if (!firstName) continue; // need at least a first name to identify

      const personalEmail = String(p.personal_email || '').trim();
      const phone = String(p.phone || '').trim();
      const pronouns = String(p.pronouns || '').trim();
      const photoUrl = String(p.photo_url || '').trim();
      const photoConsent = p.photo_consent !== false;
      const nicknames = Array.isArray(p.nicknames) ? p.nicknames.map(String) : [];

      try {
        await sql`
          INSERT INTO people (
            email, family_email, first_name, last_name, role,
            personal_email, phone, pronouns, photo_url, photo_consent,
            nicknames, sort_order, updated_by
          ) VALUES (
            ${email || null}, ${r.family_email}, ${firstName}, ${lastName}, ${role},
            ${personalEmail}, ${phone}, ${pronouns}, ${photoUrl}, ${photoConsent},
            ${JSON.stringify(nicknames)}::jsonb, ${idx}, 'backfill-people-kids'
          )
        `;
        peopleWritten++;
      } catch (err) {
        // Most likely cause: same email tagged on two families (e.g. a
        // co-parent miswritten on both rows), or duplicate first_name
        // within a family.
        warnings.push(`  ⚠ ${r.family_email}: parent[${idx}] (${firstName}) insert failed — ${err.message}`);
      }
    }

    for (let idx = 0; idx < kids.length; idx++) {
      const k = kids[idx] || {};
      const firstName = String(k.name || '').trim().split(/\s+/)[0];
      if (!firstName) {
        warnings.push(`  ⚠ ${r.family_email}: kid[${idx}] has no name, skipped`);
        continue;
      }
      const lastName = String(k.last_name || '').trim();
      const birthDate = String(k.birth_date || '').trim() || null;
      const pronouns = String(k.pronouns || '').trim();
      const allergies = String(k.allergies || '').trim();
      const schedule = normalizeSchedule(k.schedule);
      const photoUrl = String(k.photo_url || '').trim();
      const photoConsent = k.photo_consent !== false;

      try {
        await sql`
          INSERT INTO kids (
            family_email, first_name, last_name, birth_date,
            pronouns, allergies, schedule, photo_url, photo_consent,
            sort_order
          ) VALUES (
            ${r.family_email}, ${firstName}, ${lastName}, ${birthDate},
            ${pronouns}, ${allergies}, ${schedule}, ${photoUrl}, ${photoConsent},
            ${idx}
          )
        `;
        kidsWritten++;
      } catch (err) {
        warnings.push(`  ⚠ ${r.family_email}: kid[${idx}] (${firstName}) insert failed — ${err.message}`);
      }
    }
  }

  console.log(`\nDone. ${famsTouched} families processed, ${peopleWritten} people + ${kidsWritten} kids written.`);
  if (warnings.length) {
    console.log('\nWarnings:');
    warnings.forEach(w => console.log(w));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
