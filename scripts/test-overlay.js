// Simulate what applyMemberProfileOverlay does to confirm kid photoUrl
// flows through. We pass in a synthetic "sheet parse" result for the Bogan
// family, run the overlay against the live DB, and print the result.
//
//   node --env-file=.env.local scripts/test-overlay.js

const { neon } = require('@neondatabase/serverless');

async function applyMemberProfileOverlay(families) {
  if (!Array.isArray(families) || families.length === 0) return;
  var sql = neon(process.env.DATABASE_URL);
  var rows = await sql`
    SELECT family_email, family_name, phone, address,
           parents, kids, placement_notes
    FROM member_profiles
  `;
  if (!rows || rows.length === 0) return;
  var byEmail = {};
  rows.forEach(function (r) {
    if (r.family_email) byEmail[String(r.family_email).toLowerCase()] = r;
  });

  families.forEach(function (fam) {
    var key = String(fam.email || '').toLowerCase();
    var p = byEmail[key];
    if (!p) return;

    if (p.phone) fam.phone = p.phone;
    if (p.address) fam.address = p.address;

    // Kids
    var kMap = {};
    (p.kids || []).forEach(function (k) {
      if (k && k.name) {
        var first = String(k.name).trim().split(/\s+/)[0].toLowerCase();
        kMap[first] = k;
      }
    });
    (fam.kids || []).forEach(function (kid) {
      var first = String(kid.name || '').trim().split(/\s+/)[0].toLowerCase();
      var ov = kMap[first];
      if (!ov) return;
      if (ov.pronouns) kid.pronouns = ov.pronouns;
      if (ov.allergies) kid.allergies = ov.allergies;
      if (ov.birth_date) kid.birthDate = ov.birth_date;
      if (ov.schedule) kid.schedule = ov.schedule;
      if (ov.photo_url) kid.photoUrl = ov.photo_url;
    });
  });
}

async function main() {
  // Fake sheet-parsed Bogan family (matching parseDirectory output shape)
  var families = [{
    name: 'Bogan',
    parents: 'Erin',
    parentPronouns: {},
    email: 'erinb@rootsandwingsindy.com',
    phone: '',
    kids: [
      { name: 'Violet', group: 'Saplings', schedule: 'all-day', pronouns: '', allergies: '' },
      { name: 'Junie', group: 'Sprouts', schedule: 'all-day', pronouns: '', allergies: '' }
    ]
  }];

  console.log('Before overlay:');
  console.log(JSON.stringify(families[0], null, 2));

  await applyMemberProfileOverlay(families);

  console.log('\nAfter overlay:');
  console.log(JSON.stringify(families[0], null, 2));

  console.log('\nKids photoUrl check:');
  families[0].kids.forEach(k => {
    console.log('  ', k.name, '→ photoUrl:', k.photoUrl ? 'SET (' + k.photoUrl.slice(0, 60) + '…)' : 'MISSING');
  });
}

main().catch(e => { console.error(e); process.exit(1); });
