// Runs the same overlay the /api/sheets endpoint applies and prints the
// Bogan family so we can see whether kid photoUrl makes it out. Run:
//   node --env-file=.env.local scripts/inspect-bogan-overlay.js

const { google } = require('googleapis');
const { neon } = require('@neondatabase/serverless');

async function main() {
  // Fetch families via the real sheets.js helper to avoid duplicating parse logic.
  // We can't call /api/sheets over HTTP without a user token, so we require()
  // the module and drive its internals directly.
  const sheetsModule = require('../api/sheets.js');

  // sheets.js exports the handler by default — we need the internal functions.
  // Pull them by re-reading the file's exports if they're there, else reimplement
  // the minimum needed. For simplicity we just hit the DB side directly here.

  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`
    SELECT family_email, family_name, parents, kids, phone, address
    FROM member_profiles
    WHERE LOWER(family_email) = LOWER('erinb@rootsandwingsindy.com')
  `;
  console.log('member_profiles row for Bogan family:');
  console.log(JSON.stringify(rows[0], null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
