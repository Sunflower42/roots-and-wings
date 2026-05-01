// Read-only — counts signatures per date across all three waiver tables.
// Used to confirm assumptions before the waiver-versioning backfill.
//   node --env-file=.env.local scripts/inspect-signature-dates.js
const { neon } = require('@neondatabase/serverless');

(async () => {
  const sql = neon(process.env.DATABASE_URL);

  console.log('--- registrations.signature_date ---');
  const reg = await sql`
    SELECT signature_date::text AS d, COUNT(*)::int AS n
    FROM registrations
    GROUP BY signature_date
    ORDER BY signature_date
  `;
  reg.forEach(r => console.log('  ', r.d, ' ', r.n));
  console.log('  total:', reg.reduce((s, r) => s + r.n, 0));

  console.log('--- backup_coach_waivers.signature_date (signed only) ---');
  const bcw = await sql`
    SELECT signature_date::text AS d, COUNT(*)::int AS n
    FROM backup_coach_waivers
    WHERE signed_at IS NOT NULL
    GROUP BY signature_date
    ORDER BY signature_date
  `;
  bcw.forEach(r => console.log('  ', r.d, ' ', r.n));
  console.log('  total signed:', bcw.reduce((s, r) => s + r.n, 0));
  const [bcwPending] = await sql`SELECT COUNT(*)::int AS n FROM backup_coach_waivers WHERE signed_at IS NULL`;
  console.log('  pending (no signature yet):', bcwPending.n);

  console.log('--- one_off_waivers.signature_date (signed only) ---');
  const oow = await sql`
    SELECT signature_date::text AS d, COUNT(*)::int AS n
    FROM one_off_waivers
    WHERE signed_at IS NOT NULL
    GROUP BY signature_date
    ORDER BY signature_date
  `;
  oow.forEach(r => console.log('  ', r.d, ' ', r.n));
  console.log('  total signed:', oow.reduce((s, r) => s + r.n, 0));
  const [oowPending] = await sql`SELECT COUNT(*)::int AS n FROM one_off_waivers WHERE signed_at IS NULL`;
  console.log('  pending (no signature yet):', oowPending.n);

  console.log('--- earliest signature across all three ---');
  const [earliest] = await sql`
    SELECT MIN(d)::text AS d FROM (
      SELECT signature_date AS d FROM registrations
      UNION ALL SELECT signature_date FROM backup_coach_waivers WHERE signed_at IS NOT NULL
      UNION ALL SELECT signature_date FROM one_off_waivers      WHERE signed_at IS NOT NULL
    ) x
  `;
  console.log('  ', earliest.d);
})();
