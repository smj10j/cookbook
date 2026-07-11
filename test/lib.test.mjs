// Pure-logic tests — run in plain Node (no DOM). `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseQty, fmtQty, scaleDisplay, classify, normalizeIngredient, buildShoppingList, formatShoppingList, isOptional,
  clampServes, bucketMatch, recipeMatches, cuisineChipValues, proteinChipValues, shopSectionsForRecipe, inlineMd, esc,
  parseHash, hashForKind, isIOSSafari,
  pctOfDV, nutritionRows, hasNutrition, nutritionPanelHtml, NUTRIENT_DISPLAY,
  EATING_PLANS, planTier, evaluatePlan, evaluatePlans, planReasons, nutrientFlags, buildPlanVerdicts,
  recipeVariants, applyVariantToSections, variantLabel, variantTitle, variantsConflict, combineVariants, planSetKey,
  swapMagnitude, swapIngredientName, resolveSwapCollisions,
} from '../docs/lib.js';
import {
  parseLine, normalizeName, buildIndex, matchName, toBaseUnits, lineNutrition, recipeNutrition, NUTRIENT_KEYS,
} from '../scripts/lib/nutrition.mjs';
import { validateRecipe, applyPlanSwaps } from '../scripts/lib/schema.mjs';

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

test('shopping list "plain" format has no bullets (one line per reminder/share item)', () => {
  const res = buildShoppingList([
    { qty: 2, rest: 'cloves garlic' },
    { qty: null, rest: 'Optional: fresh rosemary sprigs' },
  ]);
  const plain = formatShoppingList(res, 'plain');
  assert.equal(plain, '1 bulb garlic (≈2 cloves)\nfresh rosemary sprigs (optional)');
});

