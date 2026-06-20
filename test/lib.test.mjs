// Pure-logic tests — run in plain Node (no DOM). `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseQty, fmtQty, scaleDisplay, classify, normalizeIngredient, buildShoppingList, formatShoppingList, isOptional,
  clampServes, bucketMatch, recipeMatches, cuisineChipValues, shopSectionsForRecipe, inlineMd, esc,
  parseHash, hashForKind,
} from '../docs/lib.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(root, 'docs/recipes.json'), 'utf8'));

test('parseHash maps hashes to routes (recipe / tab / home)', () => {
  assert.deepEqual(parseHash('#/espresso-martini'), { type: 'recipe', slug: 'espresso-martini' });
  assert.deepEqual(parseHash('#/blackened%20steak'), { type: 'recipe', slug: 'blackened steak' });
  assert.deepEqual(parseHash('#drinks'), { type: 'tab', kind: 'drink' });
  assert.deepEqual(parseHash('#food'), { type: 'tab', kind: 'food' });
  // empty, bare, and unknown hashes all fall back to the default food section
  assert.deepEqual(parseHash(''), { type: 'home', kind: 'food' });
  assert.deepEqual(parseHash('#'), { type: 'home', kind: 'food' });
  assert.deepEqual(parseHash('#/'), { type: 'home', kind: 'food' });
  assert.deepEqual(parseHash('#nonsense'), { type: 'home', kind: 'food' });
});

test('hashForKind is the inverse for tabs', () => {
  assert.equal(hashForKind('drink'), '#drinks');
  assert.equal(hashForKind('food'), '#food');
  assert.equal(parseHash(hashForKind('drink')).kind, 'drink');
  assert.equal(parseHash(hashForKind('food')).kind, 'food');
});

test('parseQty handles ints, fractions, unicode, ranges, mixed', () => {
  assert.deepEqual(parseQty('1 lb sirloin steak'), { qty: 1, hi: null, rest: 'lb sirloin steak' });
  assert.deepEqual(parseQty('1½ tsp kosher salt'), { qty: 1.5, hi: null, rest: 'tsp kosher salt' });
  assert.deepEqual(parseQty('½ red onion, sliced'), { qty: 0.5, hi: null, rest: 'red onion, sliced' });
  assert.deepEqual(parseQty('2-3 cloves garlic'), { qty: 2, hi: 3, rest: 'cloves garlic' });
  assert.deepEqual(parseQty('1 1/2 cups rice'), { qty: 1.5, hi: null, rest: 'cups rice' });
  assert.deepEqual(parseQty('Salt and pepper to taste'), { qty: null, hi: null, rest: 'Salt and pepper to taste' });
});

test('parseQty never throws on non-string (defensive)', () => {
  assert.doesNotThrow(() => parseQty({ Optional: 'x' }));
  assert.doesNotThrow(() => parseQty(null));
  assert.equal(parseQty(5).qty, null);
});

test('fmtQty formats fractions', () => {
  for (const [n, s] of [[0.5, '½'], [1.5, '1½'], [1 / 3, '⅓'], [2, '2'], [0.25, '¼'], [0.125, '⅛'], [3, '3']]) {
    assert.equal(fmtQty(n), s, `fmtQty(${n})`);
  }
});

test('scaleDisplay scales the leading quantity only', () => {
  assert.equal(scaleDisplay(parseQty('1 lb sirloin steak'), 2), '2 lb sirloin steak');
  assert.equal(scaleDisplay(parseQty('½ red onion, sliced'), 2), '1 red onion, sliced');
  assert.equal(scaleDisplay(parseQty('4 cups greens'), 0.5), '2 cups greens');
  assert.equal(scaleDisplay(parseQty('Salt to taste'), 3), 'Salt to taste');
});

test('clampServes', () => {
  assert.equal(clampServes('2'), 2);
  assert.equal(clampServes(''), null);
  assert.equal(clampServes('0'), 1);
  assert.equal(clampServes('99'), 50);
  assert.equal(clampServes('abc'), null);
});

test('classify: core / pantry / buy', () => {
  const core = ['1½ tsp kosher salt', '¼ cup olive oil', '1 cup brown sugar', '2 tbsp butter', '1 cup water', '½ cup flour'];
  const pantry = ['1 tsp smoked paprika', '½ tsp cayenne pepper', '1 tsp cinnamon', '1 tsp red pepper flakes',
    '2 tbsp soy sauce', '2 tbsp balsamic vinegar', '1 tbsp honey', '1 tsp Dijon mustard', '1 tsp vanilla extract',
    '1 tsp dried oregano', '1 tsp baking powder'];
  const buy = ['2 cloves garlic, minced', '1 green bell pepper', '2 salmon fillets', '1 tbsp white miso',
    '2 tbsp tahini', '1 tbsp fish sauce', '2 tbsp fresh basil', '1 lemon', '4 cups mixed baby greens'];
  for (const s of core) assert.equal(classify(s), 'core', s);
  for (const s of pantry) assert.equal(classify(s), 'pantry', s);
  for (const s of buy) assert.equal(classify(s), 'buy', s);
});

