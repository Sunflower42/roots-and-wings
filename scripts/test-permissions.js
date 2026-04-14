// Unit tests for api/_permissions.js
//
// Run with: node scripts/test-permissions.js
//
// These tests do NOT hit Google Sheets. They validate:
//   1. Volunteer-role parsing from sheet-shaped row data
//   2. Directory email derivation (firstname + last initial + domain)
//   3. canEditAsRole's super-user short-circuit
//   4. canEditAsRole's fail-closed behavior on sheet errors
//
// The live sheet lookup is exercised by the module's default path; these
// tests substitute the cache so we don't need real credentials.

const assert = require('assert');
const perms = require('../api/_permissions');

let passed = 0;
let failed = 0;

function t(name, fn) {
  try {
    fn();
    console.log('  \u2713 ' + name);
    passed++;
  } catch (err) {
    console.log('  \u2717 ' + name);
    console.log('      ' + err.message);
    failed++;
  }
}

// ── 1. parseVolunteerRoles ──────────────────────────────────────────────
console.log('\nparseVolunteerRoles');

// Shape mirrors the real volunteer-roles tab: col 1 = label, col 2 = value.
// Committee headers (label matches /Committee\s*$/) should be skipped.
// "Chair: <title> - <person>" rows should produce { title, person }.
// Regular rows should produce { title, person }.
const volFixture = [
  [''],
  ['', 'Facility Committee'],
  ['', 'Chair: President - Molly Bellner'],
  ['', 'Opener & Morning Set-Up', 'Ada Lovelace'],
  ['', 'Cleaning Crew Liaison', 'Grace Hopper'],
  ['', 'Programming Committee'],
  ['', 'Chair: Vice President - Colleen Raymont'],
  ['', 'Supply Coordinator', 'Jody Wilson'],
  ['', 'See chart to the right'],
  ['', 'Support Committee'],
  ['', 'Parent Social Events', 'Alan Turing']
];

const roles = perms._parseVolunteerRoles(volFixture);

t('returns array', () => assert(Array.isArray(roles)));

t('skips committee headers', () => {
  assert(!roles.some(r => /Committee\s*$/i.test(r.title)));
});

t('extracts Chair rows with title + person', () => {
  const chair = roles.find(r => r.title === 'President');
  assert(chair, 'expected a President entry');
  assert.strictEqual(chair.person, 'Molly Bellner');
});

t('extracts normal role rows', () => {
  const sc = roles.find(r => r.title === 'Supply Coordinator');
  assert(sc, 'expected Supply Coordinator entry');
  assert.strictEqual(sc.person, 'Jody Wilson');
});

t('skips "See chart" filler rows', () => {
  assert(!roles.some(r => /See chart/i.test(r.title)));
});

t('skips rows with empty person', () => {
  // The fixture has a committee header with no value; it should not become a role.
  assert(!roles.some(r => r.person === ''));
});

// ── 2. buildDirectoryEmailMap ──────────────────────────────────────────
console.log('\nbuildDirectoryEmailMap');

const dirFixture = [
  ['Name', 'Phone Number', 'Child 1'],
  ['Jody Wilson', '555-0100', 'Kid (he/him)'],
  ['Amber & Bobby Furnish', '555-0101', 'Kid'],
  ['Grace Hopper (she/her)', '555-0102', 'Kid'],
  ['', '', ''],
  ['Madonna', '555-0199', '']  // malformed — only one word, no last name — should skip
];

const emailMap = perms._buildDirectoryEmailMap(dirFixture);

t('derives firstname+lastinitial email for single parent', () => {
  assert.strictEqual(emailMap['wilson'], 'jodyw@rootsandwingsindy.com');
});

t('uses FIRST parent of multi-parent family', () => {
  assert.strictEqual(emailMap['furnish'], 'amberf@rootsandwingsindy.com');
});

t('strips pronoun parens', () => {
  assert.strictEqual(emailMap['hopper'], 'graceh@rootsandwingsindy.com');
});

t('skips rows with only one word (no last name)', () => {
  // "Madonna" has no last name — should produce no email, no key.
  assert(!('madonna' in emailMap));
});

t('keys are lowercased', () => {
  assert('wilson' in emailMap);
  assert(!('Wilson' in emailMap));
});

// ── 3. canEditAsRole: super-user short-circuit ────────────────────────
console.log('\ncanEditAsRole (super-user path — no sheet access needed)');

(async () => {
  t('super user allowed for any role', async () => {
    // communications@ hits the short-circuit BEFORE the sheet call, so it
    // does not need MASTER_SHEET_ID / credentials to pass.
    const ok = await perms.canEditAsRole('communications@rootsandwingsindy.com', 'Supply Coordinator');
    assert.strictEqual(ok, true);
  });

  t('super user check is case-insensitive on email', async () => {
    const ok = await perms.canEditAsRole('Communications@RootsAndWingsIndy.com', 'Supply Coordinator');
    assert.strictEqual(ok, true);
  });

  t('empty email rejected', async () => {
    const ok = await perms.canEditAsRole('', 'Supply Coordinator');
    assert.strictEqual(ok, false);
  });

  t('null email rejected', async () => {
    const ok = await perms.canEditAsRole(null, 'Supply Coordinator');
    assert.strictEqual(ok, false);
  });

  // ── 4. Fail-closed on sheet error ──────────────────────────────────
  console.log('\ncanEditAsRole (fail-closed on lookup error)');

  t('non-super-user rejected when sheet env is unconfigured', async () => {
    // Without MASTER_SHEET_ID, loadRoleHolders() throws; canEditAsRole
    // should catch and return false for non-super-users.
    const prevMaster = process.env.MASTER_SHEET_ID;
    const prevDir = process.env.DIRECTORY_SHEET_ID;
    delete process.env.MASTER_SHEET_ID;
    delete process.env.DIRECTORY_SHEET_ID;
    perms.invalidateRoleCache();
    const ok = await perms.canEditAsRole('jodyw@rootsandwingsindy.com', 'Supply Coordinator');
    process.env.MASTER_SHEET_ID = prevMaster;
    process.env.DIRECTORY_SHEET_ID = prevDir;
    perms.invalidateRoleCache();
    assert.strictEqual(ok, false, 'should fail closed when sheet fetch errors');
  });

  // ── getRoleHolderEmails batch lookup: fail-closed when no sheet ────
  console.log('\ngetRoleHolderEmails (fail-closed)');

  t('returns {} when sheet fetch errors', async () => {
    const prevMaster = process.env.MASTER_SHEET_ID;
    const prevDir = process.env.DIRECTORY_SHEET_ID;
    delete process.env.MASTER_SHEET_ID;
    delete process.env.DIRECTORY_SHEET_ID;
    perms.invalidateRoleCache();
    const out = await perms.getRoleHolderEmails(['President', 'Treasurer']);
    process.env.MASTER_SHEET_ID = prevMaster;
    process.env.DIRECTORY_SHEET_ID = prevDir;
    perms.invalidateRoleCache();
    assert.deepStrictEqual(out, {});
  });

  t('returns {} for empty/invalid input', async () => {
    assert.deepStrictEqual(await perms.getRoleHolderEmails([]), {});
    assert.deepStrictEqual(await perms.getRoleHolderEmails(null), {});
    assert.deepStrictEqual(await perms.getRoleHolderEmails(undefined), {});
  });

  // ── Wrap-up ────────────────────────────────────────────────────────
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
})();
