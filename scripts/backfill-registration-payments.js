// Backfill payments rows from existing paid registrations.
//
// Until 2026-04-27 the registration form only wrote to the `registrations`
// table — billing didn't know to mark Fall membership Paid until the
// Treasurer manually updated the billing sheet. Going forward,
// handleRegistration auto-writes to `payments`. This script catches up
// every registration that was paid before the auto-write went in.
//
// Idempotent: skips rows that already have a payments row for the same
// (family, semester, payment_type, school_year). Safe to re-run.
//
// Usage:
//   node scripts/backfill-registration-payments.js
//   node scripts/backfill-registration-payments.js --dry  # preview only

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { neon } = require('@neondatabase/serverless');

const DRY = process.argv.includes('--dry');

// Mirrors deriveFamilyName in api/tour.js: prefer existing_family_name,
// otherwise take the last word of main_learning_coach.
function deriveFamilyName(mainLC, existing) {
  if (existing && String(existing).trim()) return String(existing).trim();
  const parts = String(mainLC || '').trim().split(/\s+/);
  return parts.length >= 2 ? parts[parts.length - 1] : '';
}

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set.');
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);

  const regs = await sql`
    SELECT id, season, email, existing_family_name, main_learning_coach,
           payment_amount, paypal_transaction_id, payment_status, created_at
    FROM registrations
    WHERE payment_status = 'paid'
    ORDER BY created_at
  `;
  console.log(`Found ${regs.length} paid registrations.\n`);

  let inserted = 0, skipped = 0, errored = 0;
  for (const r of regs) {
    const famName = deriveFamilyName(r.main_learning_coach, r.existing_family_name);
    if (!famName) {
      console.warn(`  ! reg ${r.id} (${r.email}): no family name derivable from "${r.main_learning_coach}"`);
      errored++;
      continue;
    }
    const cents = Math.round((parseFloat(r.payment_amount) || 0) * 100);
    const dup = await sql`
      SELECT id FROM payments
      WHERE LOWER(family_name) = LOWER(${famName})
        AND semester_key = 'fall'
        AND payment_type = 'deposit'
        AND school_year = ${r.season}
      LIMIT 1
    `;
    if (dup.length > 0) {
      console.log(`  · ${famName} ${r.season}: already has payments row (id ${dup[0].id})`);
      skipped++;
      continue;
    }
    if (DRY) {
      console.log(`  + ${famName} ${r.season}: would insert ($${(cents / 100).toFixed(2)})`);
      inserted++;
      continue;
    }
    await sql`
      INSERT INTO payments (
        family_name, semester_key, payment_type, school_year,
        paypal_transaction_id, amount_cents, payer_email, status, created_at
      ) VALUES (
        ${famName}, 'fall', 'deposit', ${r.season},
        ${r.paypal_transaction_id || ''}, ${cents}, ${r.email}, 'Paid', ${r.created_at}
      )
    `;
    console.log(`  + ${famName} ${r.season}: inserted ($${(cents / 100).toFixed(2)})`);
    inserted++;
  }

  console.log(`\nDone. ${DRY ? '(dry run) ' : ''}inserted=${inserted} skipped=${skipped} errored=${errored}`);
})().catch(err => { console.error(err); process.exit(1); });
