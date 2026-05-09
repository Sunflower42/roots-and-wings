// Seed the dev branch with role-named fake families so dev testers can
// impersonate any role by picking the obviously-named family from the
// View As dropdown (e.g. "President", "Treasurer", "Membership Director").
// Each family's email = <role>@rootsandwingsindy.com so it's clear at a
// glance which role you're acting as.
//
// All data here is FAKE — invented names, kids, addresses. Safe to share
// publicly. No real R&W members are referenced.
//
// Idempotent: ON CONFLICT clauses skip rows already present. Re-run any time.
//
// Prereqs (run once against the dev branch first):
//   node --env-file=.env.local.dev scripts/run-migration.js
//   node --env-file=.env.local.dev scripts/seed-role-descriptions.js
//
// Usage:
//   node --env-file=.env.local.dev scripts/seed-dev-data.js

const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');

const SEASON = '2026-2027';
const SCHOOL_YEAR = '2026-2027';
const OLD_VERSION = '2026-04-27';

// One family per major role. The Vercel/script.js dropdown label resolves
// to firstName + ' ' + lastName, so firstName MUST equal the (capitalized)
// email prefix — that's how deriveFirstNameFromLogin matches a user back
// to their parentInfo entry. lastName is the role descriptor that pairs
// naturally ("Communications Director", "Afternoon Class Liaison"). A
// uniform "Family" suffix is used for short single-word roles where there's
// no longer descriptor that reads cleanly.
// Distinct gender-neutral first names per role so seeded display names
// look like real people ("Cam Communications Director" rather than just
// "Communications Director"). The role-as-last-name pattern keeps each
// row self-documenting in the DB. people.first_name + last_name and
// role_holders.person_name both end up with the same string, so the
// preferred join (people→role_holders by email) and the role_holders
// fallback agree at seed time.
const ROLE_FAMILIES = [
  { roleKey: 'president',                familyEmail: 'president@rootsandwingsindy.com',      firstName: 'Pat',    lastName: 'President'              },
  { roleKey: 'vice_president',           familyEmail: 'vp@rootsandwingsindy.com',             firstName: 'Vee',    lastName: 'Vice-President'         },
  { roleKey: 'communications_director',  familyEmail: 'communications@rootsandwingsindy.com', firstName: 'Cam',    lastName: 'Communications Director' },
  { roleKey: 'membership_director',      familyEmail: 'membership@rootsandwingsindy.com',     firstName: 'Mel',    lastName: 'Membership Director'    },
  { roleKey: 'treasurer',                familyEmail: 'treasurer@rootsandwingsindy.com',      firstName: 'Tess',   lastName: 'Treasurer'              },
  { roleKey: 'secretary',                familyEmail: 'secretary@rootsandwingsindy.com',      firstName: 'Sam',    lastName: 'Secretary'              },
  { roleKey: 'afternoon_class_liaison',  familyEmail: 'afternoon@rootsandwingsindy.com',      firstName: 'Avery',  lastName: 'Afternoon Class Liaison' },
  { roleKey: 'morning_class_liaison',    familyEmail: 'morning@rootsandwingsindy.com',        firstName: 'Morgan', lastName: 'Morning Class Liaison'  }
];

// One regular member family with no role — for testing the "what does a
// rank-and-file member see?" perspective.
const REGULAR_FAMILY = {
  familyEmail: 'member@rootsandwingsindy.com',
  firstName: 'Reg',
  lastName: 'Member'
};

