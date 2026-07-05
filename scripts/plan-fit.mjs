#!/usr/bin/env node
// Eating-plan fit report — `npm run plans [-- <slug>]`.
// Shows each recipe's verdict against the ten eating plans exactly as the site
// computes them (docs/lib.js). Run after `npm run build` so docs/recipes.json
// is fresh. With a slug: that recipe's full verdict table (with reasons).
// Without: the whole-cookbook distribution per plan.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EATING_PLANS, evaluatePlans, planReasons } from '../docs/lib.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(root, 'docs/recipes.json'), 'utf8'));
const GLYPH = { optimal: '✓ great', ok: '~ okay ', avoid: '✗ poor ' };

const slug = process.argv[2];
if (slug) {
  const r = data.recipes.find((x) => x.slug === slug);
  if (!r) { console.error(`No recipe with slug "${slug}".`); process.exit(1); }
  console.log(`\n${r.title} — eating-plan fit (per serving, serves ${r.serves})\n`);
  const evals = evaluatePlans(r);
  if (!evals.length) { console.log('No usable nutrition estimate — teach data/nutrition.json first.'); process.exit(0); }
  for (const e of evals) {
    const why = planReasons(e).join(' · ');
    console.log(`  ${e.plan.icon} ${GLYPH[e.verdict]}  ${e.plan.name.padEnd(18)}${why}`);
  }
  console.log('');
} else {
  console.log('\nEating-plan fit across the cookbook (per serving):\n');
  for (const kind of ['food', 'drink']) {
    const list = data.recipes.filter((r) => (r.kind || 'food') === kind);
    if (!list.length) continue;
    console.log(`  ${kind.toUpperCase()} (${list.length})`);
    for (const p of EATING_PLANS) {
      const c = { optimal: 0, ok: 0, avoid: 0 };
      for (const r of list) {
        const e = evaluatePlans(r).find((x) => x.plan.id === p.id);
        if (e) c[e.verdict]++;
      }
      console.log(`    ${p.icon} ${p.name.padEnd(18)} great ${String(c.optimal).padStart(3)}   okay ${String(c.ok).padStart(3)}   poor ${String(c.avoid).padStart(3)}`);
    }
  }
  console.log('\n  Detail for one recipe: npm run plans -- <slug>\n');
}
