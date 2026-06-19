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

// ── prompt builder: consistent editorial food photography ──
function buildPrompt(r) {
  const firstItems = (r.ingredients[0]?.items || []).slice(0, 4).join(', ');
  const vessel =
    r.course === 'soup' ? 'in a rustic ceramic bowl'
    : r.course === 'salad' ? 'on a wide ceramic plate'
    : r.course === 'sauce' ? 'in a small bowl with a spoon'
    : r.course === 'taco' ? 'on a wooden board'
    : r.course === 'snack' ? 'on parchment in a shallow dish'
    : 'on a handmade ceramic plate';
  return [
    `A realistic, natural photograph of "${r.title}", a ${r.cuisine} ${r.course}.`,
    r.tagline,
    firstItems ? `Featuring ${firstItems}.` : '',
    `Plated ${vessel} on a lived-in kitchen table.`,
    'Shot on a full-frame DSLR with a 50mm lens at f/2.8: natural window light, soft real',
    'shadows, shallow depth of field, slightly imperfect home-cook plating, true food',
    'textures and steam, true-to-life colors that are NOT oversaturated.',
    'Candid documentary food photography that looks like a real photo from a phone or camera —',
    'with natural imperfections. It must NOT look like an illustration, 3D render, CGI, cartoon,',
    'painting, or AI art, and must avoid glossy, plastic, waxy, or over-styled perfection.',
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
let recipes = readAllRecipes(join(root, 'recipes'));
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
