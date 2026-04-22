// Dump member_profiles rows so we can see whether kid photo URLs are being
// saved and what shape they're stored in. Run:
//   node --env-file=.env.local scripts/inspect-profiles.js
const { neon } = require('@neondatabase/serverless');
(async () => {
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`
    SELECT family_email, family_name, parents, kids, updated_at
    FROM member_profiles
    ORDER BY updated_at DESC
  `;
  console.log('member_profiles rows:', rows.length);
  rows.forEach(r => {
    console.log('─────────────────────────');
    console.log('family_email:', r.family_email);
    console.log('family_name: ', r.family_name);
    console.log('updated_at:  ', r.updated_at);
    console.log('parents:');
    (r.parents || []).forEach(p => console.log('  -', p.name, '| pronouns:', p.pronouns, '| photo:', p.photo_url ? p.photo_url.slice(0, 80) + '…' : '(none)'));
    console.log('kids:');
    (r.kids || []).forEach(k => console.log('  -', k.name, '| bday:', k.birth_date, '| photo:', k.photo_url ? k.photo_url.slice(0, 80) + '…' : '(none)'));
  });
})();
