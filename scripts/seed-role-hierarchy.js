// Seeds / updates the hierarchy + category on role_descriptions, and
// mirrors every cleaning_areas row into role_descriptions so the
// President's Roles widget can render one unified tree.
//
// Idempotent: keyed on role_key, safe to re-run. Only touches the new
// hierarchy columns; never overwrites overview / duties / playbook
// (those are managed in the app).
//
// Run with: node --env-file=.env.local scripts/seed-role-hierarchy.js

const { neon } = require('@neondatabase/serverless');

// Board roles that chair a committee — each is top-of-tree (no parent).
// Marked category='board'.
const BOARD_KEYS = [
  'president',
  'vice_president',
  'secretary',
  'treasurer',
  'sustaining_director',
  'membership_director',
  'communications_director'
];

// Maps each non-board role_key → parent role_key (a board chair).
// Source: the committee column on the seeded role_descriptions rows.
const PARENT_MAP = {
  // Facility Committee → President
  cleaning_crew_liaison: 'president',
  building_closer:       'president',
  opener:                'president',
  floater:               'president',
  safety_coordinator:    'president',

  // Programming Committee → Vice-President
  afternoon_class_liaison: 'vice_president',
  morning_class_liaison:   'vice_president',
  classroom_instructor:    'vice_president',
  classroom_assistant:     'vice_president',

  // Administrative Committee → Secretary
  admin_organization: 'secretary',
  archives:           'secretary',

  // Finance Committee → Treasurer
  field_trip_coordinator:  'treasurer',
  fundraising_coordinator: 'treasurer',
  supply_coordinator:      'treasurer',

  // Support Committee → Sustaining Director
  gratitude_encouragement: 'sustaining_director',
  parent_social_events:    'sustaining_director',
  special_events_liaison:  'sustaining_director',
  summer_social_events:    'sustaining_director',

  // Membership Committee → Membership Director
  welcome_coordinator:   'membership_director',
  public_communications: 'membership_director',

  // Communications Committee → Communications Director
  yearbook_coordinator: 'communications_director'
};

function cleaningAreaRoleKey(floorKey, areaName) {
  // role_key must be stable + unique. Lowercase + replace non-alphanum
  // with underscores so "Classrooms & MPR" → "classrooms_mpr".
  const slug = String(areaName)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return 'cleaning_area_' + String(floorKey).toLowerCase() + '_' + slug;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set. Run with: node --env-file=.env.local scripts/seed-role-hierarchy.js');
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);

  // 1. Mark board roles.
  console.log(`Marking ${BOARD_KEYS.length} board roles (category='board', parent=NULL)...`);
  for (const key of BOARD_KEYS) {
    const res = await sql`
      UPDATE role_descriptions
      SET category = 'board', parent_role_id = NULL
      WHERE role_key = ${key}
      RETURNING id, title
    `;
    if (res.length === 0) console.warn(`  ! missing: ${key}`);
    else console.log(`  ok: ${res[0].title}`);
  }

  // 2. Resolve board ids for use as parents.
  const boardRows = await sql`
    SELECT id, role_key FROM role_descriptions WHERE role_key = ANY(${BOARD_KEYS})
  `;
  const boardIdByKey = {};
  boardRows.forEach(r => { boardIdByKey[r.role_key] = r.id; });

  // 3. Assign parents + category for every committee role.
  console.log(`Assigning parents to ${Object.keys(PARENT_MAP).length} committee roles...`);
  for (const [childKey, parentKey] of Object.entries(PARENT_MAP)) {
    const parentId = boardIdByKey[parentKey];
    if (!parentId) {
      console.warn(`  ! parent missing for ${childKey} → ${parentKey}`);
      continue;
    }
    const res = await sql`
      UPDATE role_descriptions
      SET category = 'committee_role', parent_role_id = ${parentId}
      WHERE role_key = ${childKey}
      RETURNING id, title
    `;
    if (res.length === 0) console.warn(`  ! missing child: ${childKey}`);
    else console.log(`  ok: ${res[0].title} → ${parentKey}`);
  }

  // 4. Mirror cleaning_areas into role_descriptions.
  // Cleaning Crew Liaison is the parent for every mirrored area.
  const liaisonRow = await sql`SELECT id FROM role_descriptions WHERE role_key = 'cleaning_crew_liaison'`;
  if (liaisonRow.length === 0) {
    console.error('! cleaning_crew_liaison row missing — run seed-role-descriptions.js first.');
    process.exit(1);
  }
  const liaisonId = liaisonRow[0].id;

  const areas = await sql`
    SELECT id, floor_key, area_name, tasks, sort_order
    FROM cleaning_areas
    ORDER BY floor_key, sort_order, area_name
  `;
  console.log(`Mirroring ${areas.length} cleaning_areas rows into role_descriptions...`);

  for (const a of areas) {
    const roleKey = cleaningAreaRoleKey(a.floor_key, a.area_name);
    const title = a.area_name + (a.floor_key === 'floater' ? '' : ' (' + a.floor_key + ')');
    const overview =
      'Cleaning crew assignment under the Cleaning Crew Liaison. ' +
      'Rotating per-session responsibility — tasks listed below.';
    const duties = Array.isArray(a.tasks) ? a.tasks : [];
    await sql`
      INSERT INTO role_descriptions (
        role_key, title, job_length, overview, duties, committee,
        parent_role_id, category, display_order, status, updated_by
      ) VALUES (
        ${roleKey}, ${title}, '1 session', ${overview}, ${duties},
        'Facility Committee', ${liaisonId}, 'cleaning_area', ${a.sort_order || 0},
        'active', 'seed-role-hierarchy'
      )
      ON CONFLICT (role_key) DO UPDATE SET
        title = EXCLUDED.title,
        duties = EXCLUDED.duties,
        parent_role_id = EXCLUDED.parent_role_id,
        category = EXCLUDED.category,
        display_order = EXCLUDED.display_order,
        committee = EXCLUDED.committee,
        updated_at = NOW(),
        updated_by = 'seed-role-hierarchy'
    `;
    console.log(`  ok: ${title}`);
  }

  // 5. Quick summary.
  const counts = await sql`
    SELECT category, COUNT(*)::int AS n FROM role_descriptions GROUP BY category ORDER BY category
  `;
  console.log('\nRow counts by category:');
  counts.forEach(r => console.log(`  ${r.category}: ${r.n}`));

  const orphans = await sql`
    SELECT role_key, title FROM role_descriptions
    WHERE category = 'committee_role' AND parent_role_id IS NULL
  `;
  if (orphans.length) {
    console.log('\nCommittee roles with no parent (review these):');
    orphans.forEach(r => console.log(`  ${r.role_key} — ${r.title}`));
  } else {
    console.log('\nAll committee roles have a parent. ✓');
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
