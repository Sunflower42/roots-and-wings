// Recover member_profiles.kids[].photo_url values from Vercel Blob.
//
// Background: an earlier kid-merge pass (commit 3ef110e, since fixed)
// used Array.find which returned only the first matching entry from a
// duplicated kid list — losing photo URLs that lived only on the
// second duplicate. The blobs themselves were never deleted (Vercel
// Blob doesn't auto-purge), so this script reconnects them.
//
// Strategy:
//   1. For each member_profiles row, list blobs under
//      `profiles/<family-email-localpart>/`.
//   2. For each kid missing a photo_url, look for a blob whose key
//      contains the kid's slug (lowercased name with spaces → hyphens).
//   3. Pick the most-recently-uploaded matching blob and set
//      kids[].photo_url to its URL.
//
// Idempotent: only touches kids whose photo_url is currently empty.
//
// Usage:
//   node --env-file=.env.local scripts/recover-kid-photos.js --dry
//   node --env-file=.env.local scripts/recover-kid-photos.js

const { neon } = require('@neondatabase/serverless');
const { list } = require('@vercel/blob');

const DRY = process.argv.includes('--dry');

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set.');
    process.exit(1);
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('BLOB_READ_WRITE_TOKEN not set.');
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`
    SELECT family_email, family_name, kids
    FROM member_profiles
    WHERE jsonb_array_length(kids) > 0
    ORDER BY family_name
  `;
  console.log(`Scanning ${rows.length} families for kids missing photos.\n`);

  let restored = 0, scanned = 0, errored = 0;

  for (const row of rows) {
    const kids = Array.isArray(row.kids) ? row.kids : [];
    const missingPhotos = kids.filter(k => k && k.name && !k.photo_url);
    if (missingPhotos.length === 0) continue;

    const famSlug = String(row.family_email || '').split('@')[0];
    if (!famSlug) continue;

    let blobs;
    try {
      const result = await list({
        prefix: `profiles/${famSlug}/`,
        token: process.env.BLOB_READ_WRITE_TOKEN
      });
      blobs = result.blobs || [];
    } catch (err) {
      console.warn(`  ! ${row.family_email}: blob list failed — ${err.message}`);
      errored++;
      continue;
    }

    if (blobs.length === 0) continue;

    // Sort newest-first so we pick the latest upload per kid.
    blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    let dirty = false;
    const updatedKids = kids.map(kid => {
      scanned++;
      if (!kid || !kid.name) return kid;
      if (kid.photo_url) return kid;

      const fullSlug = slugify(kid.name);
      const firstSlug = slugify(String(kid.name).split(/\s+/)[0]);

      // Match against blob path. Try full-name slug first (most
      // specific), then first-name slug. The path looks like
      // `profiles/<famSlug>/<personSlug>-<timestamp>.<ext>`.
      const tryMatch = (slug) => {
        if (!slug) return null;
        return blobs.find(b => {
          const path = b.pathname || b.url || '';
          // Match `/<slug>-` so "aiden" doesn't accidentally match "aidenbogan".
          return path.indexOf(`/${slug}-`) !== -1;
        });
      };
      const hit = tryMatch(fullSlug) || tryMatch(firstSlug);
      if (!hit) return kid;

      console.log(`  + ${row.family_email} | ${kid.name} → ${hit.url}`);
      restored++;
      dirty = true;
      return Object.assign({}, kid, { photo_url: hit.url });
    });

    if (dirty && !DRY) {
      await sql`
        UPDATE member_profiles
        SET kids = ${JSON.stringify(updatedKids)}::jsonb,
            updated_at = NOW(),
            updated_by = 'recover-kid-photos'
        WHERE family_email = ${row.family_email}
      `;
    }
  }

  console.log(`\nDone. ${DRY ? '(dry run) ' : ''}scanned=${scanned} restored=${restored} errored=${errored}`);
})().catch(err => { console.error(err); process.exit(1); });
