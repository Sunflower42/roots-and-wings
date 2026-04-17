// Diagnostic: show all absences for a given person/date, including cancelled.
// Usage: node --env-file=.env.local scripts/check-absence.js "Erin Bogan" 2026-04-21

const { neon } = require('@neondatabase/serverless');

async function main() {
  const [person, date] = process.argv.slice(2);
  if (!person || !date) {
    console.error('Usage: node --env-file=.env.local scripts/check-absence.js "<person>" <YYYY-MM-DD>');
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`
    SELECT id, absent_person, absence_date, session_number, blocks, notes,
           created_by, created_at, cancelled_at
    FROM absences
    WHERE absent_person = ${person} AND absence_date = ${date}
    ORDER BY id
  `;
  console.log(JSON.stringify(rows, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
