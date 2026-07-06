#!/usr/bin/env node
// AI food photography for Tonight's Menu.
// Generates docs/images/<slug>.webp for recipes that don't have a photo yet.
// The build auto-detects those files, so this script never edits recipe frontmatter.
//
// Usage:
//   npm run photos                    # generate for every recipe missing a photo
//   npm run photos -- --only <slug>   # just one recipe
//   npm run photos -- --force         # regenerate even if a photo exists
//   npm run photos -- --quality high  # low | medium (default) | high
//   npm run photos -- --limit 3       # cap how many to generate this run
//
// Requires OPENAI_API_KEY in .env (git-ignored) or the environment.
// NOTE: the key is normally ALREADY present in .env on this machine — just run this
// script. Do NOT pre-check for the key with separate shell commands (a .env glob
// false-negative once caused a needless pause); if it is genuinely missing, the
// loader below exits with a clear, actionable message.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readAllRecipes } from './lib/parse.mjs';

// Recompress with cwebp (resize to 1280w, quality 80) if it's installed — turns the
// ~1.8MB API output into ~70KB with no visible loss. Falls back to the raw file.
let HAS_CWEBP = false;
try { execFileSync('cwebp', ['-version'], { stdio: 'ignore' }); HAS_CWEBP = true; } catch {}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const imagesDir = join(root, 'docs', 'images');

// ── args ──
const argv = process.argv.slice(2);
const getFlag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const only = getFlag('--only');
const force = argv.includes('--force');
const quality = getFlag('--quality') || 'medium';
const limit = Number(getFlag('--limit') || Infinity);

