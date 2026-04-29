// Inspect member_profiles.kids for a specific family. Helps verify a
// backfill landed: pass the family_email (or just first-letter+last-name
// fragment) and we'll print the kids array verbatim.
//
// Usage:
//   node --env-file=.env.local scripts/inspect-profile-kids.js <family_email_substring>
//   node --env-file=.env.local scripts/inspect-profile-kids.js              # dump all families' kids
const { neon } = require('@neondatabase/serverless');
(async () => {
  const sql = neon(process.env.DATABASE_URL);
  const filter = (process.argv[2] || '').toLowerCase();
  const rows = filter
    ? await sql`SELECT family_email, family_name, kids FROM member_profiles WHERE LOWER(family_email) LIKE ${'%' + filter + '%'} OR LOWER(family_name) LIKE ${'%' + filter + '%'} ORDER BY family_name`
    : await sql`SELECT family_email, family_name, kids FROM member_profiles ORDER BY family_name`;
  if (rows.length === 0) {
    console.log('No member_profiles row matched.');
    return;
  }
  rows.forEach(r => {
    console.log('───────────────────────────────────────────');
    console.log('family:', r.family_name, '|', r.family_email);
    const kids = Array.isArray(r.kids) ? r.kids : [];
    if (kids.length === 0) {
      console.log('  (no kids)');
      return;
    }
    kids.forEach((k, i) => {
      console.log(`  [${i}]`, k.name || '(no name)',
        '| birth_date:', k.birth_date || '(empty)',
        '| schedule:', k.schedule || '(empty)',
        '| allergies:', k.allergies || '(empty)');
    });
  });
})().catch(err => { console.error(err); process.exit(1); });
