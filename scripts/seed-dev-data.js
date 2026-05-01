// Seed the dev branch with minimal fake data so every UI surface renders.
// Idempotent: run as many times as you want; uses ON CONFLICT to skip rows
// that already exist by their natural key.
//
// All data here is FAKE — invented names, email addresses, kids. Safe to
// share publicly. No real R&W members are referenced.
//
// Usage: node --env-file=.env.local.dev scripts/seed-dev-data.js

const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');

const SEASON = '2026-2027';
const OLD_VERSION = '2026-04-27';

const FAKE_FAMILIES = [
  {
    family_email: 'sarahd@rootsandwingsindy.com',
    family_name: 'Demo',
    phone: '3175550101',
    address: '100 Demo Lane, Indianapolis, IN 46220',
    parents: [
      { firstName: 'Sarah', lastName: 'Demo', email: 'sarahd@rootsandwingsindy.com', role: 'mlc' },
      { firstName: 'Mark',  lastName: 'Demo', email: 'markd+dev@example.com',         role: 'parent' }
    ],
    kids: [
      { name: 'Lily', birth_date: '2017-04-12', photo_consent: true },
      { name: 'Theo', birth_date: '2019-09-30', photo_consent: true }
    ]
  },
  {
    family_email: 'jenexample@rootsandwingsindy.com',
    family_name: 'Example',
    phone: '3175550202',
    address: '200 Example Ave, Indianapolis, IN 46220',
    parents: [
      { firstName: 'Jen',   lastName: 'Example', email: 'jenexample@rootsandwingsindy.com', role: 'mlc' },
      { firstName: 'Robin', lastName: 'Example', email: 'robine+dev@example.com',           role: 'blc' }
    ],
    kids: [
      { name: 'Casey', birth_date: '2016-08-05', photo_consent: true }
    ]
  },
  {
    family_email: 'commsdev@rootsandwingsindy.com',
    family_name: 'CommsTest',
    phone: '3175550303',
    address: '300 Test Rd, Indianapolis, IN 46220',
    parents: [
      { firstName: 'Comms', lastName: 'Test', email: 'commsdev@rootsandwingsindy.com', role: 'mlc' }
    ],
    kids: [
      { name: 'Sample', birth_date: '2018-01-15', photo_consent: true }
    ]
  }
];

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set. Run with: node --env-file=.env.local.dev scripts/seed-dev-data.js');
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);

  // Refuse to run if any real-looking data exists. Heuristic: if registrations
  // count > 50, this is probably prod — abort. Free dev branch should be near-empty.
  const [count] = await sql`SELECT COUNT(*)::int AS n FROM registrations`;
  if (count.n > 50) {
    console.error(`registrations has ${count.n} rows — this looks like prod, not dev. Aborting.`);
    process.exit(1);
  }

  console.log('--- Seeding member_profiles ---');
  for (const f of FAKE_FAMILIES) {
    await sql`
      INSERT INTO member_profiles (family_email, family_name, phone, address, parents, kids)
      VALUES (${f.family_email}, ${f.family_name}, ${f.phone}, ${f.address},
              ${JSON.stringify(f.parents)}::jsonb, ${JSON.stringify(f.kids)}::jsonb)
      ON CONFLICT (family_email) DO UPDATE SET
        family_name = EXCLUDED.family_name,
        phone = EXCLUDED.phone,
        address = EXCLUDED.address,
        parents = EXCLUDED.parents,
        kids = EXCLUDED.kids
    `;
    console.log('  ✓', f.family_email);
  }

  console.log('--- Seeding registrations + waiver_signatures (MLC) ---');
  for (const f of FAKE_FAMILIES) {
    const mlc = f.parents[0];
    const mlcFullName = mlc.firstName + ' ' + mlc.lastName;
    const seedTxnId = 'SEED-' + f.family_email;
    const inserted = await sql`
      INSERT INTO registrations (
        season, email, main_learning_coach, address, phone,
        track, kids,
        waiver_member_agreement, waiver_photo_consent, waiver_liability,
        signature_name, signature_date,
        payment_status, payment_amount, paypal_transaction_id
      ) VALUES (
        ${SEASON}, ${f.family_email}, ${mlcFullName}, ${f.address}, ${f.phone},
        'Both', ${JSON.stringify(f.kids)}::jsonb,
        true, 'yes', true,
        ${mlcFullName}, '2026-04-27',
        'paid', 40, ${seedTxnId}
      )
      ON CONFLICT (LOWER(email), season) DO NOTHING
      RETURNING id
    `;
    if (inserted.length === 0) { console.log('  - skipped (already seeded):', f.family_email); continue; }
    const regId = inserted[0].id;
    await sql`
      INSERT INTO waiver_signatures (
        season, waiver_version, role, person_name, person_email, family_email,
        registration_id, signed_at, signature_name, signature_date, photo_consent
      ) VALUES (
        ${SEASON}, ${OLD_VERSION}, 'main_lc', ${mlcFullName},
        ${f.family_email}, ${f.family_email}, ${regId},
        NOW(), ${mlcFullName}, '2026-04-27', true
      )
      ON CONFLICT DO NOTHING
    `;
    console.log('  ✓', f.family_email, 'reg id', regId);
  }

  // ── Backup coaches ──
  // First family: one signed BC + one pending BC.
  const [reg1] = await sql`SELECT id FROM registrations WHERE email = ${FAKE_FAMILIES[0].family_email} AND season = ${SEASON} LIMIT 1`;
  if (reg1) {
    await sql`
      INSERT INTO waiver_signatures (
        season, waiver_version, role, person_name, person_email, family_email,
        registration_id, signed_at, signature_name, signature_date, photo_consent,
        pending_token, sent_at
      ) VALUES
        (${SEASON}, ${OLD_VERSION}, 'backup_coach', 'Mark Demo', 'markd+dev@example.com',
         ${FAKE_FAMILIES[0].family_email}, ${reg1.id},
         NOW(), 'Mark Demo', '2026-04-28', true,
         ${crypto.randomUUID().replace(/-/g, '')}, NOW()),
        (${SEASON}, NULL, 'backup_coach', 'Grandma Demo', 'grandma+dev@example.com',
         ${FAKE_FAMILIES[0].family_email}, ${reg1.id},
         NULL, '', NULL, true,
         ${crypto.randomUUID().replace(/-/g, '')}, NOW())
      ON CONFLICT DO NOTHING
    `;
    console.log('  ✓ Demo family backup coaches (1 signed, 1 pending)');
  }

  // ── One pending one-off ──
  await sql`
    INSERT INTO waiver_signatures (
      season, role, person_name, person_email,
      pending_token, sent_at, sent_by_email, note
    ) VALUES (
      ${SEASON}, 'one_off', 'Fake Visiting Helper', 'visitor+dev@example.com',
      ${crypto.randomUUID().replace(/-/g, '')}, NOW(), 'commsdev@rootsandwingsindy.com',
      'Visiting helper for spring co-op day — needs waiver on file.'
    )
    ON CONFLICT DO NOTHING
  `;
  console.log('  ✓ one-off pending waiver');

  console.log('--- Final state ---');
  const [profiles] = await sql`SELECT COUNT(*)::int AS n FROM member_profiles`;
  const [regs] = await sql`SELECT COUNT(*)::int AS n FROM registrations`;
  const [waivers] = await sql`SELECT COUNT(*)::int AS n FROM waiver_signatures`;
  console.log('  member_profiles:    ', profiles.n);
  console.log('  registrations:      ', regs.n);
  console.log('  waiver_signatures:  ', waivers.n);
  console.log('\n✓ Seed complete. Dev branch is ready.');
})().catch(err => {
  console.error('Seed failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