// ── load OPENAI_API_KEY from .env or environment ──
function loadEnv() {
  const path = join(root, '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) {
  console.error('✗ No OPENAI_API_KEY found. Add it to .env (it is git-ignored):\n  OPENAI_API_KEY=sk-...');
  process.exit(1);
}

// Pull the garnish phrase out of a drink's ingredients ("Lime wheel, for garnish" -> "lime wheel").
function garnishOf(r) {
  const g = (r.ingredients || []).flatMap((s) => s.items || []).find((l) => /garnish/i.test(l));
  return g ? g.replace(/,?\s*for garnish.*$/i, '').replace(/\(optional\)/ig, '').trim() : '';
}

// ── prompt builder: consistent editorial photography (food, dessert, or cocktail) ──
function buildPrompt(r) {
  if (r.kind === 'drink') return buildDrinkPrompt(r);
  const isDessert = r.category === 'dessert' || r.course === 'dessert';
  const firstItems = (r.ingredients[0]?.items || []).slice(0, 4).join(', ');
  const vessel = isDessert ? 'on a dessert plate or a rustic wooden board (a sliced loaf, a wedge of pie, or cookies as fits the dish)'
    : r.course === 'soup' ? 'in a rustic ceramic bowl'
    : r.course === 'salad' ? 'on a wide ceramic plate'
    : r.course === 'sauce' ? 'in a small bowl with a spoon'
    : r.course === 'taco' ? 'on a wooden board'
    : r.course === 'snack' ? 'on parchment in a shallow dish'
    : 'on a handmade ceramic plate';
  const garnishLine = isDessert ? 'a light dusting of sugar or a simple sweet finish, and gorgeous color contrast.'
    : 'fresh herbs and garnishes, and gorgeous color contrast.';
  return [
    `A mouth-watering, professionally food-styled photograph of "${r.title}", a ${r.cuisine} ${isDessert ? 'dessert' : r.course}.`,
    r.tagline,
    firstItems ? `Featuring ${firstItems}.` : '',
    // Depict the dish AS COOKED AND SERVED: every component in the exact form the recipe
    // finishes it (sliced, cubed, shredded, flaked, whole), plated ready to eat.
    r.photo ? `Plate it exactly like this: ${r.photo}` : 'Show each component prepared and cut exactly as the recipe describes — if the protein is sliced or flaked for serving, show it sliced or flaked, not as a whole piece.',
    `Restaurant-quality plating ${vessel} on a beautifully styled table with tasteful props,`,
    garnishLine,
    'Shot by a top Instagram food photographer on a full-frame DSLR, 50mm at f/2.8:',
    'gorgeous soft directional window light, glistening fresh ingredients, juicy and crisp',
    'textures, a wisp of steam, vibrant appetizing color, shallow depth of field, and a',
    'beautiful, considered composition — crave-worthy and drool-inducing, the kind of photo',
    'that makes you want to make it tonight.',
    'It is still a REAL photograph — photorealistic with natural imperfections — NOT an',
    'illustration, 3D render, CGI, cartoon, painting, or AI art, and never plastic, waxy, or fake.',
    // Only edible food belongs on the plate — cooking gear used to MAKE the dish must not appear.
    'On the plate show ONLY edible food and its sauce — never any cooking equipment (cedar plank, wooden skewers, toothpicks, butcher\'s twine, parchment, foil) unless the dish is genuinely served on or in it.',
    'No text, no words, no logos, no hands, no people.',
  ].filter(Boolean).join(' ');
}

// Cocktail styling — the drink in its proper glassware, not a plated dish.
function buildDrinkPrompt(r) {
  const glass = r.glass ? `a ${r.glass.toLowerCase()} glass` : 'an elegant cocktail glass';
  const garnish = garnishOf(r);
  return [
    `A mouth-watering, professionally styled cocktail photograph of "${r.title}", a ${r.base} ${r.family} cocktail served in ${glass}.`,
    r.tagline,
    garnish ? `Garnished with ${garnish.toLowerCase()}.` : '',
    r.photo ? `Style it exactly like this: ${r.photo}` : '',
    'Styled on a bar top or a beautifully set table with tasteful props,',
    'beads of condensation on the glass, glistening ice where it belongs, fresh garnish, and vibrant, appetizing color.',
    'Shot by a top cocktail photographer on a full-frame DSLR, 50mm at f/2.8:',
    'soft directional window light, shallow depth of field, and a beautiful, considered composition —',
    'crisp, refreshing, and crave-worthy.',
    'It is still a REAL photograph — photorealistic with natural imperfections — NOT an',
    'illustration, 3D render, CGI, cartoon, painting, or AI art, and never plastic, waxy, or fake.',
    'No text, no words, no logos, no hands, no people.',
  ].filter(Boolean).join(' ');
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function callApi(r, attempt = 1) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: buildPrompt(r),
      n: 1,
      size: '1536x1024',
      quality,
      output_format: 'webp',
    }),
  });
  if (res.status === 429 && attempt <= 6) {
    const body = await res.text();
    const m = body.match(/try again in ([\d.]+)s/i);
    const wait = (m ? parseFloat(m[1]) : 15) * 1000 + 2000; // honor suggestion + buffer
    await sleep(wait);
    return callApi(r, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res;
}

async function generate(r) {
  const res = await callApi(r);
  const json = await res.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error('no image data in response');
  const finalPath = join(imagesDir, `${r.slug}.webp`);
  const buf = Buffer.from(b64, 'base64');
  if (HAS_CWEBP) {
    const raw = join(imagesDir, `${r.slug}.raw.webp`);
    writeFileSync(raw, buf);
    execFileSync('cwebp', ['-quiet', '-q', '80', '-resize', '1280', '0', raw, '-o', finalPath]);
    rmSync(raw, { force: true });
  } else {
    writeFileSync(finalPath, buf);
  }
}

// ── run ──
mkdirSync(imagesDir, { recursive: true });
const drinksDir = join(root, 'drinks');
let recipes = [...readAllRecipes(join(root, 'recipes')), ...(existsSync(drinksDir) ? readAllRecipes(drinksDir) : [])];
if (only) recipes = recipes.filter((r) => r.slug === only);
if (!force) recipes = recipes.filter((r) => !existsSync(join(imagesDir, `${r.slug}.webp`)));
recipes = recipes.slice(0, limit);

if (!recipes.length) {
  console.log('Nothing to generate (all have photos, or no match). Use --force to regenerate.');
  process.exit(0);
}

console.log(`Generating ${recipes.length} photo(s) at quality="${quality}"${HAS_CWEBP ? ' (cwebp on)' : ''}…\n`);
const CONCURRENCY = 2;
let ok = 0, done = 0;
const queue = [...recipes.entries()];
async function worker() {
  while (queue.length) {
    const [i, r] = queue.shift();
    try {
      await generate(r);
      ok++;
      console.log(`  ✓ [${++done}/${recipes.length}] ${r.slug}`);
    } catch (e) {
      console.log(`  ✗ [${++done}/${recipes.length}] ${r.slug} — ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, recipes.length) }, worker));
console.log(`\nDone: ${ok}/${recipes.length} generated -> docs/images/. Run \`npm run build\` to attach them.`);
