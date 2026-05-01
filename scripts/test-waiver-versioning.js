// End-to-end test for the waiver_signatures consolidation + versioning.
// Boots api/tour.js directly, mocks req/res, exercises the full flow:
//
//   1. New registration → MLC row in waiver_signatures with current version
//   2. Backup coach pending → row exists, no version yet
//   3. Backup coach signs → version stamped, photo_consent honored
//   4. /waivers/<version>.html files exist (read from disk)
//   5. Re-registration in a new season → new row, no duplicate
//   6. Same email re-registration in same season → 409 (uniqueness)
//
// Usage: node --env-file=.env.local scripts/test-waiver-versioning.js
// Requires DATABASE_URL pointing at a Neon branch — this writes test rows.

const fs = require('fs');
const path = require('path');
const handler = require('../api/tour.js');
const { neon } = require('@neondatabase/serverless');
const { WAIVER_VERSION } = require('../api/_config.js');

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: null,
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    json(d) { this.body = d; return this; },
    end() { return this; }
  };
}
async function call(req) {
  const res = mockRes();
  await handler(req, res);
  return { status: res.statusCode, data: res.body };
}
async function post(body) {
  return call({ method: 'POST', headers: { origin: 'https://roots-and-wings-topaz.vercel.app' }, body, query: {} });
}
async function get(query) {
  return call({ method: 'GET', headers: { origin: 'https://roots-and-wings-topaz.vercel.app' }, query });
}

const STAMP = Date.now();
const EMAIL = `wvtest+${STAMP}@example.com`;
const SEASON_A = `wvtest-A-${STAMP}`;
const SEASON_B = `wvtest-B-${STAMP}`;