test('normalizeIngredient strips prep words and keeps the buy-name', () => {
  const d = (s) => normalizeIngredient(s).display;
  assert.equal(d('small red onion, very thinly sliced'), 'red onion');           // #1
  assert.equal(d('cup Kalamata olives, pitted and halved'), 'kalamata olive');   // #2
  assert.equal(d('large head broccoli, cut into bite-size florets'), 'broccoli'); // #3
  assert.equal(d('ears corn, husked'), 'corn');                                  // #8
  assert.equal(d('feta cheese'), 'feta cheese');     // display keeps "cheese"…
  assert.equal(normalizeIngredient('feta cheese').key, normalizeIngredient('crumbled feta').key); // …but merges with "feta"
  assert.equal(d('crumbled blue cheese'), 'blue cheese'); // never collapses to "blue"
  assert.equal(d('skin-on salmon fillets'), 'salmon');
});

const lines = (a) => buildShoppingList(a).lines;

test('merge: same ingredient prepared differently becomes one clean line', () => {
  assert.deepEqual(lines([{ qty: 0.25, rest: 'small red onion, very thinly sliced' }]), ['¼ red onion']);          // #1
  assert.deepEqual(lines([{ qty: 0.25, rest: 'cup Kalamata olives, pitted and halved' }]), ['¼ cup kalamata olive']); // #2
  assert.deepEqual(lines([{ qty: 1, rest: 'large head broccoli, cut into bite-size florets' }]), ['1 head broccoli']); // #3
  assert.deepEqual(lines([{ qty: 2, rest: 'ears corn, husked' }]), ['2 ears corn']);                              // #8
  assert.deepEqual(lines([{ qty: 1, rest: 'cup cherry or grape tomatoes' }, { qty: 2, rest: 'cups cherry tomatoes' }]), ['3 cup cherry tomato']); // #7
  assert.deepEqual(lines([{ qty: 1, rest: 'cup feta' }, { qty: 1, rest: 'cup feta cheese' }]), ['2 cup feta']);
  assert.deepEqual(lines([{ qty: 2, rest: 'salmon fillets (6 oz each)' }, { qty: 1, rest: 'skin-on salmon filet' }]), ['3 salmon']);
});

test('yield rules: garlic bulbs, lemon count, herb bunches', () => {
  assert.deepEqual(lines([{ qty: 3, rest: 'cloves garlic, smashed' }, { qty: 6, rest: 'cloves garlic' }]),
    ['1 bulb garlic (≈9 cloves)']);                                                                               // #6
  assert.deepEqual(lines([{ qty: null, rest: 'zest of 2 lemons' }, { qty: null, rest: 'juice of 3 lemons' }, { qty: 1, rest: 'lemon, sliced' }]),
    ['4 lemons']);                                                                                                // #9
  assert.deepEqual(lines([{ qty: 2, rest: 'tbsp lemon juice' }, { qty: 1, rest: 'lemon, sliced' }]), ['2 lemons']);
  assert.deepEqual(lines([{ qty: 5, rest: 'sprigs thyme' }, { qty: 0.5, rest: 'tsp thyme' }]), ['1 bunch thyme']); // #10
});

test('drinks: bitters collapse to one bottle; ice/syrup/spirits classify sanely', () => {
  // every bitters variant (Angostura, aromatic, "a dash of bitters") merges to one line
  assert.deepEqual(lines([
    { qty: 2, rest: 'dashes Angostura bitters' },
    { qty: 1, rest: 'dash of bitters' },
    { qty: 2, rest: 'dashes aromatic bitters' },
  ]), ['bitters']);
  for (const s of ['1 cup ice', 'Crushed ice']) assert.equal(classify(s), 'core', s);
  for (const s of ['2 dashes Angostura bitters', '¾ oz simple syrup', '½ oz agave syrup', '⅓ oz grenadine']) {
    assert.equal(classify(s), 'pantry', s);
  }
  for (const s of ['2 oz white rum', '1 oz triple sec', 'vanilla ice cream']) assert.equal(classify(s), 'buy', s);
});

