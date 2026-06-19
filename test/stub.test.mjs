// Tests for the per-recipe share pages (Open Graph link previews).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recipeStubHtml, ogImageUrl } from '../scripts/lib/stub.mjs';

const site = 'https://smj10j.github.io/cookbook';
const recipe = {
  slug: 'blackened-steak-salad',
  title: 'Blackened Steak Salad with "Blue Cheese"',
  tagline: 'Hot & cold, sweet & sharp',
  hero: 'images/blackened-steak-salad.webp',
};

test('ogImageUrl prefers jpg, falls back to hero then site default', () => {
  assert.equal(ogImageUrl(recipe, site, true), `${site}/og/blackened-steak-salad.jpg`);
  assert.equal(ogImageUrl(recipe, site, false), `${site}/images/blackened-steak-salad.webp`);
  assert.equal(ogImageUrl({ slug: 'x' }, site, false), `${site}/og/_home.jpg`);
});

test('recipeStubHtml carries escaped OG/Twitter preview tags + an app redirect', () => {
  const html = recipeStubHtml(recipe, { site, ogImage: `${site}/og/blackened-steak-salad.jpg` });
  assert.match(html, /<meta property="og:title" content="Blackened Steak Salad with &quot;Blue Cheese&quot;">/);
  assert.match(html, /<meta property="og:description" content="Hot &amp; cold, sweet &amp; sharp">/);
  assert.match(html, new RegExp(`<meta property="og:image" content="${site}/og/blackened-steak-salad\\.jpg">`));
  assert.match(html, /<meta property="og:type" content="article">/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(html, new RegExp(`<link rel="canonical" href="${site}/r/blackened-steak-salad/">`));
  assert.match(html, /location\.replace\(base \+ '#\/blackened-steak-salad'\)/); // bounces into the app
});
