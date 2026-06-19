#!/usr/bin/env node
// Compile recipes/*.md -> docs/recipes.json (the data the site loads).
// Also runs validation first and refuses to build if anything is malformed.

import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readAllRecipes } from './lib/parse.mjs';
import { validateRecipe, VOCAB, PROTEIN_META, METHOD_META, TIME_BUCKETS, CUISINE_GROUPS } from './lib/schema.mjs';
import { recipeStubHtml, ogImageUrl } from './lib/stub.mjs';

// Absolute site URL, used for canonical + Open Graph image links in the share pages.
const SITE = (process.env.SITE_URL || 'https://smj10j.github.io/cookbook').replace(/\/+$/, '');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const recipesDir = join(root, 'recipes');
const outFile = join(root, 'docs', 'recipes.json');

const recipes = readAllRecipes(recipesDir);

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

// Build the facet index so the site can render filter dropdowns without recomputing.
const cuisines = [...new Set(recipes.map((r) => r.cuisine))].sort();
const allTags = [...new Set(recipes.flatMap((r) => r.tags))].sort();

const payload = {
  // No build timestamp here on purpose: a volatile field would make the JSON differ
  // on every build and trigger needless CI re-commits.
  count: recipes.length,
  vocab: VOCAB,
  meta: { protein: PROTEIN_META, method: METHOD_META },
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
