// Read-only peek at registrations + related waiver tables so we can see
// what a "clear registrations" would wipe. Run:
//   node --env-file=.env.local scripts/inspect-registrations.js
const { neon } = require('@neondatabase/serverless');
(async () => {
  const sql = neon(process.env.DATABASE_URL);
  const [reg] = await sql`SELECT count(*)::int AS n FROM registrations`;
  const [bcw] = await sql`SELECT count(*)::int AS n FROM backup_coach_waivers`;
  const [oow] = await sql`SELECT count(*)::int AS n FROM one_off_waivers`;
  const rows = await sql`
    SELECT id, created_at, email, main_learning_coach, payment_status, paypal_transaction_id
    FROM registrations
    ORDER BY created_at DESC
    LIMIT 25
  `;
  console.log('registrations rows:        ', reg.n);
  console.log('backup_coach_waivers rows: ', bcw.n);
  console.log('one_off_waivers rows:      ', oow.n);
  console.log('--- latest 25 registrations ---');
  rows.forEach(r => console.log(
    String(r.created_at).slice(0, 19), '|',
    (r.email || '').padEnd(32), '|',
    (r.main_learning_coach || '').padEnd(28), '|',
    r.payment_status, '|',
    r.paypal_transaction_id
  ));
})();
