#!/usr/bin/env node
// Generate JPEG link-preview (Open Graph) images from the recipe webp photos.
// JPEG is the safest format for iMessage / Slack / etc. previews. Uses macOS `sips`.
//   npm run og            # only missing ones
//   npm run og -- --force # regenerate all
import { readdirSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const imagesDir = join(root, 'docs', 'images');
const ogDir = join(root, 'docs', 'og');
mkdirSync(ogDir, { recursive: true });
const force = process.argv.includes('--force');

let n = 0, fail = 0;
for (const f of readdirSync(imagesDir)) {
  if (!f.endsWith('.webp')) continue;
  const slug = f.replace(/\.webp$/, '');
  const name = slug === '_preview' ? '_home' : slug;     // homepage default
  const out = join(ogDir, `${name}.jpg`);
  if (!force && existsSync(out)) continue;
  try {
    execFileSync('sips', ['-s', 'format', 'jpeg', '-Z', '1200', '-s', 'formatOptions', '70',
      join(imagesDir, f), '--out', out], { stdio: 'ignore' });
    n++;
  } catch (e) { fail++; console.error(`✗ ${slug}: ${e.message.split('\n')[0]} (needs macOS \`sips\`)`); }
}
console.log(`✓ ${n} OG image(s) -> docs/og/${fail ? ` (${fail} failed)` : ''}`);
