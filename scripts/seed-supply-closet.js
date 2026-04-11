// Seed the supply_closet table from the permanent inventory spreadsheet.
// Idempotent: wipes existing rows and re-inserts.
// Run with: node --env-file=.env.local scripts/seed-supply-closet.js

const { neon } = require('@neondatabase/serverless');

// Source: C:\Users\erinb\Downloads\Supplies Inventory - Permanent Supply Closet Inventory (1).csv
// Updated: 2026-04-11
// Reshaped into a flat array. Each item: { name, location, category }.
// Category values match the CHECK constraint in migrate.sql.

const ITEMS = [
  // ── Permanent (always available) ──
  // Downstairs
  ['Scissors', 'Downstairs', 'permanent'],
  ['Tape: masking', 'Downstairs', 'permanent'],
  ['Tape: clear', 'Downstairs', 'permanent'],
  ['Masking tape/painters tape', 'Downstairs', 'permanent'],
  ['Glue', 'Downstairs', 'permanent'],
  ['Glue sticks', 'Downstairs', 'permanent'],
  ['Hot glue gun and sticks', 'Downstairs', 'permanent'],
  ['Markers', 'Downstairs', 'permanent'],
  ['Sharpies', 'Downstairs', 'permanent'],
  ['Miscellaneous paper', 'Downstairs', 'permanent'],
  ['Pencils', 'Downstairs', 'permanent'],
  ['Watercolor paint', 'Downstairs', 'permanent'],
  ['Chalk Pastels', 'Downstairs', 'permanent'],
  ['Acrylic paint', 'Downstairs', 'permanent'],
  ['Oil Pastels', 'Downstairs', 'permanent'],
  ['Paint supplies: brushes, pallets, cups', 'Downstairs', 'permanent'],
  ['Hole punch', 'Downstairs', 'permanent'],
  ['Sponges and Magic Erasers', 'Downstairs', 'permanent'],
  ['Dish soap', 'Downstairs', 'permanent'],
  ['Latex gloves', 'Downstairs', 'permanent'],
  ['Hand sanitizer', 'Downstairs', 'permanent'],
  ['First aid kit', 'Downstairs', 'permanent'],
  ['Megaphone', 'Downstairs', 'permanent'],
  ['Disinfectant wipes', 'Downstairs', 'permanent'],
  ['Rulers', 'Downstairs', 'permanent'],
  ['String', 'Downstairs', 'permanent'],
  ['Ear plugs', 'Downstairs', 'permanent'],
  ['Scissors: Card Board', 'Downstairs', 'permanent'],
  // Upstairs
  ['Dry erase markers', 'Upstairs', 'permanent'],
  ['Dry erase boards', 'Upstairs', 'permanent'],
  ['Safety glasses', 'Upstairs', 'permanent'],
  ['Electric griddle', 'Upstairs', 'permanent'],
  ['Drop cloths', 'Upstairs', 'permanent'],
  ['Safety goggles', 'Upstairs', 'permanent'],
  // Multipurpose Room
  ['Toner cartridge', 'Multipurpose Room', 'permanent'],
  ['3-hole punch', 'Multipurpose Room', 'permanent'],
  ['Index cards', 'Multipurpose Room', 'permanent'],
  ['Printer paper', 'Multipurpose Room', 'permanent'],
  ['Clipboards', 'Multipurpose Room', 'permanent'],
  ['Staplers & staples', 'Multipurpose Room', 'permanent'],
  ['Paper clips (so many!)', 'Multipurpose Room', 'permanent'],
  ['Rubber bands', 'Multipurpose Room', 'permanent'],
  // Kitchen
  ['Cutting boards and safety knives', 'Kitchen', 'permanent'],
  ['Gallon bags', 'Kitchen', 'permanent'],
  ['Quart bags', 'Kitchen', 'permanent'],
  // Upstairs Storage Room
  ['1 large folding table — rectangle, seats 6-8', 'Upstairs Storage Room', 'permanent'],
  ['2 small folding tables — square, seats 2', 'Upstairs Storage Room', 'permanent'],
  ['2 medium folding tables — rectangle, seats 4', 'Upstairs Storage Room', 'permanent'],
  // Outside
  ['Sidewalk chalk', 'Outside', 'permanent'],
  ['Parachute', 'Outside', 'permanent'],
  ['Sports cones', 'Outside', 'permanent'],

  // ── Currently available (may not always be stocked) ──
  // Downstairs
  ['Washi tape', 'Downstairs', 'currently_available'],
  ['White pens', 'Downstairs', 'currently_available'],
  ['Pencils (extra)', 'Downstairs', 'currently_available'],
  ['Erasers (extra)', 'Downstairs', 'currently_available'],
  ['Crayons (extra)', 'Downstairs', 'currently_available'],
  ['Popsicle sticks', 'Downstairs', 'currently_available'],
  ['Pipe cleaners', 'Downstairs', 'currently_available'],
  ['Googly eyes', 'Downstairs', 'currently_available'],
  ['Raffia & twine', 'Downstairs', 'currently_available'],
  ['Misc craft supplies', 'Downstairs', 'currently_available'],
  ['Straws', 'Downstairs', 'currently_available'],
  ['Feathers', 'Downstairs', 'currently_available'],
  ['Lemonade (6 quarts?)', 'Downstairs', 'currently_available'],
  ['Tissue paper squares', 'Downstairs', 'currently_available'],
  ['Dot markers', 'Downstairs', 'currently_available'],
  ['Fidget toys', 'Downstairs', 'currently_available'],
  ['Stickers', 'Downstairs', 'currently_available'],
  // Upstairs
  ['Rocks & stones', 'Upstairs', 'currently_available'],
  ['Bandanas & cloth', 'Upstairs', 'currently_available'],
  ['Small toy trucks, baby toys', 'Upstairs', 'currently_available'],
  ['Contact paper: clear', 'Upstairs', 'currently_available'],
  ['Tools (misc)', 'Upstairs', 'currently_available'],
  ['Yarn', 'Upstairs', 'currently_available'],
  ['Brown craft paper rolls', 'Upstairs', 'currently_available'],
  ['Crochet hooks', 'Upstairs', 'currently_available'],
  ['Sharpie (extra)', 'Upstairs', 'currently_available'],
  ['Sandpaper', 'Upstairs', 'currently_available'],
  ['Clothes pins', 'Upstairs', 'currently_available'],
  ['White roll of paper', 'Upstairs', 'currently_available'],
  ['XActo knives', 'Upstairs', 'currently_available'],
  ['Measuring tapes', 'Upstairs', 'currently_available'],
  ['Coffee filters: white & brown', 'Upstairs', 'currently_available'],
  ['Mini magnifying glasses', 'Upstairs', 'currently_available'],
  ['pH strips', 'Upstairs', 'currently_available'],
  ['Woodland creature footprints', 'Upstairs', 'currently_available'],
  ['Pulley parts', 'Upstairs', 'currently_available'],
  ['Magazines', 'Upstairs', 'currently_available'],
  ['Boom Box', 'Upstairs', 'currently_available'],
  ['Glue Dots', 'Upstairs', 'currently_available'],
  ['Embroidery Floss', 'Upstairs', 'currently_available'],
  ['Rolls of raffle tickets', 'Upstairs', 'currently_available'],
  ['Felt', 'Upstairs', 'currently_available'],
  ['Lab coats', 'Upstairs', 'currently_available'],
  ['Salt for experiments', 'Upstairs', 'currently_available'],
  ['Clothes pins', 'Upstairs', 'currently_available'],
  ['Clay', 'Upstairs', 'currently_available'],
  // Kitchen
  ['Paper products: cups, plates, bowls, napkins', 'Kitchen', 'currently_available'],
  ['Misc. non-perishable pantry foods', 'Kitchen', 'currently_available'],
  // Outside
  ['Bean bag toss bags', 'Outside', 'currently_available'],
  ['Sports cones', 'Outside', 'currently_available'],
  ['Hula hoops', 'Outside', 'currently_available'],
  ['Parachute', 'Outside', 'currently_available'],
  ['Balls', 'Outside', 'currently_available'],
  ['Sidewalk Chalk', 'Outside', 'currently_available'],
  // Supplies held by members
  ['Play/sensory sand', 'Supplies held by members — Jessica Shewan', 'currently_available'],

  // ── Classroom cabinet (each AM classroom) ──
  ['Color pencils', '', 'classroom_cabinet'],
  ['Pencils', '', 'classroom_cabinet'],
  ['Markers', '', 'classroom_cabinet'],
  ['Erasers', '', 'classroom_cabinet'],
  ['Pencil sharpener', '', 'classroom_cabinet'],
  ['Scissors', '', 'classroom_cabinet'],
  ['Glue & Glue sticks', '', 'classroom_cabinet'],
  ['Misc paper', '', 'classroom_cabinet'],
  ['Crayons', '', 'classroom_cabinet'],
  ['1-2 rulers', '', 'classroom_cabinet'],
  ['Scotch/clear tape', '', 'classroom_cabinet'],
  ['Disinfectant wipes', '', 'classroom_cabinet'],
  ['Hand sanitizer wipes', '', 'classroom_cabinet'],

  // ── Game closet (all stored in Goodness) ──
  ['Apples to Apples', 'Goodness', 'game_closet'],
  ['Bloom', 'Goodness', 'game_closet'],
  ['Boggle', 'Goodness', 'game_closet'],
  ['Building Blocks-Foam', 'Goodness', 'game_closet'],
  ['Cadoo', 'Goodness', 'game_closet'],
  ['Cards', 'Goodness', 'game_closet'],
  ['Checkers', 'Goodness', 'game_closet'],
  ['Chutes and Ladders', 'Goodness', 'game_closet'],
  ['Connect Four', 'Goodness', 'game_closet'],
  ['Cranium', 'Goodness', 'game_closet'],
  ['D&D Essentials Kit', 'Goodness', 'game_closet'],
  ['Free 4 All', 'Goodness', 'game_closet'],
  ['Hello Kitty Dominoes', 'Goodness', 'game_closet'],
  ['Legos', 'Goodness', 'game_closet'],
  ['Monopoly Jr.', 'Goodness', 'game_closet'],
  ['Monopoly', 'Goodness', 'game_closet'],
  ['Memory', 'Goodness', 'game_closet'],
  ['Quantumino', 'Goodness', 'game_closet'],
  ['Qwirkle', 'Goodness', 'game_closet'],
  ['Qwirkle Cubes', 'Goodness', 'game_closet'],
  ['Qwixx', 'Goodness', 'game_closet'],
  ['Rat-a-tat-tat Cat Card Game', 'Goodness', 'game_closet'],
  ['Scrabble', 'Goodness', 'game_closet'],
  ['Snap Circuits Green', 'Goodness', 'game_closet'],
  ['Sleeping Queens', 'Goodness', 'game_closet'],
  ['Sliders', 'Goodness', 'game_closet'],
  ['Sorry', 'Goodness', 'game_closet'],
  ['Spot It', 'Goodness', 'game_closet'],
  ['Taboo', 'Goodness', 'game_closet'],
  ['Taco Cat Goat Cheese Pizza', 'Goodness', 'game_closet'],
  ['Telestrations', 'Goodness', 'game_closet'],
  ['The Worst-Case-Scenario Survival', 'Goodness', 'game_closet'],
  ['Trivial Pursuit', 'Goodness', 'game_closet'],
  ['Trouble', 'Goodness', 'game_closet'],
  ['Uno', 'Goodness', 'game_closet'],
  ['Upwards', 'Goodness', 'game_closet'],
  ['USAopoly Blank Slate', 'Goodness', 'game_closet'],
];

const LOCATIONS = [
  'Downstairs',
  'Upstairs',
  'Multipurpose Room',
  'Kitchen',
  'Upstairs Storage Room',
  'Outside',
  'Goodness',
  'Supplies held by members',
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set. Run with: node --env-file=.env.local scripts/seed-supply-closet.js');
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);

  // Seed supply_locations
  console.log(`Seeding ${LOCATIONS.length} supply locations...`);
  await sql`TRUNCATE supply_locations RESTART IDENTITY CASCADE`;
  for (let i = 0; i < LOCATIONS.length; i++) {
    await sql`
      INSERT INTO supply_locations (name, sort_order)
      VALUES (${LOCATIONS[i]}, ${i})
    `;
  }

  // Seed supply_closet
  console.log(`Wiping supply_closet and seeding ${ITEMS.length} items...`);
  await sql`TRUNCATE supply_closet RESTART IDENTITY CASCADE`;

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
