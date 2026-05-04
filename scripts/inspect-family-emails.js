// Inspect how a family is stored in member_profiles for participation
// debugging — specifically which addresses can resolve to the family.
//
// Usage:
//   node --env-file=.env.local scripts/inspect-family-emails.js <family-fragment>
//
// Pass any substring of the family name or family_email; matches case-
// insensitively. Prints family_email, family_name, additional_emails,
// and a parents summary so we can tell whether a backup learning coach's
// own Workspace address is wired up to resolveFamily.

const { neon } = require('@neondatabase/serverless');
(async () => {
  const sql = neon(process.env.DATABASE_URL);
  const filter = (process.argv[2] || '').toLowerCase();
  if (!filter) {
    console.error('Pass a fragment of the family name or family_email.');
    process.exit(1);
  }
  const rows = await sql`
    SELECT family_email, family_name, additional_emails, parents
    FROM member_profiles
    WHERE LOWER(family_email) LIKE ${'%' + filter + '%'}
       OR LOWER(family_name) LIKE ${'%' + filter + '%'}
    ORDER BY family_name
  `;
  if (rows.length === 0) {
    console.log('No member_profiles row matched.');
    return;
  }
  rows.forEach(r => {
    console.log('───────────────────────────────────────────');
    console.log('family_email:     ', r.family_email);
    console.log('family_name:      ', r.family_name);
    console.log('additional_emails:', JSON.stringify(r.additional_emails || []));
    console.log('parents:');
    (Array.isArray(r.parents) ? r.parents : []).forEach((p, i) => {
      console.log(`  [${i}] name="${p.name || ''}" first="${p.first_name || ''}" last="${p.last_name || ''}" role="${p.role || ''}"`);
      console.log(`      workspace email: ${p.email || '(blank)'}`);
      console.log(`      personal email:  ${p.personal_email || '(blank)'}`);
    });
  });
})().catch(err => { console.error(err); process.exit(1); });
