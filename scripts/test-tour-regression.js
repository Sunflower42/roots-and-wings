// Regression: make sure the existing /api/tour (legacy tour request) still works
// after tour.js was refactored to multiplex kind=tour / kind=registration.
// Mocks Resend via env key absence handling — this just verifies routing +
// validation, not email delivery.
//
// Usage: node --env-file=.env.local scripts/test-tour-regression.js

const handler = require('../api/tour.js');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    json(d) { this.body = d; return this; },
    end() { return this; }
  };
}

async function post(body) {
  const req = { method: 'POST', headers: { origin: 'https://roots-and-wings-topaz.vercel.app' }, body: body, query: {} };
  const res = mockRes();
  await handler(req, res);
  return { status: res.statusCode, data: res.body };
}

(async () => {
  console.log('1. Legacy tour request, missing fields → 400');
  const r1 = await post({ name: 'Test' });
  console.log('   →', r1.status, r1.data && r1.data.error);
  if (r1.status !== 400) throw new Error('Expected 400');

  console.log('2. Legacy tour request, bad email → 400');
  const r2 = await post({ name: 'Test', email: 'not-email', phone: '5551234', numKids: 2, ages: '5, 7' });
  console.log('   →', r2.status, r2.data && r2.data.error);
  if (r2.status !== 400) throw new Error('Expected 400');

  console.log('3. Unknown kind → 400');
  const r3 = await post({ kind: 'bogus' });
  console.log('   →', r3.status, r3.data && r3.data.error);
  if (r3.status !== 400) throw new Error('Expected 400');

  console.log('\n✓ Tour regression tests passed.');
})().catch(err => {
  console.error('\n✗ Failed:', err.message);
  process.exit(1);
});
