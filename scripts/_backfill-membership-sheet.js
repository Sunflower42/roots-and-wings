// Backfill the Membership Registrations sheet with rows from the
// `registrations` table. Useful for seeding the sheet after wiring up
// MEMBERSHIP_SHEET_ID for the first time.
//
// Mirrors the column order built by appendRegistrationToSheet in
// api/tour.js — keep in sync.
//
// Usage: node scripts/_backfill-membership-sheet.js <SHEET_ID> [registration_id]
//   - omit registration_id to append every row in the table
//   - the script never deduplicates: re-running will append again

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { neon } = require('@neondatabase/serverless');
const { google } = require('googleapis');

function loadKey() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  let out = ''; let inStr = false; let esc = false;
  for (const c of raw) {
    if (esc) { out += c; esc = false; continue; }
    if (c === '\\') { out += c; esc = true; continue; }
    if (c === '"') { inStr = !inStr; out += c; continue; }
    if (inStr && c === '\n') { out += '\\n'; continue; }
    if (inStr && c === '\r') continue;
    out += c;
  }
  return JSON.parse(out);
}

const SHEET_ID = process.argv[2];
const ONE_ID = process.argv[3] ? parseInt(process.argv[3], 10) : null;
if (!SHEET_ID) {
  console.error('Usage: node scripts/_backfill-membership-sheet.js <SHEET_ID> [registration_id]');
  process.exit(1);
}

function buildRowValues(reg, backupCoaches) {
  const yn = v => v ? 'Yes' : 'No';
  const kids = Array.isArray(reg.kids) ? reg.kids : [];
  const values = [
    reg.created_at instanceof Date ? reg.created_at.toISOString() : String(reg.created_at || ''),
    reg.id, reg.season, reg.main_learning_coach,
    reg.email, reg.phone, reg.address, reg.track, reg.track_other || '',
    reg.existing_family_name || ''
  ];
  for (let i = 0; i < 10; i++) {
    const k = kids[i];
    values.push(k ? (k.name || '') : '', k ? (k.birth_date || '') : '');
  }
  for (let i = 0; i < 4; i++) {
    const c = backupCoaches[i];
    // 'signed' column: live code writes 'No' for every backup coach at
    // registration time (waiver hadn't been signed yet). Backfill
    // mirrors that: use 'Yes' if signed_at exists, else 'No'.
    values.push(
      c ? (c.name || '') : '',
      c ? (c.email || '') : '',
      c ? (c.signed_at ? 'Yes' : 'No') : ''
    );
  }
  values.push(reg.placement_notes || '',
    yn(reg.waiver_member_agreement),
    reg.waiver_photo_consent === 'yes' ? 'Yes' : 'No',
    yn(reg.waiver_liability),
    reg.signature_name,
    reg.signature_date instanceof Date ? reg.signature_date.toISOString().slice(0, 10) : String(reg.signature_date || ''),
    reg.student_signature || '',
    reg.payment_status,
    String(reg.payment_amount || 0),
    reg.paypal_transaction_id || '');
  return values;
}

(async () => {
  const sql = neon(process.env.DATABASE_URL);
  const auth = new google.auth.GoogleAuth({
    credentials: loadKey(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  const regs = ONE_ID
    ? await sql`SELECT * FROM registrations WHERE id = ${ONE_ID}`
    : await sql`SELECT * FROM registrations ORDER BY id ASC`;
  console.log(`Fetched ${regs.length} registration row(s) from the DB.`);
  if (regs.length === 0) return;

  const allRows = [];
  for (const reg of regs) {
    const backupCoaches = await sql`
      SELECT name, email, signed_at FROM backup_coach_waivers
      WHERE registration_id = ${reg.id}
      ORDER BY id ASC
    `;
    allRows.push(buildRowValues(reg, backupCoaches));
    console.log(`  Prepared row: id=${reg.id} ${reg.main_learning_coach} (${reg.email}) season=${reg.season}`);
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Registrations!A:BZ',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: allRows }
  });
  console.log(`\nAppended ${allRows.length} row(s) to https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
})().catch(e => { console.error(e); process.exit(1); });