function payload(overrides) {
  return Object.assign({
    kind: 'registration',
    season: SEASON_A,
    email: EMAIL,
    main_learning_coach: 'Waiver Test Family',
    address: '1 Test St, Indianapolis, IN 46220',
    phone: '3175550000',
    track: 'Both',
    kids: [{ name: 'Test Kid', birth_date: '2018-05-01' }],
    waiver_member_agreement: true,
    waiver_liability: true,
    waiver_photo_consent: 'yes',
    signature_name: 'Waiver Test Family',
    signature_date: new Date().toISOString().slice(0, 10),
    paypal_transaction_id: 'TEST-WV-' + STAMP,
    payment_amount: 40
  }, overrides || {});
}

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set. Run with: node --env-file=.env.local scripts/test-waiver-versioning.js');
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);

  console.log('Current WAIVER_VERSION =', WAIVER_VERSION);

  // ── 1. Register with one backup coach ──
  console.log('1. Submitting new registration (with backup coach)…');
  const bcEmail = `bc+${STAMP}@example.com`;
  const reg = await post(payload({
    backup_coaches: [{ name: 'Backup Coach Pat', email: bcEmail }]
  }));
  console.log('   →', reg.status, reg.data && { id: reg.data.id });
  if (reg.status !== 201) throw new Error('Expected 201');
  const regId = reg.data.id;

  // ── 2. MLC row in waiver_signatures ──
  console.log('2. MLC row written to waiver_signatures with current version…');
  const mlcRows = await sql`
    SELECT role, season, waiver_version, signature_name, person_email, photo_consent
    FROM waiver_signatures WHERE registration_id = ${regId} AND role = 'main_lc'
  `;
  console.log('   →', mlcRows[0]);
  if (mlcRows.length !== 1) throw new Error('Expected exactly one MLC row');
  if (mlcRows[0].waiver_version !== WAIVER_VERSION) throw new Error(`Expected MLC version ${WAIVER_VERSION}, got ${mlcRows[0].waiver_version}`);
  if (mlcRows[0].photo_consent !== true) throw new Error('Expected MLC photo_consent=true (waiver_photo_consent=yes)');

  // ── 3. Backup coach row pending (no version yet) ──
  console.log('3. Backup coach row created, version still NULL until sign…');
  const bcRows = await sql`
    SELECT id, person_name, pending_token, signed_at, waiver_version
    FROM waiver_signatures WHERE registration_id = ${regId} AND role = 'backup_coach'
  `;
  console.log('   →', bcRows[0]);
  if (bcRows.length !== 1) throw new Error('Expected exactly one BC row');
  if (bcRows[0].signed_at) throw new Error('BC should not be signed yet');
  if (bcRows[0].waiver_version) throw new Error('BC waiver_version should be NULL pre-sign');
  if (!bcRows[0].pending_token) throw new Error('BC should have a pending_token');

  // ── 4. BC signs → version stamped at sign time ──
  console.log('4. Backup coach signs → version stamped, photo opt-out honored…');
  const bcSign = await post({
    kind: 'backup-waiver-sign',
    token: bcRows[0].pending_token,
    signature_name: 'Backup Coach Patricia',
    signature_date: new Date().toISOString().slice(0, 10),
    photo_consent: false
  });
  console.log('   →', bcSign.status, bcSign.data);
  if (bcSign.status !== 200) throw new Error('Expected 200 from sign');
  const bcSigned = await sql`
    SELECT signed_at, signature_name, photo_consent, waiver_version
    FROM waiver_signatures WHERE id = ${bcRows[0].id}
  `;
  console.log('   →', bcSigned[0]);
  if (!bcSigned[0].signed_at) throw new Error('Expected signed_at populated');
  if (bcSigned[0].waiver_version !== WAIVER_VERSION) throw new Error('Expected version stamp at sign time');
  if (bcSigned[0].photo_consent !== false) throw new Error('Expected photo opt-out honored');

  // ── 5. Archived version files exist on disk ──
  console.log('5. Archived /waivers/<version>.html files exist…');
  const waiversDir = path.join(__dirname, '..', 'waivers');
  const archivedFiles = fs.readdirSync(waiversDir).filter(f => /^\d{4}-\d{2}-\d{2}\.html$/.test(f));
  console.log('   →', archivedFiles);
  if (archivedFiles.length === 0) throw new Error('No archived waiver files found in /waivers/');
  if (!archivedFiles.includes(`${WAIVER_VERSION}.html`)) {
    throw new Error(`Missing archive snapshot for current version: waivers/${WAIVER_VERSION}.html`);
  }

  // ── 6. Re-registration in a new season → new MLC row, no duplicate ──
  console.log('6. Re-registration in new season → new row, not a duplicate…');
  const reg2 = await post(payload({
    season: SEASON_B,
    email: EMAIL, // same person
    paypal_transaction_id: 'TEST-WV-B-' + STAMP
  }));
  console.log('   →', reg2.status, reg2.data && { id: reg2.data.id });
  if (reg2.status !== 201) throw new Error('Expected 201 for new-season registration');
  const allMlc = await sql`
    SELECT season, waiver_version FROM waiver_signatures
    WHERE LOWER(person_email) = LOWER(${EMAIL}) AND role = 'main_lc'
    ORDER BY season
  `;
  console.log('   → MLC rows for this email:', allMlc);
  if (allMlc.length !== 2) throw new Error('Expected 2 MLC rows (one per season)');
  if (allMlc[0].season === allMlc[1].season) throw new Error('Seasons should differ');

  // ── 7. Same email + same season → registrations table 409 ──
  console.log('7. Duplicate registration in same season → 409…');
  const dupReg = await post(payload({
    paypal_transaction_id: 'TEST-WV-DUP-' + STAMP
  }));
  console.log('   →', dupReg.status, dupReg.data && dupReg.data.error);
  if (dupReg.status !== 409) throw new Error('Expected 409 from duplicate registration');

  // ── 8. Cleanup ──
  console.log('8. Cleaning up test rows…');
  await sql`DELETE FROM registrations WHERE id IN (${regId}, ${reg2.data.id})`;
  // waiver_signatures rows cascade via registration_id FK.

  console.log('\n✓ All waiver-versioning tests passed.');
  process.exit(0);
})().catch(err => {
  console.error('\n✗ Test failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
