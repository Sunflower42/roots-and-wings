// Wipes all registration-related rows so the co-op can start real registrations.
// Clears: registrations (cascades backup_coach_waivers) + one_off_waivers.
// Run:   node --env-file=.env.local scripts/wipe-registrations.js
const { neon } = require('@neondatabase/serverless');
(async () => {
  const sql = neon(process.env.DATABASE_URL);
  const [before] = await sql`
    SELECT
      (SELECT count(*)::int FROM registrations)        AS registrations,
      (SELECT count(*)::int FROM backup_coach_waivers) AS backup_coach_waivers,
      (SELECT count(*)::int FROM one_off_waivers)      AS one_off_waivers
  `;
  console.log('before:', before);

  await sql`TRUNCATE TABLE registrations RESTART IDENTITY CASCADE`;
  await sql`TRUNCATE TABLE one_off_waivers RESTART IDENTITY`;

  const [after] = await sql`
    SELECT
      (SELECT count(*)::int FROM registrations)        AS registrations,
      (SELECT count(*)::int FROM backup_coach_waivers) AS backup_coach_waivers,
      (SELECT count(*)::int FROM one_off_waivers)      AS one_off_waivers
  `;
  console.log('after: ', after);
})();
