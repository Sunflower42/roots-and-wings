// One-time setup for the Membership registrations sheet:
//   1. Renames the default "Sheet1" tab to "Registrations".
//   2. Writes the header row that mirrors the column layout
//      appendRegistrationToSheet writes in api/tour.js.
//
// Idempotent — safe to re-run. Skips the rename if a Registrations tab
// already exists, and overwrites row 1 either way.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
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
if (!SHEET_ID) {
  console.error('Usage: node scripts/_setup-membership-sheet.js <SHEET_ID>');
  process.exit(1);
}

// Mirrors the column order built in appendRegistrationToSheet (tour.js).
// Keep in sync when that function changes.
const HEADERS = [
  'submitted_at', 'id', 'season', 'main_learning_coach',
  'email', 'phone', 'address', 'track', 'track_other', 'existing_family_name',
  // 10 kid pairs
  ...Array.from({ length: 10 }, (_, i) => [`kid${i+1}_name`, `kid${i+1}_birth_date`]).flat(),
  // 4 backup-coach triples
  ...Array.from({ length: 4 }, (_, i) => [`backup${i+1}_name`, `backup${i+1}_email`, `backup${i+1}_signed`]).flat(),
  'placement_notes',
  'waiver_member_agreement', 'waiver_photo_consent', 'waiver_liability',
  'signature_name', 'signature_date', 'student_signature',
  'payment_status', 'payment_amount', 'paypal_transaction_id'
];

(async () => {
  const auth = new google.auth.GoogleAuth({
    credentials: loadKey(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  // 1. Find the Registrations tab id (rename Sheet1 if needed).
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties' });
  let regTab = meta.data.sheets.find(s => s.properties.title === 'Registrations');
  if (!regTab) {
    const sheet1 = meta.data.sheets.find(s => s.properties.title === 'Sheet1');
    if (!sheet1) throw new Error('No "Registrations" or "Sheet1" tab to rename.');
    console.log('Renaming Sheet1 → Registrations...');
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [{
          updateSheetProperties: {
            properties: { sheetId: sheet1.properties.sheetId, title: 'Registrations' },
            fields: 'title'
          }
        }]
      }
    });
    regTab = { properties: { ...sheet1.properties, title: 'Registrations' } };
  } else {
    console.log('Registrations tab already exists — skipping rename.');
  }

  // 2. Write/refresh the header row.
  console.log(`Writing header row (${HEADERS.length} columns)...`);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: 'Registrations!A1',
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS] }
  });

  // 3. Bold + freeze the header row for usability.
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: regTab.properties.sheetId,
              startRowIndex: 0, endRowIndex: 1,
              startColumnIndex: 0, endColumnIndex: HEADERS.length
            },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: 'userEnteredFormat.textFormat.bold'
          }
        },
        {
          updateSheetProperties: {
            properties: {
              sheetId: regTab.properties.sheetId,
              gridProperties: { frozenRowCount: 1 }
            },
            fields: 'gridProperties.frozenRowCount'
          }
        }
      ]
    }
  });

  console.log(`\nDone. Sheet is ready to receive registrations at:`);
  console.log(`  https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
})().catch(e => { console.error(e); process.exit(1); });
