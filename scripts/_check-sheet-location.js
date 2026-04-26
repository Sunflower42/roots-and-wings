// Reports the Drive owner / parent / shared-drive status for the
// Membership registrations sheet so we can confirm it lives in the
// R&W shared drive and not in someone's personal Drive.
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

const SHEET_ID = '1du9BvMoe_ulPwN58cuD0OgyuP5IAIB7OGYAZC5K9-K4';

(async () => {
  const auth = new google.auth.GoogleAuth({
    credentials: loadKey(),
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });
  const drive = google.drive({ version: 'v3', auth: await auth.getClient() });

  try {
    const f = await drive.files.get({
      fileId: SHEET_ID,
      fields: 'id,name,owners,parents,driveId,teamDriveId,shared,sharingUser',
      supportsAllDrives: true
    });
    console.log('File:', f.data.name);
    console.log('  ID:', f.data.id);
    console.log('  Shared:', f.data.shared);
    console.log('  driveId (shared drive):', f.data.driveId || '(none — lives in My Drive)');
    console.log('  parents:', f.data.parents || '(none)');
    console.log('  owners:', (f.data.owners || []).map(o => o.emailAddress).join(', ') || '(no owner — lives in a shared drive)');
    if (!f.data.driveId) {
      console.log('\n  ⚠ This file is in a personal My Drive, not a shared drive.');
      console.log('  To move it: open the sheet → File → Move → pick the R&W shared drive.');
    } else {
      console.log('\n  ✓ Lives in a shared drive.');
    }
  } catch (e) {
    console.error('Could not read Drive metadata.');
    console.error('  ', e.message);
    console.error('\nThe service account has Sheets access but not Drive metadata.');
    console.error('Check the file owner manually: open the Sheet and look at File → Information.');
  }
})();
