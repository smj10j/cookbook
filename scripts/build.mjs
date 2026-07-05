#!/usr/bin/env node
// Compile recipes/*.md -> docs/recipes.json (the data the site loads).
// Also runs validation first and refuses to build if anything is malformed.

import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readAllRecipes } from './lib/parse.mjs';
import {
  validateRecipe, applyPlanSwaps, VOCAB, PROTEIN_META, METHOD_META, TIME_BUCKETS, CUISINE_GROUPS,
  BASE_META, FAMILY_META, STRENGTH_META,
} from './lib/schema.mjs';
import { recipeStubHtml, ogImageUrl } from './lib/stub.mjs';
import { loadDb, buildIndex, recipeNutrition } from './lib/nutrition.mjs';

// Absolute site URL, used for canonical + Open Graph image links in the share pages.
const SITE = (process.env.SITE_URL || 'https://smj10j.github.io/cookbook').replace(/\/+$/, '');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const recipesDir = join(root, 'recipes');
const drinksDir = join(root, 'drinks');
const outFile = join(root, 'docs', 'recipes.json');

// Food lives in recipes/, drinks in drinks/. Both compile into one feed (distinguished
// by `kind`); the site shows one or the other behind the Food/Drinks tabs.
const recipes = [...readAllRecipes(recipesDir), ...(existsSync(drinksDir) ? readAllRecipes(drinksDir) : [])];

// Auto-attach a photo if docs/images/<slug>.webp exists, so the photo pipeline
// never has to edit recipe frontmatter. An explicit `hero:` still wins.
for (const r of recipes) {
  if (!r.hero && existsSync(join(root, 'docs', 'images', `${r.slug}.webp`))) {
    r.hero = `images/${r.slug}.webp`;
  }
}

// Validate everything; abort the build on any error so bad data never ships.
const errors = [];
const slugs = new Set();
for (const r of recipes) {
  errors.push(...validateRecipe(r, r._file));
  if (slugs.has(r.slug)) errors.push(`${r._file}: duplicate slug "${r.slug}"`);
  slugs.add(r.slug);
}
if (errors.length) {
  console.error(`\n✗ Build failed — ${errors.length} problem(s):\n`);
  for (const e of errors) console.error('  ' + e);
  console.error('\nFix the recipe files above and re-run `npm run build`.\n');
  process.exit(1);
}

// Estimate per-serving nutrition for every recipe from the ingredient database
// (data/nutrition.json), baking it into the feed so the site renders without any
// runtime lookup. Unmatched ingredients are collected and reported (non-fatal) so
// the add-recipe/add-drink skills know what to add to the database next.
const nutritionDb = loadDb(join(root, 'data', 'nutrition.json'));
const nutritionIndex = buildIndex(nutritionDb);
const unmatchedAll = new Map(); // ingredient name -> count of recipes missing it
for (const r of recipes) {
  const nut = recipeNutrition(r, nutritionDb, nutritionIndex);
  r.nutrition = {
    perServing: nut.perServing,
    confidence: nut.confidence,
    matched: nut.matched,
    considered: nut.considered,
  };
  for (const name of nut.unmatched) unmatchedAll.set(name, (unmatchedAll.get(name) || 0) + 1);
  // Recipes with planSwaps also get a "with swaps" per-serving estimate per plan, so
  // the site can show "✗ as written → ~ with the swap" without recomputing nutrition
  // client-side. All swaps naming a plan apply together for that plan's variant.
  if (Array.isArray(r.planSwaps) && r.planSwaps.length) {
    const withSwaps = {};
    for (const id of new Set(r.planSwaps.flatMap((s) => s.for))) {
      const swaps = r.planSwaps.filter((s) => s.for.includes(id));
      const variant = { ...r, ingredients: applyPlanSwaps(r.ingredients, swaps) };
      const vn = recipeNutrition(variant, nutritionDb, nutritionIndex);
      withSwaps[id] = vn.perServing;
      for (const name of vn.unmatched) unmatchedAll.set(name, (unmatchedAll.get(name) || 0) + 1);
    }
    r.nutrition.withSwaps = withSwaps;
  }
}
if (unmatchedAll.size) {
  const sorted = [...unmatchedAll.entries()].sort((a, b) => b[1] - a[1]);
  console.warn(`\n⚠ Nutrition: ${unmatchedAll.size} ingredient(s) not in data/nutrition.json (skipped in the estimate):`);
  for (const [name, n] of sorted.slice(0, 40)) console.warn(`  · ${name}${n > 1 ? ` (×${n})` : ''}`);
  if (sorted.length > 40) console.warn(`  …and ${sorted.length - 40} more. Run \`npm run nutrition\` for the full list.`);
  console.warn('');
}

// Build the facet index so the site can render filter dropdowns without recomputing.
const cuisines = [...new Set(recipes.map((r) => r.cuisine).filter(Boolean))].sort();
const allTags = [...new Set(recipes.flatMap((r) => r.tags))].sort();

const payload = {
  // No build timestamp here on purpose: a volatile field would make the JSON differ
  // on every build and trigger needless CI re-commits.
  count: recipes.length,
  counts: {
    food: recipes.filter((r) => r.kind !== 'drink').length,
    drink: recipes.filter((r) => r.kind === 'drink').length,
  },
  vocab: VOCAB,
  meta: { protein: PROTEIN_META, method: METHOD_META, base: BASE_META, family: FAMILY_META, strength: STRENGTH_META },
  timeBuckets: TIME_BUCKETS,
  cuisineGroups: CUISINE_GROUPS,
  facets: { cuisines, tags: allTags },
  recipes: recipes.map(({ _file, ...r }) => r),
};

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(payload, null, 2) + '\n');
console.log(`✓ Built ${recipes.length} recipes -> docs/recipes.json`);

// Per-recipe share pages (/r/<slug>/) carrying Open Graph link-preview tags.
const rDir = join(root, 'docs', 'r');
const ogDir = join(root, 'docs', 'og');
rmSync(rDir, { recursive: true, force: true });
for (const r of recipes) {
  const ogImage = ogImageUrl(r, SITE, existsSync(join(ogDir, `${r.slug}.jpg`)));
  const dir = join(rDir, r.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), recipeStubHtml(r, { site: SITE, ogImage }));
}
console.log(`✓ Built ${recipes.length} share pages -> docs/r/<slug>/`);
