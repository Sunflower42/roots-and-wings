// One-time migration: copy rows from the old role_holders table into
// role_holders_v2, mapping old.role_id (role_descriptions.id) →
// new.role_id (roles.id) via role_key. The snapshot person_name and
// family_name columns are dropped — the new schema resolves current
// holder names via the people join (see feedback rw_role_holder_name_resolution).
//
// Idempotent: ON CONFLICT (role_id, LOWER(person_email), school_year) DO NOTHING.
// Re-running after edits won't blow away v2 rows.
//
// Run with: node --env-file=.env.local.dev scripts/migrate-role-holders-to-v2.js
// NEVER run against prod without explicit per-task approval.

const { neon } = require('@neondatabase/serverless');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set. Run with: node --env-file=.env.local.dev scripts/migrate-role-holders-to-v2.js');
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);

  const result = await sql`
    INSERT INTO role_holders_v2 (
      role_id, person_email, school_year, started_at, updated_at, updated_by
    )
    SELECT
      r.id, rh.email, rh.school_year, rh.started_at, rh.updated_at,
      COALESCE(NULLIF(rh.updated_by, ''), 'migrate-to-v2')
    FROM role_holders rh
    JOIN role_descriptions rd ON rd.id = rh.role_id
    JOIN roles r ON r.role_key = rd.role_key
    ON CONFLICT (role_id, (LOWER(person_email)), school_year) DO NOTHING
    RETURNING id
  `;
  console.log(`Inserted ${result.length} rows into role_holders_v2.`);

  const counts = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM role_holders) AS old_count,
      (SELECT COUNT(*)::int FROM role_holders_v2) AS new_count
  `;
  console.log(`old role_holders: ${counts[0].old_count} rows`);
  console.log(`new role_holders_v2: ${counts[0].new_count} rows`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
