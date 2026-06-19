#!/usr/bin/env node
// Lint every recipe against the schema without building. Run by the add-recipe
// skill and by CI. Exits non-zero if anything is malformed.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readAllRecipes } from './lib/parse.mjs';
import { validateRecipe } from './lib/schema.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const recipes = readAllRecipes(join(root, 'recipes'));

const errors = [];
const slugs = new Set();
for (const r of recipes) {
  errors.push(...validateRecipe(r, r._file));
  if (slugs.has(r.slug)) errors.push(`${r._file}: duplicate slug "${r.slug}"`);
  slugs.add(r.slug);
}

if (errors.length) {
  console.error(`✗ ${errors.length} problem(s) across ${recipes.length} recipes:\n`);
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
console.log(`✓ All ${recipes.length} recipes valid.`);
