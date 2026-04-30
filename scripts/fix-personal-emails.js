// Clear member_profiles.parents[].personal_email where it accidentally
// duplicates the workspace email.
//
// Background: an earlier version of upsertProfileFromRegistration wrote
// the registration form's "Your email" field into personal_email for
// the MLC. For people who registered using their workspace address,
// that produced personal_email === email. Edit My Info then displayed
// the same value in both fields. Going forward registration no longer
// touches personal_email — this script cleans up the rows it already
// dirtied.
//
// Idempotent: only touches parent entries where personal_email matches
// email (case-insensitive), or matches family_email.
//
// Usage:
//   node --env-file=.env.local scripts/fix-personal-emails.js --dry
//   node --env-file=.env.local scripts/fix-personal-emails.js

const { neon } = require('@neondatabase/serverless');

const DRY = process.argv.includes('--dry');

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set.');
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);

  const rows = await sql`
    SELECT family_email, family_name, parents
    FROM member_profiles
    WHERE jsonb_array_length(parents) > 0
    ORDER BY family_name
  `;
  console.log(`Scanning ${rows.length} families.\n`);

  let cleared = 0, untouched = 0;

  for (const row of rows) {
    const parents = Array.isArray(row.parents) ? row.parents : [];
    const familyEmailLc = String(row.family_email || '').toLowerCase();
    let dirty = false;

    const next = parents.map(p => {
      if (!p) return p;
      const pe = String(p.personal_email || '').toLowerCase();
      const we = String(p.email || '').toLowerCase();
      if (!pe) return p;
      // Clear when personal === workspace (the bug) OR personal ===
      // family_email (legacy MLC edge case).
      if (pe === we || pe === familyEmailLc) {
        console.log(`  - ${row.family_email} | ${p.name || p.first_name || '(parent)'} | personal_email "${p.personal_email}" cleared (matched workspace)`);
        dirty = true;
        cleared++;
        return Object.assign({}, p, { personal_email: '' });
      }
      return p;
    });

    if (!dirty) { untouched++; continue; }
    if (DRY) continue;

    await sql`
      UPDATE member_profiles
      SET parents = ${JSON.stringify(next)}::jsonb,
          updated_at = NOW(),
          updated_by = 'fix-personal-emails'
      WHERE family_email = ${row.family_email}
    `;
  }

  console.log(`\nDone. ${DRY ? '(dry run) ' : ''}cleared=${cleared} untouched=${untouched}`);
})().catch(err => { console.error(err); process.exit(1); });
