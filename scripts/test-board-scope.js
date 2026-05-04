// Unit test for /api/photos?scope=board response shaping.
//
// shapeBoardRows is the pure function inside api/photos.js that takes
// joined role_holders + role_descriptions + board_photos rows and
// produces the public-facing { role_title, full_name, email, photo_url }
// list — deduped, ordered in canonical board hierarchy, with the
// "Vice-President" / "Vice President" spelling normalized.
//
// What this guards against:
//   - Alphabetical reordering creeping back in (the public site renders
//     President first, not "Afternoon..." or whatever sorts first).
//   - A regression where "Vice-President" leaks through to the public
//     grid because someone added the hyphen to role_descriptions.
//   - Duplicate role rows (multi-school-year holders, accidental double
//     inserts) showing the same person twice.
//   - Photos getting dropped when a row without a photo wins the dedupe
//     race against a row with one.

const assert = require('assert');
const { shapeBoardRows } = require('../api/photos.js');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (err) { console.log('  ✗ ' + name + '\n      ' + err.message); failed++; }
}

console.log('\nshapeBoardRows');

t('orders by canonical board hierarchy regardless of input order', () => {
  const input = [
    { email: 'erin@example.com',    person_name: 'Erin Bogan',     title: 'Communications Director', photo_url: '' },
    { email: 'molly@example.com',   person_name: 'Molly Bellner',  title: 'President',               photo_url: '' },
    { email: 'leann@example.com',   person_name: 'LeAnn Newlin',   title: 'Secretary',               photo_url: '' },
    { email: 'jessica@example.com', person_name: 'Jessica Shewan', title: 'Treasurer',               photo_url: '' },
    { email: 'colleen@example.com', person_name: 'Colleen Raymont',title: 'Vice President',          photo_url: '' }
  ];
  const out = shapeBoardRows(input);
  const titles = out.map(o => o.role_title);
  assert.deepStrictEqual(titles, [
    'President', 'Vice President', 'Treasurer', 'Secretary', 'Communications Director'
  ]);
});

t('normalizes "Vice-President" to "Vice President"', () => {
  const input = [
    { email: 'colleen@example.com', person_name: 'Colleen Raymont', title: 'Vice-President', photo_url: '' }
  ];
  const out = shapeBoardRows(input);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].role_title, 'Vice President');
});

t('dedupes by canonical title, preferring the row with a photo', () => {
  // Multi-school-year holder: same person, same role, two rows.
  // The row with a photo should win.
  const input = [
    { email: 'molly@example.com', person_name: 'Molly Bellner', title: 'President', photo_url: '' },
    { email: 'molly@example.com', person_name: 'Molly Bellner', title: 'President', photo_url: 'https://cdn/molly.jpg' }
  ];
  const out = shapeBoardRows(input);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].photo_url, 'https://cdn/molly.jpg');
});

t('dedupes "Vice-President" + "Vice President" variants into one entry', () => {
  const input = [
    { email: 'colleen@example.com', person_name: 'Colleen Raymont', title: 'Vice-President',  photo_url: '' },
    { email: 'colleen@example.com', person_name: 'Colleen Raymont', title: 'Vice President',  photo_url: 'https://cdn/c.jpg' }
  ];
  const out = shapeBoardRows(input);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].role_title, 'Vice President');
  assert.strictEqual(out[0].photo_url, 'https://cdn/c.jpg');
});

t('lowercases email in the output', () => {
  const out = shapeBoardRows([
    { email: 'Molly@Example.COM', person_name: 'Molly Bellner', title: 'President', photo_url: '' }
  ]);
  assert.strictEqual(out[0].email, 'molly@example.com');
});

t('omits roles not in the canonical list (sort drops them to the end, OK)', () => {
  // A holder for an unrecognized title — historically rare, but the SQL
  // filter already excludes these. Belt-and-suspenders: shape doesn't
  // crash when one slips through.
  const out = shapeBoardRows([
    { email: 'pat@example.com',  person_name: 'Pat',  title: 'President',               photo_url: '' },
    { email: 'who@example.com',  person_name: 'Who',  title: 'Greeter',                 photo_url: '' },
    { email: 'erin@example.com', person_name: 'Erin', title: 'Communications Director', photo_url: '' }
  ]);
  // President + Comms first (canonical), then Greeter at the end.
  assert.strictEqual(out[0].role_title, 'President');
  assert.strictEqual(out[1].role_title, 'Communications Director');
  assert.strictEqual(out[2].role_title, 'Greeter');
});

t('returns empty array for empty / null / undefined input', () => {
  assert.deepStrictEqual(shapeBoardRows([]),        []);
  assert.deepStrictEqual(shapeBoardRows(null),      []);
  assert.deepStrictEqual(shapeBoardRows(undefined), []);
});

t('includes Sustaining Director when a holder exists', () => {
  // Catches a regression where the canonical list dropped this role.
  // (Common-but-easy-to-forget — Sustaining isn't always filled.)
  const out = shapeBoardRows([
    { email: 'anna@example.com', person_name: 'Anna B.', title: 'Sustaining Director', photo_url: '' }
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].role_title, 'Sustaining Director');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