test('does NOT over-merge distinct items', () => {
  assert.equal(lines([{ qty: 1, rest: 'green bell pepper' }, { qty: 1, rest: 'red bell pepper' }]).length, 2);
  assert.equal(lines([{ qty: 1, rest: 'cup cherry tomatoes' }, { qty: 1, rest: 'cup grape tomatoes' }]).length, 2);
  assert.equal(lines([{ qty: 1, rest: 'baby spinach' }, { qty: 1, rest: 'spinach' }]).length, 2);   // "baby" kept distinct
  assert.equal(lines([{ qty: 1, rest: 'lime, juiced' }, { qty: 1, rest: 'lemon, juiced' }]).length, 2);
});

test('optional items get their own section; copy format toggles', () => {
  const res = buildShoppingList([
    { qty: 2, rest: 'cloves garlic' },
    { qty: null, rest: 'Optional: garlic powder, smoked paprika, or fresh rosemary/thyme sprigs' },
  ]);
  assert.deepEqual(res.optional, ['garlic powder, smoked paprika, or fresh rosemary/thyme sprigs']);  // #4
  assert.ok(isOptional('Optional: capers') && isOptional('1 tbsp capers (optional)'));
  const dash = formatShoppingList(res, 'dash');
  assert.ok(dash.startsWith('- 1 bulb garlic'));
  assert.ok(/\nOptional:\n- garlic powder/.test(dash));                                               // #4 section placement
  assert.ok(formatShoppingList(res, 'checkbox').includes('- [ ] 1 bulb garlic'));                     // #5 checklist format
});

test('filtering: bucketMatch + recipeMatches', () => {
  assert.equal(bucketMatch(25, { max: 30 }), true);
  assert.equal(bucketMatch(45, { min: 30, max: 45 }), true);
  assert.equal(bucketMatch(30, { min: 30, max: 45 }), false);
  const empty = { category: new Set(), protein: new Set(), course: new Set(), methods: new Set(), heat: new Set(), cuisine: new Set(), time: new Set() };
  const r = data.recipes[0];
  assert.equal(recipeMatches(r, { q: '', filters: empty, cuisineGroups: {}, timeBuckets: [] }), true);
  const f2 = { ...empty, protein: new Set([r.protein === 'beef' ? 'chicken' : 'beef']) };
  // a protein filter that excludes r
  const filt = { category: new Set(), protein: new Set(['__none__']), course: new Set(), methods: new Set(), heat: new Set(), cuisine: new Set(), time: new Set() };
  assert.equal(recipeMatches(r, { q: '', filters: filt, cuisineGroups: {}, timeBuckets: [] }), false);
});

test('Asian cuisine umbrella matches member cuisines', () => {
  const filters = { category: new Set(), protein: new Set(), course: new Set(), methods: new Set(), heat: new Set(), cuisine: new Set(['Asian']), time: new Set() };
  const ctx = { q: '', filters, cuisineGroups: data.cuisineGroups, timeBuckets: data.timeBuckets };
  const matched = data.recipes.filter((r) => recipeMatches(r, ctx)).map((r) => r.cuisine);
  assert.ok(matched.length > 1);
  assert.ok(matched.every((c) => data.cuisineGroups.Asian.includes(c)));
});

test('inlineMd italicizes and escapes', () => {
  assert.equal(inlineMd('a *b* c'), 'a <em>b</em> c');
  assert.equal(esc('<x>&"'), '&lt;x&gt;&amp;&quot;');
});

// ── DATA REGRESSION: every recipe must render shopping rows without throwing ──
test('every shipped recipe produces clean shopping rows (regression for the crash bug)', () => {
  for (const r of data.recipes) {
    assert.doesNotThrow(() => {
      const secs = shopSectionsForRecipe(r, 4);
      for (const sec of secs) for (const it of sec.items) {
        assert.equal(typeof it.display, 'string', `${r.slug} row display must be a string`);
        assert.ok(['core', 'pantry', 'buy'].includes(it.cat), `${r.slug} row cat valid`);
      }
    }, `${r.slug} should not throw in shopSectionsForRecipe`);
  }
});

test('every shipped ingredient/step/tip is a string (no YAML-map artifacts)', () => {
  for (const r of data.recipes) {
    for (const field of ['ingredients', 'steps']) {
      for (const sec of r[field]) for (const it of sec.items) {
        assert.equal(typeof it, 'string', `${r.slug} ${field} item must be a string, got ${JSON.stringify(it)}`);
      }
    }
    for (const t of r.tips || []) assert.equal(typeof t, 'string', `${r.slug} tip must be a string`);
  }
});
