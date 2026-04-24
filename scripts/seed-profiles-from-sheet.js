// Seed member_profiles.kids and .parents with pronouns / allergies from the
// Google Directory sheet. We're flipping the source-of-truth for those fields
// from the sheet to the DB, so this one-time migration copies the current
// sheet values into member_profiles.
//
// Idempotent. Preserves any DB values a family has already self-edited in the
// portal — the member_profiles row always wins. Sheet values only fill gaps.
//
// Run with: node --env-file=.env.local scripts/seed-profiles-from-sheet.js
// Add --dry to preview without writing.

const { google } = require('googleapis');
const { neon } = require('@neondatabase/serverless');
const { parseDirectory, fetchSheet, getAuth } = require('../api/sheets.js');

const DRY_RUN = process.argv.includes('--dry');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set. Run with: node --env-file=.env.local scripts/seed-profiles-from-sheet.js');
    process.exit(1);
  }
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    console.error('GOOGLE_SERVICE_ACCOUNT_KEY not set.');
    process.exit(1);
  }
  if (!process.env.DIRECTORY_SHEET_ID) {
    console.error('DIRECTORY_SHEET_ID not set.');
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  console.log(DRY_RUN ? '── DRY RUN — no writes ──' : '── Seeding member_profiles from Directory sheet ──');

  const directoryTabs = await fetchSheet(sheets, process.env.DIRECTORY_SHEET_ID);
  const dirTab = directoryTabs['Directory'] || null;
  const classTab = directoryTabs['Classlist'] || null;
  const allergyTab = directoryTabs['Allergies'] || null;
  if (!dirTab) {
    console.error('Directory tab not found in sheet.');
    process.exit(1);
  }

  const { families } = parseDirectory(dirTab, classTab, allergyTab);
  console.log(`Parsed ${families.length} families from sheet.`);

  const existing = await sql`
    SELECT family_email, family_name, parents, kids, phone, address, placement_notes
    FROM member_profiles
  `;
  const existingByEmail = {};
  existing.forEach(r => { existingByEmail[String(r.family_email).toLowerCase()] = r; });

  let created = 0, updated = 0, unchanged = 0;

  for (const fam of families) {
    const key = String(fam.email || '').toLowerCase();
    if (!key) continue;
    const existingRow = existingByEmail[key];

    // Parents payload — first names only (matches sanitizeParent shape in tour.js).
    const parentFirstNames = String(fam.parents || '')
      .split(/\s*&\s*/).map(s => s.trim()).filter(Boolean);
    const existingParents = (existingRow && existingRow.parents) || [];
    const parentsByFirst = {};
    existingParents.forEach(p => {
      if (p && p.name) parentsByFirst[String(p.name).trim().split(/\s+/)[0].toLowerCase()] = p;
    });
    const mergedParents = parentFirstNames.map(n => {
      const existingP = parentsByFirst[n.toLowerCase()] || {};
      const sheetPronoun = (fam.parentPronouns && fam.parentPronouns[n]) || '';
      return {
        name: existingP.name || n,
        // DB wins for pronouns; sheet fills gaps.
        pronouns: existingP.pronouns || sheetPronoun || '',
        photo_url: existingP.photo_url || ''
      };
    });

    // Kids payload — match by first name, preserve DB edits, fill from sheet.
    const existingKids = (existingRow && existingRow.kids) || [];
    const kidsByFirst = {};
    existingKids.forEach(k => {
      if (k && k.name) kidsByFirst[String(k.name).trim().split(/\s+/)[0].toLowerCase()] = k;
    });
    const mergedKids = (fam.kids || []).map(sheetKid => {
      const first = String(sheetKid.name || '').trim().split(/\s+/)[0].toLowerCase();
      const dbKid = kidsByFirst[first] || {};
      return {
        name: dbKid.name || sheetKid.name || '',
        birth_date: dbKid.birth_date || '',
        pronouns: dbKid.pronouns || sheetKid.pronouns || '',
        allergies: dbKid.allergies || sheetKid.allergies || '',
        schedule: dbKid.schedule || sheetKid.schedule || 'all-day',
        photo_url: dbKid.photo_url || '',
        // Default: photos allowed. The seed never turns opt-out on — families
        // flip this in the registration form or the portal editor.
        photo_consent: dbKid.photo_consent !== false
      };
    });
    // Append any DB-only kids (edited into the portal but not in the sheet).
    existingKids.forEach(dbKid => {
      const first = String(dbKid.name || '').trim().split(/\s+/)[0].toLowerCase();
      if (!first) return;
      const alreadyIn = mergedKids.some(k => String(k.name).trim().split(/\s+/)[0].toLowerCase() === first);
      if (!alreadyIn) mergedKids.push({
        name: dbKid.name || '',
        birth_date: dbKid.birth_date || '',
        pronouns: dbKid.pronouns || '',
        allergies: dbKid.allergies || '',
        schedule: dbKid.schedule || 'all-day',
        photo_url: dbKid.photo_url || '',
        photo_consent: dbKid.photo_consent !== false
      });
    });

    const familyName = (existingRow && existingRow.family_name) || fam.name;
    const phone = (existingRow && existingRow.phone) || fam.phone || '';
    const address = (existingRow && existingRow.address) || '';
    const placementNotes = (existingRow && existingRow.placement_notes) || '';

    // Skip if nothing would change — avoid bumping updated_at needlessly.
    const nextJson = JSON.stringify({ parents: mergedParents, kids: mergedKids });
    const prevJson = existingRow
      ? JSON.stringify({ parents: existingRow.parents || [], kids: existingRow.kids || [] })
      : null;
    if (existingRow && nextJson === prevJson) {
      unchanged++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`WOULD ${existingRow ? 'UPDATE' : 'CREATE'} ${key} (${familyName}) — ${mergedKids.length} kids, ${mergedParents.length} parents`);
      mergedKids.forEach(k => {
        const pron = k.pronouns ? ` ${k.pronouns}` : '';
        const allergy = k.allergies ? ` [${k.allergies}]` : '';
        console.log(`    kid: ${k.name}${pron}${allergy}`);
      });
    } else {
      await sql`
        INSERT INTO member_profiles (
          family_email, family_name, phone, address, parents, kids,
          placement_notes, updated_by
        ) VALUES (
          ${key}, ${familyName}, ${phone}, ${address},
          ${JSON.stringify(mergedParents)}::jsonb, ${JSON.stringify(mergedKids)}::jsonb,
          ${placementNotes}, 'seed-profiles-from-sheet'
        )
        ON CONFLICT (family_email) DO UPDATE SET
          family_name = EXCLUDED.family_name,
          phone = EXCLUDED.phone,
          address = EXCLUDED.address,
          parents = EXCLUDED.parents,
          kids = EXCLUDED.kids,
          placement_notes = EXCLUDED.placement_notes,
          updated_at = NOW(),
          updated_by = EXCLUDED.updated_by
      `;
    }

    if (existingRow) updated++; else created++;
  }

  console.log('──────────────────');
  console.log(`Created:   ${created}`);
  console.log(`Updated:   ${updated}`);
  console.log(`Unchanged: ${unchanged}`);
  if (DRY_RUN) console.log('(dry run — no writes made)');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
