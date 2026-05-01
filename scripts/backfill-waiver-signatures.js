// Backfill waiver_signatures from the three legacy waiver sources.
// Run with: node --env-file=.env.local scripts/backfill-waiver-signatures.js
//
// Idempotent: each insert is guarded by a NOT EXISTS check against the
// (LOWER(person_email), season) unique index, so re-running won't duplicate.
//
// Insert order is intentional — Main LCs first, then backup coaches, then
// one-offs. If the same email appears in multiple sources for the same
// season (e.g. someone listed as a backup coach who also registered as an
// MLC), the higher-commitment role wins because it's already in place
// when the lower-commitment insert runs.

const { neon } = require('@neondatabase/serverless');

const OLD_WAIVER_VERSION = '2026-04-27';

// School year runs Aug–May. Anything sent Jun–Jul rolls into the upcoming
// year. Used to derive a season label for one-off waivers, which (unlike
// registrations + backup coaches) carry no native season column.
function seasonFromDate(d) {
  const dt = new Date(d);
  const year = dt.getUTCFullYear();
  const month = dt.getUTCMonth() + 1; // 1–12
  return month >= 8 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set. Run with: node --env-file=.env.local scripts/backfill-waiver-signatures.js');
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);

  // Sanity check — refuse to run if waiver_signatures doesn't exist yet.
  const [hasTable] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'waiver_signatures'
    ) AS ok
  `;
  if (!hasTable.ok) {
    console.error('waiver_signatures table not found. Run scripts/run-migration.js first.');
    process.exit(1);
  }

  let inserted = { mlc: 0, backup: 0, one_off: 0 };

  // ── 1. Main LCs from registrations ──
  const regs = await sql`
    SELECT id, season, email, main_learning_coach,
           waiver_photo_consent, signature_name, signature_date, created_at
    FROM registrations
  `;
  console.log(`Found ${regs.length} registrations to consider.`);
  for (const r of regs) {
    const photoConsent = (r.waiver_photo_consent || '').toLowerCase() === 'yes';
    const result = await sql`
      INSERT INTO waiver_signatures (
        season, waiver_version, role,
        person_name, person_email, family_email, registration_id,
        signed_at, signature_name, signature_date, photo_consent
      )
      SELECT ${r.season}, ${OLD_WAIVER_VERSION}, 'main_lc',
             ${r.main_learning_coach}, ${r.email}, ${r.email}, ${r.id},
             ${r.created_at}, ${r.signature_name || ''}, ${r.signature_date}, ${photoConsent}
      WHERE NOT EXISTS (
        SELECT 1 FROM waiver_signatures
        WHERE LOWER(person_email) = LOWER(${r.email}) AND season = ${r.season}
      )
      RETURNING id
    `;
    if (result.length > 0) inserted.mlc++;
  }

  // ── 2. Backup coaches ──
  const bcs = await sql`
    SELECT b.id, b.registration_id, b.name, b.email, b.token,
           b.signed_at, b.signature_name, b.signature_date,
           b.photo_consent, b.created_at, b.last_sent_at,
           r.season, r.email AS family_email
    FROM backup_coach_waivers b
    JOIN registrations r ON r.id = b.registration_id
  `;
  console.log(`Found ${bcs.length} backup-coach waivers to consider.`);
  for (const b of bcs) {
    const versionIfSigned = b.signed_at ? OLD_WAIVER_VERSION : null;
    const result = await sql`
      INSERT INTO waiver_signatures (
        season, waiver_version, role,
        person_name, person_email, family_email, registration_id,
        signed_at, signature_name, signature_date, photo_consent,
        pending_token, sent_at, last_sent_at
      )
      SELECT ${b.season}, ${versionIfSigned}, 'backup_coach',
             ${b.name}, ${b.email}, ${b.family_email}, ${b.registration_id},
             ${b.signed_at}, ${b.signature_name || ''}, ${b.signature_date},
             ${b.photo_consent === false ? false : true},
             ${b.token}, ${b.created_at}, ${b.last_sent_at}
      WHERE NOT EXISTS (
        SELECT 1 FROM waiver_signatures
        WHERE LOWER(person_email) = LOWER(${b.email}) AND season = ${b.season}
      )
      RETURNING id
    `;
    if (result.length > 0) inserted.backup++;
  }

  // ── 3. One-offs ──
  const oos = await sql`
    SELECT id, name, email, token, sent_by_email, sent_at,
           signed_at, signature_name, signature_date,
           photo_consent, last_sent_at, note
    FROM one_off_waivers
  `;
  console.log(`Found ${oos.length} one-off waivers to consider.`);
  for (const o of oos) {
    const season = seasonFromDate(o.sent_at);
    const versionIfSigned = o.signed_at ? OLD_WAIVER_VERSION : null;
    const result = await sql`
      INSERT INTO waiver_signatures (
        season, waiver_version, role,
        person_name, person_email, family_email, registration_id,
        signed_at, signature_name, signature_date, photo_consent,
        pending_token, sent_at, last_sent_at, sent_by_email, note
      )
      SELECT ${season}, ${versionIfSigned}, 'one_off',
             ${o.name}, ${o.email}, '', NULL,
             ${o.signed_at}, ${o.signature_name || ''}, ${o.signature_date},
             ${o.photo_consent === false ? false : true},
             ${o.token}, ${o.sent_at}, ${o.last_sent_at},
             ${o.sent_by_email || ''}, ${o.note || ''}
      WHERE NOT EXISTS (
        SELECT 1 FROM waiver_signatures
        WHERE LOWER(person_email) = LOWER(${o.email}) AND season = ${season}
      )
      RETURNING id
    `;
    if (result.length > 0) inserted.one_off++;
  }

  console.log('--- Backfill complete ---');
  console.log('  MLCs inserted:          ', inserted.mlc);
  console.log('  Backup coaches inserted:', inserted.backup);
  console.log('  One-offs inserted:      ', inserted.one_off);
  const [total] = await sql`SELECT COUNT(*)::int AS n FROM waiver_signatures`;
  console.log('  waiver_signatures total:', total.n);
})();
