// Apply migrate.sql to the Postgres database pointed at by DATABASE_URL.
// Run with: node --env-file=.env.local scripts/run-migration.js
// Safe to re-run (all statements use CREATE ... IF NOT EXISTS).

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set. Run with: node --env-file=.env.local scripts/run-migration.js');
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const migrationPath = path.join(__dirname, 'migrate.sql');
  const schema = fs.readFileSync(migrationPath, 'utf8');

  // Strip SQL line-comments, then split on semicolons. Statements here are
  // simple enough that a plain split works — revisit if we add functions or
  // DO blocks that contain semicolons.
  const stripped = schema
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');

  const statements = stripped
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  console.log(`Running ${statements.length} statements against database...`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.split('\n')[0].slice(0, 60);
    try {
      await sql.query(stmt);
      console.log(`  [${i + 1}/${statements.length}] ok: ${preview}`);
    } catch (err) {
      console.error(`  [${i + 1}/${statements.length}] FAILED: ${preview}`);
      console.error(`    ${err.message}`);
      process.exit(1);
    }
  }

  console.log('Migration complete.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
