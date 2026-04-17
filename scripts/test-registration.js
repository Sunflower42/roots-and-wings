// Smoke test for the new registration endpoint.
// Boots the tour.js handler directly, mocks req/res, and verifies:
//   1. A valid POST registration lands in the DB as 'pending'
//   2. A registration-payment update marks it 'paid'
//   3. Cleans up after itself
// Skips the Resend email (no RESEND_API_KEY needed — error is swallowed).
//
// Usage: node --env-file=.env.local scripts/test-registration.js

const handler = require('../api/tour.js');
const { neon } = require('@neondatabase/serverless');

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    json(data) { this.body = data; return this; },
    end() { return this; }
  };
  return res;
}

async function post(body) {
  const req = { method: 'POST', headers: { origin: 'https://roots-and-wings-topaz.vercel.app' }, body, query: {} };
  const res = mockRes();
  await handler(req, res);
  return { status: res.statusCode, data: res.body };
}

const TEST_EMAIL = 'smoketest+' + Date.now() + '@example.com';
const TEST_SEASON = 'smoketest-' + Date.now();

(async () => {
  const sql = neon(process.env.DATABASE_URL);

  console.log('1. Submitting new registration…');
  const reg = await post({
    kind: 'registration',
    season: TEST_SEASON,
    email: TEST_EMAIL,
    main_learning_coach: 'Smoke Test',
    address: '1 Test St',
    phone: '3175550000',
    track: 'Both',
    kids: [{ name: 'Kid One', birth_date: '2018-05-01' }],
    placement_notes: 'test run',
    waiver_member_agreement: true,
    waiver_photo_consent: 'yes',
    waiver_liability: true,
    signature_name: 'Smoke Test',
    signature_date: new Date().toISOString().slice(0, 10)
  });
  console.log('   →', reg.status, reg.data);
  if (reg.status !== 201) throw new Error('Expected 201');
  const id = reg.data.id;

  console.log('2. Verifying DB row…');
  const rows = await sql`SELECT id, email, main_learning_coach, track, payment_status, kids FROM registrations WHERE id = ${id}`;
  console.log('   →', rows[0]);
  if (rows[0].payment_status !== 'pending') throw new Error('Expected pending');
  if (rows[0].kids.length !== 1) throw new Error('Expected 1 kid');

  console.log('3. Duplicate submission should 409…');
  const dup = await post({
    kind: 'registration', season: TEST_SEASON, email: TEST_EMAIL,
    main_learning_coach: 'Smoke Test', address: '1 Test St', phone: '3175550000',
    track: 'Both', kids: [{ name: 'Kid One', birth_date: '2018-05-01' }],
    waiver_member_agreement: true, waiver_photo_consent: 'yes', waiver_liability: true,
    signature_name: 'Smoke Test', signature_date: new Date().toISOString().slice(0, 10)
  });
  console.log('   →', dup.status, dup.data && dup.data.error);
  if (dup.status !== 409) throw new Error('Expected 409');

  console.log('4. Applying payment update…');
  const pay = await post({
    kind: 'registration-payment',
    id: id,
    paypal_transaction_id: 'TEST-TXN-' + Date.now()
  });
  console.log('   →', pay.status, pay.data);
  if (pay.status !== 200) throw new Error('Expected 200');

  console.log('5. Verifying paid status…');
  const paidRows = await sql`SELECT payment_status, paypal_transaction_id FROM registrations WHERE id = ${id}`;
  console.log('   →', paidRows[0]);
  if (paidRows[0].payment_status !== 'paid') throw new Error('Expected paid');

  console.log('6. Invalid input should 400…');
  const bad = await post({ kind: 'registration', email: 'not-an-email' });
  console.log('   →', bad.status, bad.data && bad.data.error);
  if (bad.status !== 400) throw new Error('Expected 400');

  console.log('7. Cleaning up test row…');
  await sql`DELETE FROM registrations WHERE id = ${id}`;

  console.log('\n✓ All smoke tests passed.');
  process.exit(0);
})().catch(err => {
  console.error('\n✗ Test failed:', err.message);
  process.exit(1);
});
