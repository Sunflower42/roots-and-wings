// Backfill payments.family_email from existing rows.
//
// Pre-Phase-4 the My Family billing card joined sheet/DB by family_name —
// the last word of the MLC's name. Compound surnames ("O'Connor Gading"),
// hyphens, and registrants who supplied an existing_family_name that
// didn't match the Directory all silently broke this lookup, so a Pending
// payments row could exist while the family's billing card stayed Due.
//
// Phase 4 keys the lookup off member_profiles.family_email instead. This
// script populates that column for rows inserted before the cutover.
//
// Match strategy:
//   1. payments.family_name → member_profiles.family_name (case-insensitive).
//   2. Fallback: payments.payer_email matches a profile's family_email or
//      additional_emails entry.
//   3. Anything still unmatched is logged for the Treasurer to fix manually.
//
// Idempotent: only updates rows where family_email is currently empty.
//
// Usage:
//   node --env-file=.env.local scripts/backfill-payments-family-email.js
//   node --env-file=.env.local scripts/backfill-payments-family-email.js --dry

const { neon } = require('@neondatabase/serverless');

const DRY = process.argv.includes('--dry');

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set.');
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);

  const rows = await sql`
    SELECT id, family_name, payer_email, school_year, semester_key, payment_type, status
    FROM payments
    WHERE COALESCE(family_email, '') = ''
    ORDER BY id
  `;
  console.log(`Found ${rows.length} payments rows missing family_email.\n`);
  if (rows.length === 0) {
    console.log('Nothing to backfill.');
    return;
  }

  const profiles = await sql`
    SELECT family_email, family_name, additional_emails FROM member_profiles
  `;
  const byName = {};
  const byEmail = {};
  profiles.forEach(p => {
    const fe = String(p.family_email || '');
    if (p.family_name) {
      byName[String(p.family_name).toLowerCase()] = fe;
    }
    byEmail[fe.toLowerCase()] = fe;
    (p.additional_emails || []).forEach(ae => {
      byEmail[String(ae || '').toLowerCase()] = fe;
    });
  });

  let nameHit = 0, emailHit = 0, missed = 0;
  for (const r of rows) {
    const nameKey = String(r.family_name || '').toLowerCase();
    const emailKey = String(r.payer_email || '').toLowerCase();
    const viaName = byName[nameKey];
    const viaEmail = byEmail[emailKey];
    const famEmail = viaName || viaEmail || '';
    if (!famEmail) {
      console.warn(`  ! id ${r.id} (${r.family_name} / ${r.payer_email}): no profile match`);
      missed++;
      continue;
    }
    const matchedBy = viaName ? 'name' : 'email';
    if (matchedBy === 'name') nameHit++; else emailHit++;
    if (DRY) {
      console.log(`  + id ${r.id}: ${r.family_name} → ${famEmail} (via ${matchedBy})`);
      continue;
    }
    await sql`
      UPDATE payments SET family_email = ${famEmail} WHERE id = ${r.id}
    `;
    console.log(`  + id ${r.id}: ${r.family_name} → ${famEmail} (via ${matchedBy})`);
  }

  console.log(`\nDone. ${DRY ? '(dry run) ' : ''}name=${nameHit} email=${emailHit} missed=${missed}`);
})().catch(err => { console.error(err); process.exit(1); });
