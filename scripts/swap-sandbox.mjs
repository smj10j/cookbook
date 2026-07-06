#!/usr/bin/env node
// planSwaps authoring aid — `npm run swaps -- <slug> [swaps]`. A read-only helper
// (mirrors docs/lib.js; ships nothing) for writing eating-plan swaps fast: it shows
// what a recipe needs and verifies candidate swaps against the exact no-dead-swaps
// gate `npm test` enforces, so you don't burn a full build+test per iteration.
//
//   node scripts/swap-sandbox.mjs <slug>
//       Show the recipe's as-written per-serving numbers + each plan's verdict
//       and blown limits (what a swap would need to fix).
//
//   node scripts/swap-sandbox.mjs <slug> '<planSwaps-json>'
//       Given a full planSwaps array (entries with {for,replace,with}), verify
//       — exactly like the build's no-dead-swaps test gate — that EACH declared
//       plan id's UNION of entries strictly lifts its tier. Prints PASS/FAIL per
//       plan and the with-swaps numbers. Also flags a `replace` line that does
//       not match any current ingredient (would be a validation error).
import { readAllRecipes } from './lib/parse.mjs';
import { loadDb, buildIndex, recipeNutrition } from './lib/nutrition.mjs';
import { applyPlanSwaps, normalizeSections } from './lib/schema.mjs';
import { EATING_PLANS, evaluatePlans } from '../docs/lib.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const recipes = [...readAllRecipes(join(root, 'recipes')), ...readAllRecipes(join(root, 'drinks'))];
const db = loadDb(join(root, 'data', 'nutrition.json'));
const index = buildIndex(db);
const RANK = { optimal: 0, ok: 1, avoid: 2 };

const slug = process.argv[2];
const r = recipes.find((x) => x.slug === slug);
// swaps source: a JSON string, @file, "--self" (read the recipe's own authored
// planSwaps — mirrors the build's no-dead-swaps gate exactly), or none.
let swaps = null;
const arg3 = process.argv[3];
if (arg3 === '--self') swaps = r?.planSwaps || [];
else if (arg3?.startsWith('@')) swaps = JSON.parse(readFileSync(arg3.slice(1), 'utf8'));
else if (arg3) swaps = JSON.parse(arg3);
if (!r) { console.error('no recipe', slug); process.exit(1); }
for (const rr of recipes) {
  if (!rr.hero && existsSync(join(root, 'docs', 'images', `${rr.slug}.webp`))) rr.hero = `images/${rr.slug}.webp`;
}

const base = recipeNutrition(r, db, index);
r.nutrition = { perServing: base.perServing, confidence: base.confidence, matched: base.matched, considered: base.considered };
const per = base.perServing;
console.log(`\n${r.title}  (serves ${r.serves}, confidence ${base.confidence})`);
if (base.unmatched.length) console.log('  UNMATCHED:', base.unmatched.join(', '));
console.log(`  per-serving: ${Math.round(per.kcal)} kcal · ${per.protein.toFixed(0)}g pro · ${per.carb.toFixed(0)}g carb · sat ${per.satfat.toFixed(1)}g · sugar ${per.sugar.toFixed(1)}g · sodium ${Math.round(per.sodium)}mg · fiber ${per.fiber.toFixed(1)}g`);

const evals = evaluatePlans(r);
const verdictOf = (ev, id) => ev.find((x) => x.plan.id === id).verdict;
console.log('\n  AS WRITTEN:');
for (const e of evals) {
  const blown = e.limits.filter((l) => l.tier !== 'optimal').map((l) => `${l.key} ${Math.round(l.value*10)/10}/${l.tier==='avoid'?'>'+l.ok:l.optimal}`);
  console.log(`   ${e.plan.icon} ${e.verdict.padEnd(8)} ${e.plan.id.padEnd(14)} ${blown.join(', ')}`);
}
if (!swaps) { console.log(''); process.exit(0); }

// Validate replace lines exist (mirror schema validation).
const lines = new Set(normalizeSections(r.ingredients).flatMap((s) => s.items).filter((it) => typeof it === 'string').map((it) => it.trim()));
let bad = false;
for (const s of swaps) {
  if (!lines.has((s.replace || '').trim())) { console.log(`\n  ✗ replace line NOT FOUND: "${s.replace}"`); bad = true; }
}
if (bad) { console.log('\n  (fix replace lines — they must match an ingredient exactly)\n'); process.exit(1); }

// Per-plan union check, exactly like the data gate.
const planIds = [...new Set(swaps.flatMap((s) => s.for))];
console.log('\n  PER-PLAN CHECK (union of that plan\'s entries):');
let allPass = true;
for (const id of planIds) {
  const idx = swaps.map((s, i) => (s.for.includes(id) ? i : -1)).filter((i) => i >= 0);
  const variant = { ...r, ingredients: applyPlanSwaps(r.ingredients, idx.map((i) => swaps[i])) };
  const vn = recipeNutrition(variant, db, index);
  const vev = evaluatePlans({ ...r }, EATING_PLANS, vn.perServing);
  const was = verdictOf(evals, id), now = verdictOf(vev, id);
  const pass = RANK[now] < RANK[was];
  if (!pass) allPass = false;
  const p = EATING_PLANS.find((x) => x.id === id);
  console.log(`   ${pass ? 'PASS' : 'FAIL'}  ${p.icon} ${id.padEnd(14)} ${was} -> ${now}${vn.unmatched.length ? '   UNMATCHED: ' + vn.unmatched.join(', ') : ''}`);
}
console.log(allPass ? '\n  ✓ all declared plans lift — safe to author\n' : '\n  ✗ some plans do NOT lift — this would FAIL npm test\n');
process.exit(allPass ? 0 : 1);
