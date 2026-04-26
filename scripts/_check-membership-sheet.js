// Pre-flight check before wiring MEMBERSHIP_SHEET_ID into Vercel.
// Confirms the service account can see the sheet and lists its tabs.
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
  console.error('Usage: node scripts/_check-membership-sheet.js <SHEET_ID>');
  process.exit(1);
}

(async () => {
  const auth = new google.auth.GoogleAuth({
    credentials: loadKey(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'properties.title,sheets.properties' });
    console.log('OK — service account can read this sheet.');
    console.log('Sheet title:', meta.data.properties.title);
    console.log('Tabs:');
    meta.data.sheets.forEach(s => {
      console.log('  - "' + s.properties.title + '" (id=' + s.properties.sheetId + ', rows=' + s.properties.gridProperties.rowCount + ', cols=' + s.properties.gridProperties.columnCount + ')');
    });
    const hasRegistrations = meta.data.sheets.some(s => s.properties.title === 'Registrations');
    console.log('\nHas a "Registrations" tab?', hasRegistrations ? 'YES' : 'NO — needs to be created');
  } catch (e) {
    console.error('FAIL — service account cannot access the sheet.');
    console.error('  ', e.message);
    console.error('\nFix: in the Sheet, click Share → add rw-sheets-reader@rw-members-auth.iam.gserviceaccount.com as Editor.');
  }
})();
