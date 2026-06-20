#!/usr/bin/env node
// Report nutrition-database coverage across every recipe + drink. Lists the
// ingredients that aren't yet in data/nutrition.json so the add-recipe /
// add-drink skills know exactly what to look up and add. Read-only; never fails
// the build (missing ingredients are skipped in the estimate, not fatal).
//
//   npm run nutrition            # full coverage + every unmatched ingredient
//   npm run nutrition -- <slug>  # focus one recipe/drink

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readAllRecipes } from './lib/parse.mjs';
import { loadDb, buildIndex, recipeNutrition } from './lib/nutrition.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const drinksDir = join(root, 'drinks');
const recipes = [...readAllRecipes(join(root, 'recipes')), ...(existsSync(drinksDir) ? readAllRecipes(drinksDir) : [])];

const db = loadDb(join(root, 'data', 'nutrition.json'));
const index = buildIndex(db);
const focus = process.argv[2];

const unmatched = new Map();
let high = 0, partial = 0, low = 0;

for (const r of recipes) {
  if (focus && r.slug !== focus) continue;
  const nut = recipeNutrition(r, db, index);
  if (nut.confidence === 'high') high++;
  else if (nut.confidence === 'partial') partial++;
  else low++;
  for (const name of nut.unmatched) {
    if (!unmatched.has(name)) unmatched.set(name, []);
    unmatched.get(name).push(r.slug);
  }
  if (focus) {
    const p = nut.perServing;
    console.log(`\n${r.title}  (serves ${r.serves}, ${r.kind || 'food'})`);
    console.log(`  Confidence: ${nut.confidence}  (${nut.matched}/${nut.considered} ingredients matched)`);
    console.log(`  Per serving: ${p.kcal} cal · ${p.protein}g protein · ${p.carb}g carb · ${p.fat}g fat · ${p.sodium}mg sodium`);
    if (nut.unmatched.length) console.log(`  Unmatched: ${nut.unmatched.join(', ')}`);
  }
}

if (!focus) {
  console.log(`Nutrition coverage across ${recipes.length} items:`);
  console.log(`  high: ${high}   partial: ${partial}   low/none: ${low}`);
  console.log(`  database entries: ${Object.keys(db).length}`);
  if (unmatched.size) {
    console.log(`\n${unmatched.size} ingredient name(s) missing from data/nutrition.json:\n`);
    for (const [name, slugs] of [...unmatched.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${String(slugs.length).padStart(3)}×  ${name}`);
    }
    console.log('\nAdd these to data/nutrition.json (per smallest divisible unit) and rebuild.');
  } else {
    console.log('\n✓ Every ingredient is covered by the database.');
  }
}