test('isIOSSafari detects iPhone/iPad UAs and touch-capable "MacIntel" (iPadOS), not desktop/other', () => {
  assert.equal(isIOSSafari({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15' }), true);
  assert.equal(isIOSSafari({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15' }), true);
  // iPadOS Safari reports platform 'MacIntel' but is touch-capable, unlike a real Mac.
  assert.equal(isIOSSafari({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 }), true);
  assert.equal(isIOSSafari({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15', platform: 'MacIntel', maxTouchPoints: 0 }), false);
  assert.equal(isIOSSafari({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }), false);
  assert.equal(isIOSSafari({ userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36' }), false);
  assert.equal(isIOSSafari(undefined), false);
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

test('Seafood protein umbrella matches both fish and shellfish', () => {
  const filters = { category: new Set(), protein: new Set(['Seafood']), course: new Set(), methods: new Set(), heat: new Set(), cuisine: new Set(), time: new Set() };
  const ctx = { q: '', filters, cuisineGroups: data.cuisineGroups, proteinGroups: data.proteinGroups, timeBuckets: data.timeBuckets };
  const matched = data.recipes.filter((r) => (r.kind || 'food') === 'food' && recipeMatches(r, ctx)).map((r) => r.protein);
  assert.ok(matched.length > 1, 'umbrella should match several recipes');
  // every match is a member protein, and BOTH member lanes are actually represented
  assert.ok(matched.every((p) => data.proteinGroups.Seafood.includes(p)));
  assert.ok(matched.includes('fish'), 'Seafood umbrella must include fish (salmon, cod, …)');
  assert.ok(matched.includes('seafood'), 'Seafood umbrella must include shellfish/mixed');
});

test('specific fish/seafood protein filters stay narrow under the umbrella', () => {
  const base = { category: new Set(), course: new Set(), methods: new Set(), heat: new Set(), cuisine: new Set(), time: new Set() };
  const ctx = (protein) => ({ q: '', filters: { ...base, protein: new Set([protein]) }, proteinGroups: data.proteinGroups, timeBuckets: data.timeBuckets });
  const fishOnly = data.recipes.filter((r) => recipeMatches(r, ctx('fish'))).map((r) => r.protein);
  assert.ok(fishOnly.length > 0 && fishOnly.every((p) => p === 'fish'), 'Fish chip = finfish only');
  const shellOnly = data.recipes.filter((r) => recipeMatches(r, ctx('seafood'))).map((r) => r.protein);
  assert.ok(shellOnly.length > 0 && shellOnly.every((p) => p === 'seafood'), 'Shellfish chip = shellfish only');
});

test('proteinChipValues lists the umbrella first, then present specifics in vocab order', () => {
  const recipes = [{ protein: 'chicken' }, { protein: 'fish' }, { protein: 'seafood' }, { protein: 'beef' }];
  const chips = proteinChipValues(recipes, data.vocab.protein, data.proteinGroups);
  assert.equal(chips[0], 'Seafood', 'umbrella leads');
  assert.deepEqual(chips, ['Seafood', 'beef', 'chicken', 'fish', 'seafood']);
  // umbrella is suppressed when no member protein is present
  const noSea = proteinChipValues([{ protein: 'beef' }, { protein: 'chicken' }], data.vocab.protein, data.proteinGroups);
  assert.ok(!noSea.includes('Seafood'));
});

test('inlineMd italicizes and escapes', () => {
  assert.equal(inlineMd('a *b* c'), 'a <em>b</em> c');
  assert.equal(esc('<x>&"'), '&lt;x&gt;&amp;&quot;');
});

// ── NUTRITION ENGINE (build-time): parse, match, convert, sum ────────────────
const NDB = {
  'olive oil': { unit: 'tsp', g: 4.5, n: { kcal: 40, protein: 0, carb: 0, fat: 4.5, satfat: 0.6, fiber: 0, sugar: 0, sodium: 0 }, aliases: ['extra-virgin olive oil'] },
  'granulated sugar': { unit: 'tsp', g: 4.2, n: { kcal: 16, protein: 0, carb: 4.2, fat: 0, satfat: 0, fiber: 0, sugar: 4.2, sodium: 0 }, aliases: ['sugar'] },
  'kosher salt': { unit: 'tsp', g: 6, n: { kcal: 0, protein: 0, carb: 0, fat: 0, satfat: 0, fiber: 0, sugar: 0, sodium: 1900 }, aliases: ['salt'] },
  'cherry tomato': { unit: 'tomato', g: 17, density: 0.67, n: { kcal: 3, protein: 0.15, carb: 0.65, fat: 0.03, satfat: 0.004, fiber: 0.2, sugar: 0.43, sodium: 1 }, aliases: ['grape tomato'] },
  salmon: { unit: 'fillet', g: 170, n: { kcal: 280, protein: 39, carb: 0, fat: 13, satfat: 3, fiber: 0, sugar: 0, sodium: 86 } },
  garlic: { unit: 'clove', g: 3, n: { kcal: 4, protein: 0.2, carb: 1, fat: 0, satfat: 0, fiber: 0.1, sugar: 0, sodium: 1 } },
  'white rum': { unit: 'oz', g: 28, n: { kcal: 65, protein: 0, carb: 0, fat: 0, satfat: 0, fiber: 0, sugar: 0, sodium: 0 } },
};
const NIDX = buildIndex(NDB);
const near = (a, b, eps = 0.05) => Math.abs(a - b) <= eps;

test('nutrition parseLine: quantity (midpoint of ranges), unit token, name', () => {
  assert.deepEqual(parseLine('1 tbsp olive oil'), { qty: 1, unit: 'tbsp', name: 'olive oil', rest: 'tbsp olive oil', each: null });
  assert.deepEqual(parseLine('1½ tsp kosher salt').qty, 1.5);
  assert.equal(parseLine('2–3 cloves garlic').qty, 2.5);              // range → midpoint
  assert.equal(parseLine('2 salmon fillets (about 6 oz each)').unit, '');  // count, not a unit
  assert.equal(parseLine('2 salmon fillets (about 6 oz each)').name, 'salmon fillets');
  assert.equal(parseLine('1 (14.5 oz) can whole peeled tomatoes').unit, 'can'); // paren size stripped
  assert.equal(parseLine('½ red onion, thinly sliced').name, 'red onion'); // prep clause dropped at comma
});

test('nutrition normalizeName strips accents/punctuation and singularises', () => {
  assert.equal(normalizeName('Jalapeños'), 'jalapeno');
  assert.equal(normalizeName('Extra-Virgin Olive Oil'), 'extra virgin olive oil'); // hyphens → spaces
  assert.equal(normalizeName('Cherry Tomatoes'), 'cherry tomato');
});

test('nutrition matchName: aliases, descriptor-peeling, trailing nouns', () => {
  assert.equal(matchName('extra-virgin olive oil', NDB, NIDX), 'olive oil');
  assert.equal(matchName('sugar', NDB, NIDX), 'granulated sugar');
  assert.equal(matchName('small red onion', NDB, NIDX), null);     // not in this mini-db
  assert.equal(matchName('skin-on salmon fillets', NDB, NIDX), 'salmon');
  assert.equal(matchName('grape tomatoes', NDB, NIDX), 'cherry tomato');
});

test('nutrition toBaseUnits converts every unit family into the base unit', () => {
  const oil = NDB['olive oil'];
  assert.ok(near(toBaseUnits(parseLine('1 tbsp olive oil'), oil), 3));        // 1 tbsp = 3 tsp
  assert.ok(near(toBaseUnits(parseLine('1 cup olive oil'), oil), 48, 0.1));   // 1 cup = 48 tsp
  // bare count against a piece base
  assert.equal(toBaseUnits(parseLine('2 salmon fillets'), NDB.salmon), 2);
  // mass against a piece base (1 lb / 170 g)
  assert.ok(near(toBaseUnits({ qty: 1, unit: 'lb' }, NDB.salmon), 453.592 / 170, 0.01));
  // volume against a piece base, via density (1 cup cherry tomatoes)
  assert.ok(near(toBaseUnits(parseLine('1 cup cherry tomatoes'), NDB['cherry tomato']), 236.588 * 0.67 / 17, 0.1));
  // fluid oz in a drink against an oz base
  assert.equal(toBaseUnits(parseLine('2 oz white rum'), NDB['white rum'], 'drink'), 2);
});

test('nutrition parseLine skips size descriptors before the unit; plural sibilants', () => {
  assert.equal(parseLine('1 heaping tsp kosher salt').unit, 'tsp');      // descriptor skipped
  assert.equal(parseLine('1 small pinch flaky sea salt').unit, 'pinch');
  assert.equal(parseLine('2 large cloves garlic').unit, 'clove');
  assert.equal(parseLine('2–3 dashes Angostura bitters').unit, 'dash');  // dashes → dash
});

test('nutrition: bare count of a WEIGHT-based item needs `each` (no silent over-count)', () => {
  // Olives stored per cup. "6 olives" must NOT be read as 6 cups (the bug that made
  // a salad read 9,000 mg sodium). Without `each` it's unresolved…
  const noEach = { unit: 'cup', g: 135, n: { kcal: 188, protein: 1.4, carb: 10, fat: 18, satfat: 2.4, fiber: 4.4, sugar: 0, sodium: 1556 } };
  assert.equal(toBaseUnits({ qty: 6, unit: '' }, noEach), null);
  // …with a per-piece weight it converts honestly (6 × 4 g ÷ 135 g/cup ≈ 0.18 cup).
  const withEach = { ...noEach, each: 4 };
  assert.ok(near(toBaseUnits({ qty: 6, unit: '' }, withEach), 6 * 4 / 135, 0.001));
  // Proteins stored per-oz, counted by piece, resolve via `each` (170 g ≈ 6 oz).
  const fish = { unit: 'oz', g: 28, each: 170, n: { kcal: 58, protein: 5.6, carb: 0, fat: 3.8, satfat: 0.8, fiber: 0, sugar: 0, sodium: 13 } };
  assert.ok(near(toBaseUnits({ qty: 2, unit: '' }, fish), 2 * 170 / 28, 0.01)); // 2 fillets ≈ 12 oz
});

test('nutrition lineNutrition: skips garnish/taste lines, flags unknowns', () => {
  assert.equal(lineNutrition('Salt and pepper, to taste', NDB, NIDX).status, 'skip');
  assert.equal(lineNutrition('Lime wheel, for garnish', NDB, NIDX).status, 'skip');
  assert.equal(lineNutrition('Ice', NDB, NIDX).status, 'skip');
  assert.equal(lineNutrition('2 cups dragonfruit foam', NDB, NIDX).status, 'unmatched'); // has qty, no match
  const ok = lineNutrition('1 tsp granulated sugar', NDB, NIDX);
  assert.equal(ok.status, 'ok');
  assert.ok(near(ok.nutrients.kcal, 16));
});

test('nutrition recipeNutrition: per-serving totals + coverage/confidence', () => {
  const recipe = {
    kind: 'food', serves: 2,
    ingredients: [{ section: null, items: [
      '2 tbsp olive oil',          // 6 tsp → 240 kcal, 27g fat
      '2 cloves garlic, minced',   // 2 cloves
      'Salt and pepper to taste',  // skipped
    ] }],
  };
  const nut = recipeNutrition(recipe, NDB, NIDX);
  assert.equal(nut.serves, 2);
  assert.equal(nut.considered, 2);          // taste line not counted
  assert.equal(nut.matched, 2);
  assert.equal(nut.confidence, 'high');
  assert.ok(near(nut.perServing.kcal, (240 + 8) / 2, 1));     // ((6*40)+(2*4))/2
  assert.ok(near(nut.perServing.fat, 27 / 2, 0.2));
  for (const k of NUTRIENT_KEYS) assert.equal(typeof nut.perServing[k], 'number');
});

test('nutrition recipeNutrition: low coverage downgrades confidence', () => {
  const recipe = { kind: 'food', serves: 1, ingredients: [{ section: null, items: [
    '1 tsp olive oil', '2 cups xantham mystery', '3 cups unobtainium', '4 oz phantom',
  ] }] };
  const nut = recipeNutrition(recipe, NDB, NIDX);
  assert.equal(nut.matched, 1);
  assert.equal(nut.considered, 4);
  assert.equal(nut.confidence, 'low');
  assert.ok(nut.unmatched.length >= 3);
});

// ── NUTRITION DISPLAY (front-end, pure) ──────────────────────────────────────
const sampleRecipe = (over = {}) => ({
  serves: 2,
  nutrition: { confidence: 'high', matched: 8, considered: 8, perServing: {
    kcal: 500, protein: 25, carb: 40, fat: 22, satfat: 6, fiber: 7, sugar: 9, sodium: 1150,
  } },
  ...over,
});

test('pctOfDV against FDA daily values', () => {
  assert.equal(pctOfDV('kcal', 1000), 50);
  assert.equal(pctOfDV('sodium', 2300), 100);
  assert.equal(pctOfDV('protein', 25), 50);
  assert.equal(pctOfDV('fat', 39), 50);
  assert.equal(pctOfDV('nonexistent', 5), null);
});

test('nutritionRows maps perServing to labelled rows with %DV', () => {
  const rows = nutritionRows(sampleRecipe());
  assert.equal(rows.length, NUTRIENT_DISPLAY.length);
  const cal = rows.find((r) => r.key === 'kcal');
  assert.equal(cal.amount, '500');
  assert.equal(cal.pct, 25);                       // 500/2000
  const sodium = rows.find((r) => r.key === 'sodium');
  assert.equal(sodium.amount, '1150mg');
  assert.equal(sodium.pct, 50);
  assert.ok(rows.find((r) => r.key === 'satfat').indent, 'sat fat nested');
  assert.deepEqual(nutritionRows({}), []);          // no nutrition → no rows
});

test('hasNutrition + nutritionPanelHtml render an always-expanded estimate', () => {
  assert.equal(hasNutrition(sampleRecipe()), true);
  assert.equal(hasNutrition({ nutrition: { confidence: 'none', perServing: {} } }), false);
  assert.equal(nutritionPanelHtml({}), '');         // nothing to show
  const html = nutritionPanelHtml(sampleRecipe());
  assert.match(html, /<section class="nutrition">/);
  assert.doesNotMatch(html, /<details|<summary/);   // no collapse affordance
  assert.match(html, /500 cal/);
  assert.match(html, /Sodium/);
  assert.match(html, /50%/);                         // a %DV figure rendered
  assert.match(html, /estimated, per serving/i);
});

test('nutritionPanelHtml adds a caveat when coverage is thin', () => {
  const html = nutritionPanelHtml(sampleRecipe({ nutrition: {
    confidence: 'partial', matched: 4, considered: 8,
    perServing: { kcal: 200, protein: 5, carb: 10, fat: 8, satfat: 2, fiber: 1, sugar: 3, sodium: 300 },
  } }));
  assert.match(html, /4 of 8 ingredients/);
  // A thin estimate biases every plan limit toward "fits" — never judge plans on it.
  assert.doesNotMatch(html, /plans-head|plan-row|plan-flag/);
});

// ── EATING-PLAN FIT (pure) ───────────────────────────────────────────────────
test('EATING_PLANS data sanity: 10 plans, unique ids/icons, real links, valid rules', () => {
  assert.equal(EATING_PLANS.length, 10);
  const keys = new Set(NUTRIENT_DISPLAY.map((d) => d.key));
  assert.equal(new Set(EATING_PLANS.map((p) => p.id)).size, EATING_PLANS.length, 'ids unique');
  assert.equal(new Set(EATING_PLANS.map((p) => p.icon)).size, EATING_PLANS.length, 'icons unique');
  for (const p of EATING_PLANS) {
    assert.ok(p.name && p.focus && p.caveat && p.short, `${p.id} carries name/short/focus/caveat`);
    assert.match(p.url, /^https:\/\//, `${p.id} links to more information`);
    assert.ok(p.limits.length >= 1, `${p.id} has at least one limit`);
    for (const l of p.limits) {
      assert.ok(keys.has(l.key), `${p.id} limit ${l.key} is a tracked nutrient`);
      assert.ok(l.optimal <= l.ok, `${p.id} ${l.key}: optimal ≤ ok`);
    }
    for (const g of p.goals || []) assert.ok(keys.has(g.key), `${p.id} goal ${g.key} is tracked`);
  }
});

test('planTier: the three tiers, inclusive at each boundary', () => {
  const rule = { optimal: 140, ok: 300 };            // the MIND-sodium worked example
  assert.equal(planTier(120, rule), 'optimal');      // meets the plan → no icon
  assert.equal(planTier(140, rule), 'optimal');
  assert.equal(planTier(200, rule), 'ok');           // fine, but not optimal
  assert.equal(planTier(300, rule), 'ok');
  assert.equal(planTier(301, rule), 'avoid');        // over the cap → red ring
  assert.equal(planTier(null, rule), 'optimal');     // absent nutrient can't offend
});

test('evaluatePlan: worst limit wins; an unmet goal only downgrades optimal → ok', () => {
  const plan = { id: 'x', name: 'X', icon: '🧪', url: 'https://example.com', focus: 't',
    limits: [{ key: 'sodium', optimal: 500, ok: 920 }], goals: [{ key: 'fiber', min: 10 }] };
  assert.equal(evaluatePlan({ sodium: 400, fiber: 12 }, plan).verdict, 'optimal');
  assert.equal(evaluatePlan({ sodium: 400, fiber: 2 }, plan).verdict, 'ok');       // goal miss
  assert.equal(evaluatePlan({ sodium: 700, fiber: 12 }, plan).verdict, 'ok');      // limit ok-tier
  assert.equal(evaluatePlan({ sodium: 1500, fiber: 12 }, plan).verdict, 'avoid');  // limit blown
  const short = evaluatePlan({ sodium: 400, fiber: 2 }, plan);
  assert.ok(planReasons(short).some((s) => /fiber: 2g is short of the 10g goal/.test(s)), 'unmet goal explained');
  assert.equal(evaluatePlan({ sodium: 400, fiber: 2 }, plan, { judgeGoals: false }).verdict, 'optimal',
    'goals are waived for dishes that are not a whole meal');
});

test('evaluatePlans judges the sample dinner sensibly (salty → poor DASH fit)', () => {
  const evals = evaluatePlans(sampleRecipe());       // sodium 1150, satfat 6, carb 40, kcal 500
  assert.equal(evals.length, EATING_PLANS.length);
  const by = (id) => evals.find((e) => e.plan.id === id);
  assert.equal(by('dash').verdict, 'avoid', '1150mg sodium blows the DASH per-meal cap');
  assert.equal(by('balance').verdict, 'optimal', '500 kcal + 25g protein is calorie-smart');
  assert.equal(by('lowsugar').verdict, 'ok', '9g sugars is over the ideal but under the cap');
  assert.equal(by('kidney').verdict, 'avoid', '25g protein exceeds the CKD per-meal share');
  assert.deepEqual(evaluatePlans({}), [], 'no nutrition → no verdicts');
  const reasons = planReasons(by('dash'));
  assert.ok(reasons.some((s) => /sodium: 1150mg is over this plan's 920mg-per-meal max/.test(s)), `max reason: ${reasons}`);
});

test('sides/desserts skip meal-building goals; boozy drinks cap at okay', () => {
  const salsa = sampleRecipe({ category: 'side', nutrition: { confidence: 'high', matched: 5, considered: 5,
    perServing: { kcal: 60, protein: 1, carb: 6, fat: 2, satfat: 0.3, fiber: 1, sugar: 3, sodium: 150 } } });
  const dash = evaluatePlans(salsa).find((e) => e.plan.id === 'dash');
  assert.equal(dash.verdict, 'optimal', 'a low-sodium salsa is not dinged for lacking fiber');
  const daiquiri = sampleRecipe({ kind: 'drink', base: 'rum', serves: 1,
    nutrition: { confidence: 'high', matched: 4, considered: 4,
      perServing: { kcal: 200, protein: 0, carb: 8, fat: 0, satfat: 0, fiber: 0, sugar: 7, sodium: 5 } } });
  const evals = evaluatePlans(daiquiri);
  assert.ok(evals.every((e) => e.verdict !== 'optimal'), 'no plan rates alcohol optimal');
  const balance = evals.find((e) => e.plan.id === 'balance');
  assert.equal(balance.verdict, 'ok');
  assert.ok(planReasons(balance).some((s) => /alcohol/.test(s)), 'the cap is explained');
  const mocktail = evaluatePlans({ ...daiquiri, base: 'non-alcoholic' });
  assert.ok(mocktail.some((e) => e.verdict === 'optimal'), 'zero-proof drinks can still rate great');
});

test('nutrientFlags groups breached limits by nutrient with tier + reason', () => {
  const flags = nutrientFlags(evaluatePlans(sampleRecipe()));
  const sodium = flags.sodium.map((f) => f.id);
  assert.ok(sodium.includes('dash') && sodium.includes('heart') && sodium.includes('kidney'));
  assert.ok(flags.sodium.every((f) => f.tier === 'avoid'), '1150mg is past every sodium cap');
  assert.ok(flags.satfat.every((f) => f.tier === 'ok'), '6g sat fat is ok-tier everywhere');
  assert.equal(flags.kcal, undefined, '500 kcal offends no plan — no icon at all');
  assert.match(flags.sodium[0].reason, /over its 920mg-per-meal max/);
});

// ── PLAN SWAPS (1B: structured swaps that flip a verdict) ────────────────────
const minimalFood = (over = {}) => ({
  title: 'T', slug: 't', tagline: 'x', pitch: 'x', serves: 2,
  times: { prep: 1, cook: 1, total: 2 }, difficulty: 'easy', heat: 'none',
  protein: 'fish', methods: ['stove'], cuisine: 'American', course: 'main',
  ingredients: [{ section: null, items: ['1 tbsp soy sauce', '1 lemon'] }],
  steps: [{ section: null, items: ['cook'] }],
  ...over,
});

test('planSwaps validation: unknown plan, missing line, and bad shape are build errors', () => {
  assert.deepEqual(validateRecipe(minimalFood(), 'f'), []);
  const good = minimalFood({ planSwaps: [{ for: ['kidney'], replace: '1 tbsp soy sauce', with: '1 tbsp low-sodium soy sauce' }] });
  assert.deepEqual(validateRecipe(good, 'f'), []);
  const badPlan = minimalFood({ planSwaps: [{ for: ['atkins'], replace: '1 tbsp soy sauce', with: 'x' }] });
  assert.ok(validateRecipe(badPlan, 'f').some((e) => /unknown plan "atkins"/.test(e)));
  const badLine = minimalFood({ planSwaps: [{ for: ['dash'], replace: '2 tbsp soy sauce', with: 'x' }] });
  assert.ok(validateRecipe(badLine, 'f').some((e) => /not found among ingredients/.test(e)), 'replace must match a real line');
  const badShape = minimalFood({ planSwaps: [{ replace: '1 tbsp soy sauce', with: 'y' }] });
  assert.ok(validateRecipe(badShape, 'f').some((e) => /non-empty "for"/.test(e)));
});

test('applyPlanSwaps substitutes exactly the named lines, without mutating input', () => {
  const secs = [{ section: 'A', items: ['1 tbsp soy sauce', '1 lemon'] }];
  const out = applyPlanSwaps(secs, [{ for: ['dash'], replace: '1 tbsp soy sauce', with: '1 tbsp low-sodium soy sauce' }]);
  assert.deepEqual(out[0].items, ['1 tbsp low-sodium soy sauce', '1 lemon']);
  assert.equal(secs[0].items[0], '1 tbsp soy sauce', 'input untouched');
});

test('a planSwaps variant lifts the verdict and renders in the fit table', () => {
  const per = { kcal: 500, protein: 25, carb: 40, fat: 22, satfat: 4, fiber: 7, sugar: 7, sodium: 1150 };
  const r = sampleRecipe({
    planSwaps: [{ for: ['dash'], replace: '3 tbsp soy sauce', with: '3 tbsp low-sodium soy sauce', note: 'low-sodium soy sauce' }],
    nutrition: { confidence: 'high', matched: 8, considered: 8, perServing: per,
      withSwaps: { '0': { ...per, sodium: 600 } } },   // key = entry-index set
  });
  const dash = evaluatePlans(r).find((e) => e.plan.id === 'dash');
  assert.equal(dash.verdict, 'avoid', 'as written, sodium blows the cap');
  assert.equal(dash.swapped.verdict, 'ok', 'the swap brings it under');
  assert.match(dash.swapText, /low-sodium soy sauce/);
  const html = nutritionPanelHtml(r);
  assert.match(html, /plan-swap/);
  assert.match(html, /with low-sodium soy sauce/);
  // A swap that does not improve the tier is not surfaced.
  const noGain = sampleRecipe({ nutrition: { confidence: 'high', matched: 8, considered: 8, perServing: per, withSwaps: { '0': per } } });
  assert.equal(evaluatePlans(noGain).find((e) => e.plan.id === 'dash').swapped, undefined);
});

// ── RECIPE VARIANTS (1C: the interactive planSwaps toggle) ───────────────────
const swapRecipe = () => sampleRecipe({
  slug: 'swap-test',
  ingredients: [{ section: 'Sauce', items: ['1½ cups orange juice', '1 lemon'] }],
  planSwaps: [
    { for: ['heart', 'lowsugar'], replace: '1½ cups orange juice', with: '¾ cup orange juice', note: 'half the OJ' },
    { for: ['kidney'], replace: '1 lemon', with: '½ lemon', note: 'half the lemon' },
  ],
  nutrition: { confidence: 'high', matched: 8, considered: 8,
    perServing: { kcal: 500, protein: 25, carb: 40, fat: 22, satfat: 3, fiber: 7, sugar: 16, sodium: 400 },
    withSwaps: {   // keyed by entry-index sets: entry 0 = heart+lowsugar, entry 1 = kidney
      '0': { kcal: 460, protein: 25, carb: 32, fat: 22, satfat: 3, fiber: 7, sugar: 8, sodium: 400 },
      '1': { kcal: 495, protein: 20, carb: 39, fat: 22, satfat: 3, fiber: 7, sugar: 15, sodium: 380 },
      '0.1': { kcal: 455, protein: 20, carb: 31, fat: 22, satfat: 3, fiber: 7, sugar: 7, sodium: 380 },
    } },
});

test('recipeVariants groups plans that share an identical swap set', () => {
  const vs = recipeVariants(swapRecipe());
  assert.equal(vs.length, 2, 'heart+lowsugar share a variant; kidney gets its own');
  const shared = vs.find((v) => v.plans.length === 2);
  assert.deepEqual(shared.plans.map((p) => p.id).sort(), ['heart', 'lowsugar']);
  assert.equal(shared.swaps.length, 1);
  assert.equal(shared.perServing.sugar, 8);
  assert.match(variantLabel(shared), /❤️/);
  assert.match(variantTitle(shared), /half the OJ/);
  assert.deepEqual(recipeVariants(sampleRecipe()), [], 'no swaps → no variants');
});

test('applyVariantToSections swaps exactly the named lines and marks them', () => {
  const r = swapRecipe();
  const v = recipeVariants(r).find((x) => x.plans.length === 2);
  const secs = applyVariantToSections(r.ingredients, v);
  assert.deepEqual(secs[0].items[0], { text: '¾ cup orange juice', swapped: true, original: '1½ cups orange juice' });
  assert.equal(secs[0].items[1].swapped, false, 'the kidney-only swap is not in this variant');
  const plain = applyVariantToSections(r.ingredients, null);
  assert.ok(plain[0].items.every((i) => !i.swapped));
});

test('a variant re-judges every plan against its numbers (no ⇄ hints inside)', () => {
  const r = swapRecipe();
  const v = recipeVariants(r).find((x) => x.plans.length === 2);
  const base = evaluatePlans(r).find((e) => e.plan.id === 'lowsugar');
  assert.equal(base.verdict, 'avoid');
  assert.ok(base.swapped, 'as-written view hints at the swap');
  const inVariant = evaluatePlans(r, EATING_PLANS, v.perServing).find((e) => e.plan.id === 'lowsugar');
  assert.equal(inVariant.verdict, 'optimal', '8g sugars fits the plan');
  assert.equal(inVariant.swapped, undefined, 'no hint once the variant is applied');
  const html = nutritionPanelHtml(r, { variant: v });
  assert.match(html, /460 cal/);
  assert.match(html, /nutrition-variant/);
  assert.doesNotMatch(html, /plan-swap/);
});

test('shopSectionsForRecipe shops for the active variant', () => {
  const r = swapRecipe();
  const v = recipeVariants(r).find((x) => x.plans.length === 2);
  const rows = shopSectionsForRecipe(r, 2, v)[0].items.map((i) => i.display);
  assert.ok(rows[0].includes('cup orange juice') && rows[0].startsWith('¾'), `swapped: ${rows[0]}`);
  const plain = shopSectionsForRecipe(r, 2)[0].items.map((i) => i.display);
  assert.ok(plain[0].startsWith('1½'), 'as-written without a variant');
});

test('variant chips combine additively; conflicting chips are detected', () => {
  const r = swapRecipe();
  const chips = recipeVariants(r);
  assert.equal(planSetKey(r.planSwaps, 'heart'), '0');
  assert.equal(planSetKey(r.planSwaps, 'kidney'), '1');
  const a = chips.find((c) => c.key === '0'), b = chips.find((c) => c.key === '1');
  assert.equal(variantsConflict(a, b), false, 'disjoint lines can combine');
  const combo = combineVariants(r, [b, a]);              // selection order is irrelevant
  assert.equal(combo.key, '0.1', 'the union set drives the lookup');
  assert.equal(combo.perServing.kcal, 455, 'combined nutrition is the precomputed union');
  assert.equal(combo.swaps.length, 2);
  assert.deepEqual(combo.plans.map((p) => p.id).sort(), ['heart', 'kidney', 'lowsugar']);
  assert.equal(combineVariants(r, [a]), a, 'a single chip is itself');
  // Two REDUCTIONS of the same ingredient are NOT a conflict — they fold to the
  // smaller portion (½ cup wins over ¾ cup), so both chips can be on at once.
  const reduce = { ...r, planSwaps: [
    { for: ['heart'], replace: '1½ cups orange juice', with: '¾ cup orange juice' },
    { for: ['kidney'], replace: '1½ cups orange juice', with: '½ cup orange juice' },
  ], nutrition: { ...r.nutrition, withSwaps: { '0': r.nutrition.withSwaps['0'], '1': r.nutrition.withSwaps['1'] } } };
  const rChips = recipeVariants(reduce);
  assert.equal(variantsConflict(rChips[0], rChips[1]), false, 'same-ingredient reductions combine');
  assert.deepEqual(resolveSwapCollisions(reduce.planSwaps).swaps.map((s) => s.with), ['½ cup orange juice'], 'folds to the smallest portion');
  // A true conflict: a SUBSTITUTION to a DIFFERENT ingredient on the same line.
  const clash = { ...r, planSwaps: [
    { for: ['heart'], replace: '1½ cups orange juice', with: '¾ cup orange juice' },
    { for: ['kidney'], replace: '1½ cups orange juice', with: '2 cups diced mango' },
  ], nutrition: { ...r.nutrition, withSwaps: { '0': r.nutrition.withSwaps['0'], '1': r.nutrition.withSwaps['1'] } } };
  const cChips = recipeVariants(clash);
  assert.equal(variantsConflict(cChips[0], cChips[1]), true, 'different ingredient on the same line → conflict');
  assert.equal(combineVariants(clash, cChips), null, 'no precomputed union for a conflict');
});

// ── per-piece "(N unit each)" size notes ─────────────────────────────────────
test('nutrition honors a "(N unit each)" note so a counted portion can be shrunk', () => {
  const salmon = { unit: 'oz', g: 28, each: 170, n: { kcal: 58, protein: 5.6, carb: 0, fat: 3.8, satfat: 0.8, fiber: 0, sugar: 0, sodium: 13 } };
  const p = parseLine('2 salmon fillets (about 5 oz each), skin-on');
  assert.equal(p.unit, '', 'the count is still the quantity, not a unit');
  assert.equal(p.name, 'salmon fillets', 'the note does not pollute the name');
  assert.deepEqual(p.each, { qty: 5, unit: 'oz' });
  assert.ok(near(toBaseUnits(p, salmon), 10, 0.01), '2 × 5 oz = 10 oz total');
  assert.ok(near(toBaseUnits(parseLine('2 fillets (5–6 oz each)'), salmon), 11, 0.01), 'a range averages');
  // no note → falls back to the DB per-piece weight (170 g ≈ 12 oz for two)
  assert.ok(near(toBaseUnits(parseLine('2 salmon fillets'), salmon), 2 * 170 / 28, 0.01));
  // "each" only fires on a bare count — a real unit token is untouched
  assert.equal(parseLine('2 tbsp capers').each, null);
});

// ── combining swaps that touch the same ingredient line ──────────────────────
test('swapMagnitude / swapIngredientName order reductions and spot substitutions', () => {
  assert.ok(swapMagnitude('¼ tsp kosher salt').value < swapMagnitude('½ tsp kosher salt').value);
  assert.equal(swapMagnitude('10 oz salmon fillets').dim, 'mass');
  // per-piece notes fold into a total before comparison
  assert.ok(swapMagnitude('2 salmon fillets (about 4 oz each)').value < swapMagnitude('2 salmon fillets (about 5 oz each)').value);
  assert.equal(swapIngredientName('6 oz dried red kidney beans, soaked overnight'), swapIngredientName('4 oz dried red kidney beans, soaked overnight'));
  assert.notEqual(swapIngredientName('¼ cup couscous'), swapIngredientName('1½ cups cauliflower rice'));
});

test('resolveSwapCollisions: reductions fold to the smallest; substitutions conflict', () => {
  const reduce = resolveSwapCollisions([
    { replace: 'B', with: '6 oz dried red kidney beans' },
    { replace: 'B', with: '4 oz dried red kidney beans' },
  ]);
  assert.equal(reduce.ok, true);
  assert.deepEqual(reduce.swaps.map((s) => s.with), ['4 oz dried red kidney beans'], 'smallest portion wins');
  // couscous → cauliflower rice is an either/or substitution, not a reduction
  assert.equal(resolveSwapCollisions([
    { replace: 'C', with: '¼ cup couscous' },
    { replace: 'C', with: '1½ cups cauliflower rice' },
  ]).ok, false);
  // zoodles vs less pasta (different dimensions) is also a real conflict
  assert.equal(resolveSwapCollisions([
    { replace: 'S', with: '3 oz thin spaghetti' },
    { replace: 'S', with: '2 medium zucchini, spiralized' },
  ]).ok, false);
  // disjoint lines never collide; identical entries dedupe cleanly
  assert.equal(resolveSwapCollisions([{ replace: 'A', with: 'x' }, { replace: 'B', with: 'y' }]).ok, true);
  assert.equal(resolveSwapCollisions([{ replace: 'A', with: 'x' }, { replace: 'A', with: 'x' }]).swaps.length, 1);
});

// DATA GATE: build.mjs (which precomputes withSwaps) and lib.js (which decides
// combinability) must agree — a combinable chip pair MUST have a precomputed
// union, and a conflicting pair must NOT, or a toggle strands or double-counts.
test('build precomputes exactly the combinable chip unions — no stranded toggles', () => {
  for (const r of data.recipes) {
    if (!r.planSwaps?.length) continue;
    const chips = recipeVariants(r);
    for (let i = 0; i < chips.length; i++) for (let j = i + 1; j < chips.length; j++) {
      const idx = [...new Set([...chips[i].swaps, ...chips[j].swaps].map((s) => r.planSwaps.indexOf(s)))].sort((a, b) => a - b).join('.');
      const combinable = !variantsConflict(chips[i], chips[j]);
      assert.equal(!!r.nutrition.withSwaps[idx], combinable, `${r.slug}: chips ${chips[i].key}+${chips[j].key} combinable=${combinable} but withSwaps[${idx}]=${!!r.nutrition.withSwaps[idx]}`);
    }
  }
});

test('same-ingredient reduction swaps combine in the cookbook (red-beans-and-rice)', () => {
  const r = data.recipes.find((x) => x.slug === 'red-beans-and-rice');
  assert.ok(r, 'red-beans-and-rice exists');
  const chips = recipeVariants(r);
  const kidney = chips.find((c) => c.plans.some((p) => p.id === 'kidney'));
  const balance = chips.find((c) => c.plans.some((p) => p.id === 'balance'));
  assert.ok(kidney && balance, 'both a kidney and a balance chip exist');
  assert.equal(variantsConflict(kidney, balance), false, 'both reduce the beans → combinable, not a conflict');
  const combo = combineVariants(r, [kidney, balance]);
  assert.ok(combo, 'the union nutrition is precomputed');
  const smaller = resolveSwapCollisions([...kidney.swaps, ...balance.swaps]).swaps.find((s) => /beans/.test(s.with)).with;
  const applied = applyVariantToSections(r.ingredients, combo).flatMap((s) => s.items).filter((i) => i.swapped).map((i) => i.text);
  assert.ok(applied.includes(smaller), `combined applies the smaller bean line "${smaller}" (${applied.join('; ')})`);
});

// DATA GATE: an authored swap that stops lifting its verdict is dead weight —
// fail the build so recipe edits can't silently strand planSwaps.
test('every authored planSwap genuinely lifts its declared plan verdicts', () => {
  let recipesWithSwaps = 0;
  for (const r of data.recipes) {
    if (!r.planSwaps?.length) continue;
    recipesWithSwaps++;
    const evals = evaluatePlans(r);
    for (const id of new Set(r.planSwaps.flatMap((s) => s.for))) {
      const e = evals.find((x) => x.plan.id === id);
      assert.ok(e?.swapped, `${r.slug}: the ${id} swap no longer improves the verdict (still ${e?.verdict})`);
    }
    assert.ok(recipeVariants(r).length >= 1, `${r.slug} exposes a toggleable variant`);
  }
  assert.ok(recipesWithSwaps >= 40, `the cookbook stays broadly tweakable (${recipesWithSwaps} recipes with swaps)`);
});

// ── GOOD-FOR FILTER (plan facet: AND semantics, ok/great modes) ─────────────
test('recipeMatches plan facet: AND across plans, great-only mode, needs verdicts', () => {
  const mk = (slug, per) => sampleRecipe({ slug, nutrition: { confidence: 'high', matched: 8, considered: 8, perServing: per } });
  const great = mk('fit-great', { kcal: 450, protein: 12, carb: 30, fat: 10, satfat: 2, fiber: 7, sugar: 5, sodium: 300 });
  const okay = mk('fit-okay', { kcal: 450, protein: 20, carb: 30, fat: 10, satfat: 2, fiber: 7, sugar: 5, sodium: 300 });
  const poor = mk('fit-poor', { kcal: 450, protein: 40, carb: 30, fat: 10, satfat: 2, fiber: 7, sugar: 5, sodium: 300 });
  const verdicts = buildPlanVerdicts([great, okay, poor]);
  const match = (r, plan) => recipeMatches(r, { q: '', filters: { plan }, planVerdicts: verdicts });
  const both = new Map([['kidney', 'ok'], ['heart', 'ok']]);
  assert.equal(match(great, both), true, '12g protein + 300mg sodium fits kidney AND heart');
  assert.equal(match(okay, both), true, '20g protein is kidney-okay');
  assert.equal(match(poor, both), false, '40g protein blows the kidney cap');
  const strict = new Map([['kidney', 'great'], ['heart', 'ok']]);
  assert.equal(match(great, strict), true);
  assert.equal(match(okay, strict), false, 'great-only mode drops merely-okay fits');
  assert.equal(recipeMatches(great, { q: '', filters: { plan: both } }), false, 'no verdicts context → no false positives');
  assert.equal(match(great, new Map()), true, 'empty plan filter matches everything');
});

test('nutritionPanelHtml renders the flag column and the eating-plan fit table', () => {
  const html = nutritionPanelHtml(sampleRecipe());
  assert.match(html, /Eating-plan fit/);
  assert.equal([...html.matchAll(/class="plan-row/g)].length, EATING_PLANS.length, 'one row per plan');
  assert.equal([...html.matchAll(/href="https:\/\//g)].length, EATING_PLANS.length, 'every plan links out');
  assert.match(html, /plan-flag is-avoid/);          // red-ringed icon on the sodium row
  assert.match(html, /plan-flag is-ok/);             // muted icon for merely-over-ideal
  assert.match(html, /✓ Great fit/);
  assert.match(html, /~ Okay/);
  assert.match(html, /✗ Poor fit/);
  assert.match(html, /not medical advice/);
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

test('every shipped recipe carries a per-serving nutrition estimate', () => {
  for (const r of data.recipes) {
    assert.ok(r.nutrition && r.nutrition.perServing, `${r.slug} has nutrition.perServing`);
    for (const k of NUTRIENT_KEYS) {
      const v = r.nutrition.perServing[k];
      assert.equal(typeof v, 'number', `${r.slug} ${k} is a number`);
      assert.ok(isFinite(v) && v >= 0, `${r.slug} ${k} is finite & non-negative (${v})`);
    }
    assert.ok(['high', 'partial', 'low', 'none'].includes(r.nutrition.confidence), `${r.slug} confidence valid`);
    // The panel must render without throwing for every shipped recipe.
    assert.doesNotThrow(() => nutritionPanelHtml(r), `${r.slug} nutrition panel renders`);
  }
});

test('every recipe has a real (non-empty) nutrition estimate — DB covers the menu', () => {
  for (const r of data.recipes) {
    // Calories should be a positive estimate for any real dish/drink (the DB covers it).
    assert.ok(r.nutrition.perServing.kcal > 0, `${r.slug} has a calorie estimate`);
    assert.notEqual(r.nutrition.confidence, 'none', `${r.slug} matched at least some ingredients`);
  }
});

test('protein-lane mains carry a realistic protein estimate (piece-count guard)', () => {
  const meat = new Set(['beef', 'chicken', 'fish', 'seafood', 'pork']);
  for (const r of data.recipes) {
    if (r.kind === 'drink' || !meat.has(r.protein) || (r.category && r.category !== 'main')) continue;
    // A meat/fish dinner should never read like a garnish — catches the "2 fillets
    // counted as 2 oz" regression, where protein collapsed to single digits.
    assert.ok(r.nutrition.perServing.protein >= 12,
      `${r.slug}: protein ${r.nutrition.perServing.protein}g too low for a ${r.protein} main`);
  }
});

test('no shipped recipe has an implausible sodium estimate (over-count guard)', () => {
  for (const r of data.recipes) {
    // Even the saltiest plate shouldn't clear ~4,000 mg/serving; a higher number
    // means a per-piece item was read as cups (the kalamata-olive regression).
    assert.ok(r.nutrition.perServing.sodium < 4000,
      `${r.slug}: sodium ${r.nutrition.perServing.sodium}mg/serving is implausibly high`);
  }
});

// The database itself: well-formed entries with physically-plausible numbers.
const nutritionDb = JSON.parse(readFileSync(join(root, 'data/nutrition.json'), 'utf8'));
test('nutrition database entries are well-formed and physically plausible', () => {
  for (const [key, e] of Object.entries(nutritionDb)) {
    assert.equal(typeof e.unit, 'string', `${key}: unit is a string`);
    assert.ok(typeof e.g === 'number' && e.g > 0, `${key}: g is a positive number`);
    assert.ok(e.n && typeof e.n === 'object', `${key}: has nutrient object`);
    for (const k of NUTRIENT_KEYS) {
      const v = e.n[k];
      assert.ok(typeof v === 'number' && isFinite(v) && v >= 0, `${key}.${k} is a non-negative number (${v})`);
    }
    // Calories can't materially undercut what protein+fat alone supply (carbs
    // ignored to stay robust to fiber; 15% slack absorbs rounding and real-data
    // variance), and can't exceed pure-fat density (~9 kcal/g). Catches the classic
    // per-100g data-entry slip and sign errors.
    const floor = 0.85 * (4 * e.n.protein + 9 * e.n.fat) - 3;
    assert.ok(e.n.kcal >= floor, `${key}: kcal ${e.n.kcal} below protein+fat floor ${floor.toFixed(1)}`);
    assert.ok(e.n.kcal <= 9 * e.g + 2, `${key}: kcal ${e.n.kcal} exceeds 9 kcal/g ceiling for ${e.g}g`);
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
