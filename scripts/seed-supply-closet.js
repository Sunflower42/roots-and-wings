// Seed the supply_closet table from the permanent inventory spreadsheet.
// Idempotent: wipes existing rows and re-inserts.
// Run with: node --env-file=.env.local scripts/seed-supply-closet.js

const { neon } = require('@neondatabase/serverless');

// Source: C:\Users\erinb\Downloads\Supplies Inventory - Permanent Supply Closet Inventory.csv
// Reshaped into a flat array. Each item: { name, location, category }.
// Category values match the CHECK constraint in migrate.sql.

const ITEMS = [
  // ── Permanent (always available) ──
  ['Scissors', 'Downstairs & Upstairs', 'permanent'],
  ['Tape: masking', 'Downstairs', 'permanent'],
  ['Tape: clear', 'Down-right', 'permanent'],
  ['Masking tape / painters tape', 'Down-right', 'permanent'],
  ['Glue, glue sticks', 'Down-right', 'permanent'],
  ['Extra wipes', 'Down-right', 'permanent'],
  ['Sponges and Magic Erasers', 'Down-right', 'permanent'],
  ['Latex gloves', 'Down-right', 'permanent'],
  ['Hand sanitizer', 'Down-right', 'permanent'],
  ['Dish soap', 'Downstairs', 'permanent'],
  ['Sidewalk chalk', 'Outside', 'permanent'],
  ['Paint supplies: brushes, pallets, cups', 'Down-left', 'permanent'],
  ['Acrylic paint', 'Down-left', 'permanent'],
  ['Watercolor paint', 'Down-left', 'permanent'],
  ['Chalk Pastels', 'Down-right', 'permanent'],
  ['Oil Pastels', 'Down-right', 'permanent'],
  ['Printer paper', 'MP', 'permanent'],
  ['Miscellaneous paper', 'Downstairs', 'permanent'],
  ['Sharpies', 'Downstairs', 'permanent'],
  ['Safety glasses', 'Upstairs', 'permanent'],
  ['Safety goggles', 'Upstairs', 'permanent'],
  ['Parachute', 'Outside', 'permanent'],
  ['Dry erase markers', 'Upstairs', 'permanent'],
  ['Dry erase boards', 'Upstairs', 'permanent'],
  ['Megaphone', 'Downstairs', 'permanent'],
  ['First aid kit', 'Downstairs', 'permanent'],
  ['Sports cones', 'Outside', 'permanent'],
  ['1 large folding table — rectangle, seats 6-8', 'Upstairs storage', 'permanent'],
  ['2 small folding tables — square, seats 2', 'Upstairs storage', 'permanent'],
  ['2 medium folding tables — rectangle, seats 4', 'Upstairs storage', 'permanent'],
  ['Clipboards', 'MP', 'permanent'],
  ['Staplers & staples', 'MP', 'permanent'],
  ['Paper clips', 'MP', 'permanent'],
  ['Rubber bands', 'MP', 'permanent'],
  ['Index cards', 'MP', 'permanent'],
  ['3-hole punch', 'MP', 'permanent'],
  ['Electric griddle', 'Upstairs', 'permanent'],
  ['Cutting boards and safety knives', 'Kitchen', 'permanent'],
  ['Misc non-perishable pantry foods', 'Kitchen', 'permanent'],
  ['Drop cloths', 'Trust cabinet', 'permanent'],
  ['Gallon bags', 'Kitchen', 'permanent'],
  ['Quart bags', 'Kitchen', 'permanent'],

  // ── Currently available (may not always be stocked) ──
  ['Washi tape', 'Down-right', 'currently_available'],
  ['White pens', 'Downstairs', 'currently_available'],
  ['Pencils (extra)', 'Down-right', 'currently_available'],
  ['Erasers (extra)', 'Down-right', 'currently_available'],
  ['Crayons (extra)', 'Down-right', 'currently_available'],
  ['Sharpies (extra)', 'Upstairs', 'currently_available'],
  ['Hole punches', 'MP', 'currently_available'],
  ['Contact paper: clear', 'Upstairs', 'currently_available'],
  ['Brown craft paper rolls', '', 'currently_available'],
  ['Misc craft supplies', 'Down-right', 'currently_available'],
  ['Clothes pins', 'Upstairs', 'currently_available'],
  ['Rocks & stones', 'Upstairs', 'currently_available'],
  ['Bandanas & cloth', 'Upstairs', 'currently_available'],
  ['Small toy trucks, baby toys', 'Upstairs', 'currently_available'],
  ['Clipboards', 'MP', 'currently_available'],
  ['Raffia & twine', 'Down-right', 'currently_available'],
  ['Yarn (small amounts)', 'Upstairs', 'currently_available'],
  ['Pipe cleaners', 'Down-right', 'currently_available'],
  ['Tools (misc)', 'Upstairs', 'currently_available'],
  ['Sandpaper', 'Upstairs', 'currently_available'],
  ['X-Acto knives', 'Upstairs', 'currently_available'],
  ['Measuring tapes', 'Upstairs', 'currently_available'],
  ['Pulley parts', 'Upstairs', 'currently_available'],
  ['pH strips', 'Upstairs', 'currently_available'],
  ['Coffee filters: white & brown', 'Down in Misc. bucket', 'currently_available'],
  ['Popsicle sticks', 'Down in Misc. bucket', 'currently_available'],
  ['Paper products: cups, plates, bowls, napkins', 'Kitchen and Upstairs', 'currently_available'],
  ['Woodland creature footprints', '', 'currently_available'],
  ['Bean bag toss bags', 'Outside', 'currently_available'],
  ['White roll of paper', '', 'currently_available'],
  ['Mini magnifying glasses', 'Upstairs', 'currently_available'],
  ['Play/sensory sand', 'Jessica Shewan', 'currently_available'],
  ['Rolls of raffle tickets', 'Downstairs', 'currently_available'],
  ['Hula hoops', 'Outside behind cabinet', 'currently_available'],
  ['Straws', 'Downstairs - Misc', 'currently_available'],

  // ── Classroom cabinet (each AM classroom) ──
  ['Pencils', '', 'classroom_cabinet'],
  ['Markers', '', 'classroom_cabinet'],
  ['Erasers', '', 'classroom_cabinet'],
  ['Pencil sharpener', '', 'classroom_cabinet'],
  ['Scissors', '', 'classroom_cabinet'],
  ['Glue & glue sticks', '', 'classroom_cabinet'],
  ['Misc paper', '', 'classroom_cabinet'],
  ['Scotch / clear tape', '', 'classroom_cabinet'],
  ['Rulers (1-2)', '', 'classroom_cabinet'],
  ['Color pencils', '', 'classroom_cabinet'],
  ['Crayons', '', 'classroom_cabinet'],
  ['Hand sanitizer wipes', '', 'classroom_cabinet'],
  ['Disinfectant', '', 'classroom_cabinet'],

  // ── Game closet (shared with the church) ──
  ['Memory', 'Goodness', 'game_closet'],
  ['Apples to Apples', 'Goodness', 'game_closet'],
  ['Sorry', 'Goodness', 'game_closet'],
  ['Sliders', 'Goodness', 'game_closet'],
  ['Taboo', 'Goodness', 'game_closet'],
  ['Chutes and Ladders', 'Goodness', 'game_closet'],
  ['Legos', 'Goodness', 'game_closet'],
  ['Upwords', 'Goodness', 'game_closet'],
  ['Boggle', 'Goodness', 'game_closet'],
  ['Building blocks', 'Goodness', 'game_closet'],
  ['Qwirkle', 'Goodness', 'game_closet'],
  ['Qwirkle Cubes', 'Goodness', 'game_closet'],
  ['Cards', 'Goodness', 'game_closet'],
  ['Monopoly', 'Goodness', 'game_closet'],
  ['Monopoly Jr.', 'Goodness', 'game_closet'],
  ['Free 4 All', 'Goodness', 'game_closet'],
  ['Checkers', 'Goodness', 'game_closet'],
  ['Scrabble', 'Goodness', 'game_closet'],
  ['Trivial Pursuit', 'Goodness', 'game_closet'],
  ['Connect Four', 'Goodness', 'game_closet'],
  ['Cadoo', 'Goodness', 'game_closet'],
  ['Cranium', 'Goodness', 'game_closet'],
  ['Uno', 'Goodness', 'game_closet'],
  ['Hello Kitty Dominoes', 'Goodness', 'game_closet'],
  ['Snap Circuits (green)', 'Goodness', 'game_closet'],
  ['Worst Case Scenario Survival', 'Goodness', 'game_closet'],
  ['Sleeping Queens', 'Goodness', 'game_closet'],
  ['Spot It', 'Goodness', 'game_closet'],
  ['D&D Essentials Kit', 'Goodness', 'game_closet']
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set. Run with: node --env-file=.env.local scripts/seed-supply-closet.js');
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);

  console.log(`Wiping supply_closet and seeding ${ITEMS.length} items...`);

  await sql`TRUNCATE supply_closet RESTART IDENTITY CASCADE`;

  // Insert in a single statement for speed
  for (let i = 0; i < ITEMS.length; i++) {
    const [name, location, category] = ITEMS[i];
    await sql`
      INSERT INTO supply_closet (item_name, location, category, sort_order, updated_by)
      VALUES (${name}, ${location}, ${category}, ${i}, 'seed')
    `;
  }

  const counts = await sql`
    SELECT category, COUNT(*)::int AS n
    FROM supply_closet
    GROUP BY category
    ORDER BY category
  `;

  console.log('Done. Counts by category:');
  counts.forEach(r => console.log(`  ${r.category}: ${r.n}`));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
