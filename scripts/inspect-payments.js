// Read-only peek at the payments + registrations tables so we can see why
// the billing card might be empty. Run:
//   node --env-file=.env.local scripts/inspect-payments.js
const { neon } = require('@neondatabase/serverless');
(async () => {
  const sql = neon(process.env.DATABASE_URL);

  const [pCount] = await sql`SELECT count(*)::int AS n FROM payments`;
  const [rCount] = await sql`SELECT count(*)::int AS n FROM registrations`;
  console.log('payments rows:      ', pCount.n);
  console.log('registrations rows: ', rCount.n);

  if (pCount.n > 0) {
    const pRows = await sql`
      SELECT id, family_name, family_email, semester_key, payment_type,
             school_year, status, payer_email, created_at
      FROM payments
      ORDER BY created_at DESC
      LIMIT 25
    `;
    console.log('\n--- latest payments rows ---');
    pRows.forEach(p => console.log(
      String(p.created_at).slice(0, 19),
      '| id', String(p.id).padEnd(4),
      '|', (p.family_name || '').padEnd(20),
      '|', (p.family_email || '(empty)').padEnd(36),
      '|', p.semester_key, p.payment_type,
      '|', p.status,
      '|', p.school_year
    ));
  }

  if (rCount.n > 0) {
    const rRows = await sql`
      SELECT id, created_at, email, main_learning_coach, existing_family_name,
             season, payment_status
      FROM registrations
      ORDER BY created_at DESC
      LIMIT 25
    `;
    console.log('\n--- latest registrations ---');
    rRows.forEach(r => console.log(
      String(r.created_at).slice(0, 19),
      '| id', String(r.id).padEnd(4),
      '|', (r.email || '').padEnd(32),
      '|', (r.main_learning_coach || '').padEnd(24),
      '|', (r.existing_family_name || '(new)').padEnd(20),
      '|', r.season,
      '|', r.payment_status
    ));
  }
})().catch(err => { console.error(err); process.exit(1); });
