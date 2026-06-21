#!/usr/bin/env node
// Generate JPEG link-preview (Open Graph) images from the recipe webp photos.
// JPEG is the safest format for iMessage / Slack / etc. previews.
//   npm run og            # only missing ones
//   npm run og -- --force # regenerate all
// Converter: macOS `sips` (built-in) locally, ImageMagick (`magick`/`convert`) on Linux/CI.
import { readdirSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const imagesDir = join(root, 'docs', 'images');
const ogDir = join(root, 'docs', 'og');
mkdirSync(ogDir, { recursive: true });
const force = process.argv.includes('--force');

// Pick an installed converter. macOS has `sips`; Linux/CI uses ImageMagick (v7 `magick`
// or v6 `convert`). Both emit a ~1200px-max, quality-70 JPEG from the source webp.
function pickConverter() {
  if (process.platform === 'darwin') {
    return { label: 'sips', run: (i, o) => execFileSync('sips',
      ['-s', 'format', 'jpeg', '-Z', '1200', '-s', 'formatOptions', '70', i, '--out', o], { stdio: 'ignore' }) };
  }
  const has = (cmd) => { try { execFileSync(cmd, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } };
  for (const bin of ['magick', 'convert']) {
    if (has(bin)) return { label: bin, run: (i, o) =>
      execFileSync(bin, [i, '-resize', '1200x1200', '-quality', '70', o], { stdio: 'ignore' }) };
  }
  return null;
}

const conv = pickConverter();
if (!conv) {
  console.error('✗ No image converter found. Install macOS `sips` (built-in) or ImageMagick (`brew install imagemagick` / `apt-get install -y imagemagick`).');
  process.exit(1);
}

let n = 0, fail = 0;
for (const f of readdirSync(imagesDir)) {
  if (!f.endsWith('.webp')) continue;
  const slug = f.replace(/\.webp$/, '');
  const name = slug === '_preview' ? '_home' : slug;     // homepage default
  const out = join(ogDir, `${name}.jpg`);
  if (!force && existsSync(out)) continue;
  try {
    conv.run(join(imagesDir, f), out);
    n++;
  } catch (e) { fail++; console.error(`✗ ${slug}: ${e.message.split('\n')[0]}`); }
}
console.log(`✓ ${n} OG image(s) -> docs/og/ via ${conv.label}${fail ? ` (${fail} failed)` : ''}`);
