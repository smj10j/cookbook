#!/usr/bin/env node
// AI-generated site icon for Tonight's Menu — one square master image that gets
// resized down into the favicon + home-screen app icon set.
//
// The *brief* (what the icon should look like) lives in branding/icon-brief.md —
// human-editable plain English, same spirit as a recipe's `photo:` hint. This
// script only calls the image API when that brief's content has changed since
// the last run (tracked via a hash in branding/icon.meta.json), so re-running it
// with nothing edited is a cheap no-op.
//
// Usage:
//   npm run icon                # regenerate only if the brief changed
//   npm run icon -- --force     # regenerate anyway (e.g. to reroll the brief)
//
// Requires OPENAI_API_KEY in .env (git-ignored) or the environment, and
// ImageMagick (`convert` or `magick`) to derive the favicon/app-icon sizes.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { PALETTE } from './lib/theme.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const briefPath = join(root, 'branding', 'icon-brief.md');
const metaPath = join(root, 'branding', 'icon.meta.json');
const iconsDir = join(root, 'docs', 'icons');

const force = process.argv.includes('--force');

// ── brief + change detection ──
const brief = readFileSync(briefPath, 'utf8');
const hash = createHash('sha256').update(brief).digest('hex');
const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : null;
const masterPath = join(iconsDir, 'icon-master.png');

if (!force && meta?.hash === hash && existsSync(masterPath)) {
  console.log('✓ Icon brief unchanged — skipping (use `npm run icon -- --force` to regenerate anyway).');
  process.exit(0);
}

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

// ── pick an ImageMagick binary (v7 `magick` or v6 `convert`) ──
const IM = ['magick', 'convert'].find((bin) => { try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } });
if (!IM) {
  console.error('✗ ImageMagick not found. Install it (`brew install imagemagick` / `apt-get install -y imagemagick`) to derive favicon/app-icon sizes from the master image.');
  process.exit(1);
}

const MODEL = 'gpt-image-1';
const SIZE = '1024x1024';

async function generateMaster() {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, prompt: brief, n: 1, size: SIZE, quality: 'high', output_format: 'png' }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error('no image data in response');
  return Buffer.from(b64, 'base64');
}

// Sizes derived from the master: favicon PNGs, the iOS home-screen icon, and
// the two sizes referenced by the web app manifest (Android/PWA install).
const SIZES = {
  'favicon-16.png': 16,
  'favicon-32.png': 32,
  'favicon-48.png': 48,
  'apple-touch-icon.png': 180,
  'icon-192.png': 192,
  'icon-512.png': 512,
};

function deriveSizes() {
  for (const [file, px] of Object.entries(SIZES)) {
    execFileSync(IM, [masterPath, '-resize', `${px}x${px}`, join(iconsDir, file)]);
  }
  // Multi-resolution .ico for legacy browsers/bookmarks (modern browsers use the PNG links).
  execFileSync(IM, [masterPath, '-define', 'icon:auto-resize=48,32,16', join(root, 'docs', 'favicon.ico')]);
}

function writeManifest() {
  const manifest = {
    name: "Tonight's Menu",
    short_name: "Tonight's Menu",
    start_url: '.',
    display: 'standalone',
    background_color: PALETTE.cream,
    theme_color: PALETTE.accent,
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
  writeFileSync(join(root, 'docs', 'site.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');
}

mkdirSync(iconsDir, { recursive: true });
console.log('Generating site icon from branding/icon-brief.md…');
const buf = await generateMaster();
writeFileSync(masterPath, buf);
deriveSizes();
writeManifest();
writeFileSync(metaPath, JSON.stringify({ hash, model: MODEL, size: SIZE, generatedAt: new Date().toISOString() }, null, 2) + '\n');
console.log(`✓ Wrote docs/icons/, docs/favicon.ico, docs/site.webmanifest, and branding/icon.meta.json.`);
