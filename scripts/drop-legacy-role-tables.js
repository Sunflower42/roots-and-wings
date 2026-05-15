// Phase 5 cleanup: drops the legacy role tables (role_descriptions,
// role_holders, cleaning_config) after the v2 cutover is complete.
//
// Run ONLY AFTER:
//   1. node --env-file=<env> scripts/run-migration.js
//      (creates committees, roles, role_holders_v2 alongside the legacy)
//   2. node --env-file=<env> scripts/import-role-docs.js
//      (seeds committees + roles from roles/Volunteer Position Job Descriptions/)
//   3. node --env-file=<env> scripts/migrate-role-holders-to-v2.js
//      (copies role_holders → role_holders_v2 by role_key)
//   4. Spot-check: counts match, current school year holders present.
//
// This script is one-shot and intentionally not part of migrate.sql so
// run-migration.js can't drop the legacy tables before the data has
// been migrated. Idempotent via IF EXISTS — safe to run twice.
//
// For dev: node --env-file=.env.local.dev scripts/drop-legacy-role-tables.js
// For prod: node --env-file=.env.local scripts/drop-legacy-role-tables.js
//          (Erin runs this herself per the no-prod-db-queries feedback rule.)

const { neon } = require('@neondatabase/serverless');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set. Run with: node --env-file=<env> scripts/drop-legacy-role-tables.js');
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);

  // Pre-flight: confirm the new tables exist and have data. Bail loudly
  // if they're empty — that means steps 2+3 above haven't run and the
  // drop would lose the only copy of the data.
  const checks = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM roles) AS roles_count,
      (SELECT COUNT(*)::int FROM committees) AS committees_count,
      (SELECT COUNT(*)::int FROM role_holders_v2) AS holders_count
  `;
  const c = checks[0];
  console.log(`Pre-flight: roles=${c.roles_count}, committees=${c.committees_count}, role_holders_v2=${c.holders_count}`);
  if (c.roles_count === 0 || c.committees_count === 0) {
    console.error('REFUSING TO DROP: roles/committees are empty. Run import-role-docs.js first.');
    process.exit(2);
  }
  if (c.holders_count === 0) {
    console.warn('WARNING: role_holders_v2 is empty. If the legacy role_holders had rows, run migrate-role-holders-to-v2.js first.');
    console.warn('Continuing in 3 seconds — Ctrl-C to abort.');
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log('Dropping legacy tables...');
  await sql`DROP TABLE IF EXISTS role_holders`;
  console.log('  ok: role_holders');
  await sql`DROP TABLE IF EXISTS role_descriptions`;
  console.log('  ok: role_descriptions');
  await sql`DROP TABLE IF EXISTS cleaning_config`;
  console.log('  ok: cleaning_config');

  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