function buildFamilyRecord(f) {
  return {
    family_email: f.familyEmail,
    family_name: f.lastName,
    phone: '3175550000',
    address: '100 Dev Lane, Indianapolis, IN 46220',
    parents: [
      {
        name: f.firstName + ' ' + f.lastName,
        firstName: f.firstName,
        lastName: f.lastName,
        email: f.familyEmail,
        role: 'mlc'
      }
    ],
    kids: [
      { name: 'Test Kid', birth_date: '2018-01-15', photo_consent: true }
    ]
  };
}

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set. Run with: node --env-file=.env.local.dev scripts/seed-dev-data.js');
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);

  // Refuse to run against prod. Heuristic: if registrations.email shows
  // any *.gmail.com / personal-domain entries (real members), abort.
  const realLooking = await sql`
    SELECT COUNT(*)::int AS n FROM registrations
    WHERE email NOT LIKE '%@rootsandwingsindy.com' AND email NOT LIKE '%@example.com'
  `;
  if (realLooking[0].n > 0) {
    console.error(`registrations contains ${realLooking[0].n} non-rootsandwings/example email(s) — looks like prod, aborting.`);
    process.exit(1);
  }

  const allFamilies = ROLE_FAMILIES.map(buildFamilyRecord).concat([buildFamilyRecord(REGULAR_FAMILY)]);

  console.log('--- Seeding member_profiles + people + kids ---');
  for (const f of allFamilies) {
    await sql`
      INSERT INTO member_profiles (family_email, family_name, phone, address, parents, kids)
      VALUES (${f.family_email}, ${f.family_name}, ${f.phone}, ${f.address},
              '[]'::jsonb, '[]'::jsonb)
      ON CONFLICT (family_email) DO UPDATE SET
        family_name = EXCLUDED.family_name,
        phone = EXCLUDED.phone,
        address = EXCLUDED.address
    `;
    // Wipe + re-insert so re-running with edited fixture data produces
    // the expected state instead of stacking duplicate people/kids.
    await sql`DELETE FROM people WHERE family_email = ${f.family_email}`;
    await sql`DELETE FROM kids   WHERE family_email = ${f.family_email}`;
    for (let i = 0; i < f.parents.length; i++) {
      const p = f.parents[i];
      await sql`
        INSERT INTO people (
          email, family_email, first_name, last_name, role, sort_order, updated_by
        ) VALUES (
          ${(p.email || '').toLowerCase() || null}, ${f.family_email},
          ${p.firstName || ''}, ${p.lastName || ''}, ${p.role || 'parent'},
          ${i}, 'seed-dev-data'
        )
      `;
    }
    for (let i = 0; i < f.kids.length; i++) {
      const k = f.kids[i];
      await sql`
        INSERT INTO kids (
          family_email, first_name, last_name, birth_date, photo_consent, sort_order
        ) VALUES (
          ${f.family_email}, ${(k.name || '').split(/\s+/)[0]}, ${k.last_name || ''},
          ${k.birth_date || null}, ${k.photo_consent !== false}, ${i}
        )
      `;
    }
    console.log('  ✓', f.family_email);
  }

  console.log('--- Seeding registrations + waiver_signatures (MLC) ---');
  for (const f of allFamilies) {
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

  console.log('--- Seeding role_holders ---');
  for (const rf of ROLE_FAMILIES) {
    const r = await sql`SELECT id FROM role_descriptions WHERE role_key = ${rf.roleKey} LIMIT 1`;
    if (r.length === 0) {
      console.log('  ! skip', rf.roleKey, '(no role_descriptions row — run seed-role-descriptions.js first)');
      continue;
    }
    const personName = rf.firstName + ' ' + rf.lastName;
    await sql`
      INSERT INTO role_holders (role_id, email, person_name, family_name, school_year, updated_by)
      VALUES (${r[0].id}, ${rf.familyEmail}, ${personName}, ${rf.lastName}, ${SCHOOL_YEAR}, 'seed-dev-data.js')
      ON CONFLICT (role_id, LOWER(email), school_year) DO NOTHING
    `;
    console.log('  ✓', rf.roleKey.padEnd(28), '→', rf.familyEmail);
  }

  // ── A pending backup-coach + signed backup-coach + one-off, hung off
  //    the President family so the Waivers Report has variety to render.
  const [presReg] = await sql`SELECT id FROM registrations WHERE email = ${ROLE_FAMILIES[0].familyEmail} AND season = ${SEASON} LIMIT 1`;
  if (presReg) {
    await sql`
      INSERT INTO waiver_signatures (
        season, waiver_version, role, person_name, person_email, family_email,
        registration_id, signed_at, signature_name, signature_date, photo_consent,
        pending_token, sent_at
      ) VALUES
        (${SEASON}, ${OLD_VERSION}, 'backup_coach', 'Backup Pat', 'backup-pat+dev@example.com',
         ${ROLE_FAMILIES[0].familyEmail}, ${presReg.id},
         NOW(), 'Backup Pat', '2026-04-28', true,
         ${crypto.randomUUID().replace(/-/g, '')}, NOW()),
        (${SEASON}, NULL, 'backup_coach', 'Pending Coach', 'pending-coach+dev@example.com',
         ${ROLE_FAMILIES[0].familyEmail}, ${presReg.id},
         NULL, '', NULL, true,
         ${crypto.randomUUID().replace(/-/g, '')}, NOW())
      ON CONFLICT DO NOTHING
    `;
    console.log('  ✓ President family backup coaches (1 signed, 1 pending)');
  }

  await sql`
    INSERT INTO waiver_signatures (
      season, role, person_name, person_email,
      pending_token, sent_at, sent_by_email, note
    ) VALUES (
      ${SEASON}, 'one_off', 'Visiting Helper', 'visitor+dev@example.com',
      ${crypto.randomUUID().replace(/-/g, '')}, NOW(), 'communications@rootsandwingsindy.com',
      'Visiting helper for spring co-op day — needs waiver on file.'
    )
    ON CONFLICT DO NOTHING
  `;
  console.log('  ✓ one-off pending waiver');

  console.log('--- Final state ---');
  const [profiles] = await sql`SELECT COUNT(*)::int AS n FROM member_profiles`;
  const [regs] = await sql`SELECT COUNT(*)::int AS n FROM registrations`;
  const [waivers] = await sql`SELECT COUNT(*)::int AS n FROM waiver_signatures`;
  const [holders] = await sql`SELECT COUNT(*)::int AS n FROM role_holders`;
  console.log('  member_profiles:    ', profiles.n);
  console.log('  registrations:      ', regs.n);
  console.log('  waiver_signatures:  ', waivers.n);
  console.log('  role_holders:       ', holders.n);
  console.log('\n✓ Seed complete. Sign in to dev with any @rootsandwingsindy.com Google account; the View As dropdown lets you impersonate any role.');
})().catch(err => {
  console.error('Seed failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
