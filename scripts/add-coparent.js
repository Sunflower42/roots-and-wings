// DEPRECATED — writes to the legacy member_profiles.parents JSONB column,
// which is no longer read after the people-table migration. Use
// `INSERT INTO people` (or the EMI form) instead. Left in the tree for
// historical reference; do NOT use to add a new co-parent.
//
// Append a co-parent to an existing family's member_profiles.parents JSONB.
//
// Idempotent — if a parent with the same first name already exists on the row,
// we update their pronouns instead of inserting a duplicate.
//
// Usage:
//   node scripts/add-coparent.js \
//     --family-name=Shewan \
//     --parent-name=Jay \
//     [--pronouns="he/him"]
//
// Add --confirm to actually write. Without --confirm we print what would
// change and exit (dry-run is the default — safer for an auth-adjacent table).

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { neon } = require('@neondatabase/serverless');

function parseArgs(argv) {
  const out = { confirm: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confirm') { out.confirm = true; continue; }
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const familyName = String(args['family-name'] || '').trim();
  const parentName = String(args['parent-name'] || '').trim();
  const pronouns = String(args['pronouns'] || '').trim();

  if (!familyName || !parentName) {
    console.error('Usage: node scripts/add-coparent.js --family-name=Shewan --parent-name=Jay [--pronouns="he/him"] [--confirm]');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set (expected in .env.local).');
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);

  const matches = await sql`
    SELECT family_email, family_name, parents, kids
    FROM member_profiles
    WHERE LOWER(family_name) = LOWER(${familyName})
  `;

  if (matches.length === 0) {
    console.error(`No member_profiles row found with family_name = "${familyName}".`);
    console.error('If this family has not been seeded yet, run scripts/seed-profiles-from-sheet.js first.');
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`Multiple rows match family_name = "${familyName}":`);
    matches.forEach(r => console.error(`  - ${r.family_email} (${r.family_name})`));
    console.error('Disambiguate manually before re-running.');
    process.exit(1);
  }

  const row = matches[0];
  const existingParents = Array.isArray(row.parents) ? row.parents : [];
  const firstLc = parentName.toLowerCase().split(/\s+/)[0];
  const existing = existingParents.find(p =>
    p && p.name && String(p.name).toLowerCase().split(/\s+/)[0] === firstLc
  );

  let action, nextParents;
  if (existing) {
    action = 'UPDATE';
    nextParents = existingParents.map(p => {
      if (p === existing) {
        return {
          name: p.name,
          pronouns: pronouns || p.pronouns || '',
          photo_url: p.photo_url || '',
          photo_consent: p.photo_consent !== false
        };
      }
      return p;
    });
  } else {
    action = 'APPEND';
    nextParents = existingParents.concat([{
      name: parentName,
      pronouns: pronouns,
      photo_url: '',
      photo_consent: true
    }]);
  }

  console.log(`Row: ${row.family_email} (family_name=${row.family_name})`);
  console.log(`  Parents now: ${JSON.stringify(existingParents, null, 2)}`);
  console.log(`  Action: ${action} ${parentName}${pronouns ? ' (' + pronouns + ')' : ''}`);
  console.log(`  Parents next: ${JSON.stringify(nextParents, null, 2)}`);

  if (!args.confirm) {
    console.log('');
    console.log('(dry run — no writes made. Re-run with --confirm to apply.)');
    return;
  }

  await sql`
    UPDATE member_profiles
       SET parents = ${JSON.stringify(nextParents)}::jsonb,
           updated_at = NOW(),
           updated_by = 'add-coparent.js'
     WHERE family_email = ${row.family_email}
  `;
  console.log('');
  console.log(`Wrote. ${row.family_email} parents now has ${nextParents.length} entries.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
