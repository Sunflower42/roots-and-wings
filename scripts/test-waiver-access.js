// Regression test for waiver access from the Resources widget.
//
// The waiver is a legal document (Member Agreement, Photo/Video Consent,
// Data Storage, Liability Waiver). Members must always be able to load it
// from the portal Resources card.
//
// Bug shipped 2026-05-07: waiver.html was restructured (split sign card into
// #wv-sign-card-top + #wv-sign-card-bottom), but script.js's loadWaiverHtml()
// selector still excluded only #wv-sign-card. querySelector returned the first
// .wv-card — the hidden #wv-sign-card-top — and the modal rendered empty.
// Silent failure: the button "worked" but showed nothing.
//
// This test simulates loadWaiverHtml() statically:
//   1. Extract the selector string from script.js (so it stays in sync).
//   2. Parse waiver.html into its .wv-card blocks.
//   3. Apply the selector. Verify it matches exactly one card.
//   4. Verify the matched card is not display:none.
//   5. Verify the matched card contains all four legal sections.
//
// Usage: node scripts/test-waiver-access.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT_JS = path.join(ROOT, 'script.js');
const WAIVER_HTML = path.join(ROOT, 'waiver.html');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (err) { console.log('  ✗ ' + name + '\n      ' + err.message); failed++; }
}

console.log('\nwaiver access — Resources widget modal');

// ── Step 1: extract the selector loadWaiverHtml() uses ────────────────────
// We pull it from script.js so this test tracks the real selector. If the
// selector is renamed away from `.wv-card`, this extractor fails loudly —
// which is the right behavior; rename the test too, intentionally.
const scriptSrc = fs.readFileSync(SCRIPT_JS, 'utf8');
const selectorMatch = scriptSrc.match(
  /function\s+loadWaiverHtml[\s\S]*?doc\.querySelector\(\s*['"]([^'"]+)['"]\s*\)/
);
let selector = null;
t('loadWaiverHtml() selector is extractable from script.js', () => {
  assert(selectorMatch, 'could not find doc.querySelector(...) inside loadWaiverHtml()');
  selector = selectorMatch[1];
  assert(selector.startsWith('.wv-card'), 'expected selector to target .wv-card, got: ' + selector);
});

// ── Step 2: parse the .wv-card blocks out of waiver.html ──────────────────
// Lightweight regex parse — we own waiver.html and the cards are top-level
// siblings inside <main class="wv-container">. If someone nests cards, this
// parse will be wrong; rewrite the test rather than papering over.
const waiverHtml = fs.readFileSync(WAIVER_HTML, 'utf8');

function parseCards(html) {
  // Match every `<div class="wv-card" ...>` opening tag and pair it with its
  // matching </div> by counting depth. Keeps attributes + inner HTML.
  const cards = [];
  const openRe = /<div\s+class="wv-card"([^>]*)>/g;
  let m;
  while ((m = openRe.exec(html)) !== null) {
    const attrs = m[1];
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    const tagRe = /<\/?div\b[^>]*>/g;
    tagRe.lastIndex = start;
    let tm;
    while ((tm = tagRe.exec(html)) !== null) {
      if (tm[0].startsWith('</')) depth--;
      else depth++;
      if (depth === 0) { i = tm.index; break; }
    }
    const inner = html.slice(start, i);
    const idMatch = attrs.match(/\bid="([^"]+)"/);
    const styleMatch = attrs.match(/\bstyle="([^"]*)"/);
    cards.push({
      id: idMatch ? idMatch[1] : null,
      style: styleMatch ? styleMatch[1] : '',
      inner,
      attrs
    });
  }
  return cards;
}

const cards = parseCards(waiverHtml);

t('waiver.html has at least one .wv-card', () => {
  assert(cards.length >= 1, 'no .wv-card found in waiver.html');
});

// ── Step 3: apply the selector ─────────────────────────────────────────────
// Translate `.wv-card:not(#a):not(#b):not(...)` into a filter. We only
// support `:not(#id)` because that's what the real selector uses; if the
// selector grows other pseudo-classes, extend this — don't loosen the test.
function applySelector(sel, cards) {
  if (!sel.startsWith('.wv-card')) {
    throw new Error('selector does not start with .wv-card: ' + sel);
  }
  const rest = sel.slice('.wv-card'.length);
  const excluded = [];
  const notRe = /:not\(#([^)]+)\)/g;
  let nm;
  let consumed = 0;
  while ((nm = notRe.exec(rest)) !== null) {
    excluded.push(nm[1]);
    consumed = nm.index + nm[0].length;
  }
  if (consumed !== rest.length) {
    throw new Error('selector has unsupported tail: ' + rest.slice(consumed));
  }
  return cards.filter(c => !c.id || !excluded.includes(c.id));
}

let matched = null;
t('selector matches exactly one .wv-card in waiver.html', () => {
  const hits = applySelector(selector, cards);
  assert.strictEqual(
    hits.length, 1,
    'expected exactly 1 card, got ' + hits.length +
    ' (selector="' + selector + '", card ids=' +
    JSON.stringify(cards.map(c => c.id)) + ')'
  );
  matched = hits[0];
});

// ── Step 4: matched card is visible ────────────────────────────────────────
t('matched card is not display:none', () => {
  assert(matched, 'no matched card to check');
  const hidden = /display\s*:\s*none/i.test(matched.style);
  assert(!hidden,
    'matched card has inline display:none — modal would render empty (style="' +
    matched.style + '", id=' + matched.id + ')');
});

// ── Step 5: matched card contains all four legal sections ──────────────────
// These IDs are the table-of-contents anchors inside the agreement. If any
// of them disappears, the legal document is incomplete — fail loudly.
const REQUIRED_SECTION_IDS = ['membership', 'photo', 'data', 'liability'];
for (const sectionId of REQUIRED_SECTION_IDS) {
  t('matched card contains section id="' + sectionId + '"', () => {
    assert(matched, 'no matched card to check');
    const re = new RegExp('id="' + sectionId + '"');
    assert(re.test(matched.inner),
      'matched card does not contain a section with id="' + sectionId + '"');
  });
}

// ── Step 6: Resources widget still wires the waiver button ────────────────
// Defends the click path: the Resources card markup must include
// data-resource-action="waiver", and the delegated handler must route that
// to showWaiverModal. Either side going missing silently breaks access.
t('Resources widget renders a data-resource-action="waiver" button', () => {
  assert(
    /data-resource-action="waiver"/.test(scriptSrc),
    'no data-resource-action="waiver" button in script.js — Resources widget lost the waiver entry'
  );
});
t('click handler routes waiver action to showWaiverModal()', () => {
  assert(
    /action\s*===\s*['"]waiver['"]\s*\)\s*showWaiverModal\s*\(/.test(scriptSrc),
    'click handler no longer routes "waiver" action to showWaiverModal()'
  );
});

// ── Summary ───────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
