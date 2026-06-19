// Pure-logic tests — run in plain Node (no DOM). `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseQty, fmtQty, scaleDisplay, classify, analyze, aggregateShoppingLines,
  clampServes, bucketMatch, recipeMatches, cuisineChipValues, shopSectionsForRecipe, inlineMd, esc,
} from '../docs/lib.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(root, 'docs/recipes.json'), 'utf8'));

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

test('analyze produces a merge key that ignores units/prep/derived forms', () => {
  const k = (s) => analyze(s).key;
  assert.equal(k('small red onion'), k('red onion'));
  assert.equal(k('cloves garlic'), k('garlic cloves, minced'));
  assert.equal(k('feta'), k('feta cheese'));
  assert.equal(k('salmon filets'), k('skin-on salmon fillets'));
  assert.equal(k('fresh basil'), k('fresh basil sprigs, torn'));
  // lemon forms all collapse
  const lemon = k('1 lemon');
  for (const s of ['lemon slices', 'lemon wedges', 'zest of 1 lemon', 'juice of 1 lemon', 'fresh lemon juice']) {
    assert.equal(k(s), lemon, s);
  }
  // "A or B": merges with first option
  assert.equal(k('fresh dill or parsley'), k('fresh dill'));
  assert.notEqual(k('fresh dill or parsley'), k('fresh parsley'));
});

test('analyze does NOT over-merge distinct items', () => {
  const k = (s) => analyze(s).key;
  assert.notEqual(k('green bell pepper'), k('red bell pepper'));
  assert.notEqual(k('cherry tomatoes'), k('grape tomatoes'));
  assert.notEqual(k('sweet potato'), k('russet potato'));
  assert.notEqual(k('red pepper flakes'), k('red bell pepper'));
  assert.notEqual(k('baby spinach'), k('spinach'));    // "baby" kept distinct
  assert.notEqual(k('lime'), k('lemon'));
});

test('aggregateShoppingLines merges + sums', () => {
  assert.deepEqual(
    aggregateShoppingLines([{ qty: 7, rest: 'cloves garlic' }, { qty: 4, rest: 'garlic cloves, minced' }]),
    ['11 cloves garlic']);
  assert.deepEqual(
    aggregateShoppingLines([{ qty: 1, rest: 'red onion, sliced' }, { qty: 0.25, rest: 'small red onion' }]),
    ['1¼ red onion']);
  assert.deepEqual(
    aggregateShoppingLines([{ qty: 1, rest: 'cup baby spinach' }, { qty: 2, rest: 'oz baby spinach' }]),
    ['1 cup + 2 oz baby spinach']);
  // distinct items stay separate
  assert.equal(aggregateShoppingLines([{ qty: 1, rest: 'cup feta' }, { qty: 1, rest: 'cup feta cheese' }]).length, 1);
  assert.equal(aggregateShoppingLines([{ qty: 1, rest: 'green bell pepper' }, { qty: 1, rest: 'red bell pepper' }]).length, 2);
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
