// One-off: replace the table-level UNIQUE (absent_person, absence_date) on
// absences with a partial unique index that only applies to non-cancelled
// rows, so soft-deleted absences no longer block a new submission.
//
// Usage: node --env-file=.env.local scripts/fix-absences-unique.js

const { neon } = require('@neondatabase/serverless');

async function main() {
  const sql = neon(process.env.DATABASE_URL);

  const constraints = await sql`
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'absences'::regclass AND contype = 'u'
  `;
  for (const row of constraints) {
    console.log('Dropping constraint:', row.conname);
    await sql.query(`ALTER TABLE absences DROP CONSTRAINT "${row.conname}"`);
  }

  console.log('Creating partial unique index absences_active_unique_idx');
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS absences_active_unique_idx
    ON absences (absent_person, absence_date)
    WHERE cancelled_at IS NULL
  `;

  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
