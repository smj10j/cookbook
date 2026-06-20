// Integration tests — drive the real app.js inside jsdom to catch DOM/state bugs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'docs/index.html'), 'utf8');
const recipes = JSON.parse(readFileSync(join(root, 'docs/recipes.json'), 'utf8'));

let bootCount = 0;
async function boot() {
  const dom = new JSDOM(html, { url: 'https://example.com/', pretendToBeVisual: true });
  const { window } = dom;
  let copied = null;
  const set = (k, v) => { try { globalThis[k] = v; } catch { Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); } };
  set('window', window);
  set('document', window.document);
  set('localStorage', window.localStorage);
  set('history', window.history);
  set('location', window.location);
  set('CSS', window.CSS && window.CSS.escape ? window.CSS : { escape: (s) => String(s) });
  set('matchMedia', () => ({ matches: false }));
  window.matchMedia = globalThis.matchMedia;
  globalThis.__NO_AUTO_INIT__ = true;
  window.__NO_AUTO_INIT__ = true;
  // Provide navigator.clipboard. Works whether Node has a global `navigator`
  // (Node 21+, read-only) or not (Node 20, undefined).
  const clip = { writeText: (t) => { copied = t; return Promise.resolve(); } };
  if (typeof globalThis.navigator === 'undefined') {
    set('navigator', { clipboard: clip, userAgent: 'test' });
  } else {
    try { Object.defineProperty(globalThis.navigator, 'clipboard', { value: clip, configurable: true }); } catch {}
  }
  set('fetch', async () => ({ json: async () => recipes }));
  const app = await import(`../docs/app.js?b=${bootCount++}`);
  await app.init();
  const $ = (s) => window.document.querySelector(s);
  const $$ = (s) => [...window.document.querySelectorAll(s)];
  return { window, doc: window.document, app, $, $$, getCopied: () => copied };
}

test('boots and renders one card per recipe', async () => {
  const { $$, app } = await boot();
  assert.equal($$('.card').length, recipes.count);
  assert.equal(app.state.all.length, recipes.count);
});

test('selecting a card shows the shopbar and marks the card', async () => {
  const { $, $$, app } = await boot();
  assert.equal($('#shopbar').hidden, true);
  const btn = $$('.card-select')[0];
  btn.click();
  assert.equal(app.state.selected.size, 1);
  assert.equal($('#shopbar').hidden, false);
  assert.equal($('#shopbar-count').textContent, '1');
  assert.ok(btn.closest('.card-wrap').classList.contains('is-selected'));
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  // toggling off
  btn.click();
  assert.equal(app.state.selected.size, 0);
  assert.equal($('#shopbar').hidden, true);
});

test('REGRESSION: selecting EVERY recipe renders a non-empty list (no crash)', async () => {
  const { $, $$, app } = await boot();
  $$('.card-select').forEach((b) => b.click());
  assert.equal(app.state.selected.size, recipes.count);
  $('#shopbar').click();                       // open the overlay
  assert.equal($('#shoplist').hidden, false);
  const body = $('#shoplist-body').textContent;
  assert.ok(!/No recipes selected/.test(body), 'overlay must not be empty');
  assert.equal($$('.shop-recipe').length, recipes.count, 'one block per selected recipe');
  // total rows == total ingredient lines across all recipes
  const totalLines = recipes.recipes.reduce((n, r) => n + r.ingredients.reduce((m, s) => m + s.items.length, 0), 0);
  assert.equal($$('.shop-item').length, totalLines);
});

test('REGRESSION: Clear Selection truly clears (no stale items reappear)', async () => {
  const { $, $$, app } = await boot();
  // select three, open, then clear
  $$('.card-select').slice(0, 3).forEach((b) => b.click());
  $('#shopbar').click();
  assert.ok($$('.shop-item').length > 0);
  $('#shop-clear').click();
  assert.equal(app.state.selected.size, 0, 'state cleared');
  assert.equal(app.state.shop.items.length, 0, 'shop items cleared');
  assert.equal($('#shoplist-body').innerHTML.trim(), '', 'overlay DOM cleared');
  assert.equal($('#shopbar').hidden, true);
  assert.equal($$('.card-wrap.is-selected').length, 0, 'no card still looks selected');
  // select a DIFFERENT single recipe, reopen — only it should appear
  $$('.card-select')[5].click();
  $('#shopbar').click();
  assert.equal($$('.shop-recipe').length, 1, 'only the newly-selected recipe shows');
});

test('staples default unchecked (core no flag, pantry flagged); produce checked', async () => {
  const { $, $$ } = await boot();
  // pick the blackened steak salad (known to contain salt/oil/paprika/balsamic + produce)
  const card = $$('.card-select').find((b) => b.dataset.select === 'blackened-steak-salad');
  card.click();
  $('#shopbar').click();
  const items = $$('.shop-item');
  const find = (txt) => items.find((el) => el.textContent.includes(txt));
  const salt = find('kosher salt');
  const oil = find('olive oil');
  const paprika = find('smoked paprika');
  const balsamic = find('balsamic vinegar');
  const greens = find('mixed baby greens');
  assert.ok(salt && !salt.querySelector('input').checked, 'salt unchecked');
  assert.ok(!salt.querySelector('.pantry-flag'), 'salt has no flag (core)');
  assert.ok(paprika && !paprika.querySelector('input').checked && paprika.querySelector('.pantry-flag'), 'paprika unchecked + flagged');
  assert.ok(balsamic && balsamic.querySelector('.pantry-flag'), 'balsamic flagged');
  assert.ok(oil && !oil.querySelector('input').checked, 'oil unchecked');
  assert.ok(greens && greens.querySelector('input').checked, 'greens checked');
});

test('serves input rescales quantities', async () => {
  const { $, $$ } = await boot();
  $$('.card-select').find((b) => b.dataset.select === 'blackened-steak-salad').click();
  $('#shopbar').click();
  const steak = $$('.shop-item').find((el) => el.textContent.includes('sirloin'));
  const base = steak.querySelector('.shop-qty').textContent;     // serves 2 -> "1 lb..."
  assert.match(base, /^1 lb/);
  const input = $('#shop-serves');
  input.value = '4';
  input.dispatchEvent(new (globalThis.window.Event)('input', { bubbles: true }));
  assert.match(steak.querySelector('.shop-qty').textContent, /^2 lb/, 'doubled for 4 servings');
});

test('copy: merges duplicates, excludes staples, formats as a dash list', async () => {
  const { $, $$, getCopied } = await boot();
  for (const slug of ['blackened-steak-salad', 'chicken-piccata']) {
    const b = $$('.card-select').find((x) => x.dataset.select === slug);
    if (b) b.click();
  }
  $('#shopbar').click();
  $('#shop-copy').click();
  await Promise.resolve();
  const text = getCopied();
  assert.ok(text && text.length, 'something was copied');
  const rows = text.split('\n').filter(Boolean);
  assert.ok(rows.every((l) => l.startsWith('- ') || l === 'Optional:'), 'dash-list format');
  assert.ok(rows.filter((l) => /garlic/i.test(l)).length <= 1, 'garlic merged to one line');
  assert.ok(!/olive oil|kosher salt|balsamic vinegar/i.test(text), 'unchecked staples excluded');
});

test('copy: checklist format toggle produces "- [ ]" lines', async () => {
  const { $, $$, getCopied } = await boot();
  $$('.card-select')[0].click();
  $('#shopbar').click();
  $('#format-toggle .fmt-btn[data-format="checkbox"]').click();
  $('#shop-copy').click();
  await Promise.resolve();
  const text = getCopied();
  assert.ok(text.split('\n').some((l) => l.startsWith('- [ ] ')), 'checklist lines present');
});

test('reader Share button copies the /r/<slug>/ preview link', async () => {
  const { $, $$, getCopied } = await boot();
  const card = $$('.card').find((c) => c.dataset.slug === 'blackened-steak-salad') || $$('.card')[0];
  const slug = card.dataset.slug;
  card.click();
  assert.equal($('#reader').hidden, false);
  $('#reader-share').click();
  await Promise.resolve();
  const copied = getCopied();
  assert.ok(copied && copied.endsWith(`/r/${slug}/`), `share link should end with /r/${slug}/ (got ${copied})`);
});

test('REGRESSION: flip animates a throwaway leaf, never the live scroll layer', async () => {
  const { $, $$ } = await boot();
  $$('.card')[0].click();
  assert.equal($('#reader').hidden, false);
  // Scrolling must live on an inner wrapper, NOT on the animated element — animating a
  // transform on an overflow:auto layer makes mobile WebKit snap to the final frame
  // instead of playing the page-turn.
  const scroller = $('#spread .spread-scroll');
  assert.ok(scroller, 'spread content is wrapped in a .spread-scroll layer');
  assert.ok(scroller.querySelector('.spread-hero'), 'hero lives inside the scroller');
  assert.ok(scroller.querySelector('.spread-inner'), 'body lives inside the scroller');
  // A forward flip clones the OUTGOING page into a throwaway .turn-leaf that animates,
  // while the live #spread (the new page) is never animated — that separation is what
  // keeps mobile WebKit from snapping.
  $('#reader-next').click();
  const leaf = $('.reader-stage .turn-leaf');
  assert.ok(leaf, 'a turning leaf is created on flip');
  assert.ok(leaf.classList.contains('turn-next'), 'forward turn direction class applied');
  assert.ok(leaf.querySelector('.spread-scroll'), 'leaf carries the page it is turning away from');
  assert.ok(!$('#spread').classList.contains('turn-leaf'), 'the live spread itself never animates');
  assert.ok($('#spread .spread-scroll'), 'the live spread shows the new page');
});

test('in-recipe "Add to list" button toggles selection and syncs the grid card', async () => {
  const { $, $$, app } = await boot();
  const card = $$('.card').find((c) => c.dataset.slug === 'blackened-steak-salad') || $$('.card')[0];
  const slug = card.dataset.slug;
  card.click();
  assert.equal($('#reader').hidden, false);
  const btn = $('#spread .spread-select');
  assert.ok(btn, 'the spread hero has an Add-to-list button');
  assert.equal(btn.getAttribute('aria-pressed'), 'false', 'starts unselected');
  btn.click();
  assert.ok(app.state.selected.has(slug), 'recipe added to the shopping selection');
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  assert.equal($('#shopbar').hidden, false, 'shopbar appears');
  const cardSel = $$('.card-select').find((b) => b.dataset.select === slug);
  assert.equal(cardSel.getAttribute('aria-pressed'), 'true', 'grid card ✓ kept in sync');
  assert.ok(cardSel.closest('.card-wrap').classList.contains('is-selected'));
  btn.click();
  assert.ok(!app.state.selected.has(slug), 'toggles back off');
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  assert.equal(cardSel.getAttribute('aria-pressed'), 'false', 'grid card un-synced too');
});

test('filters narrow the menu', async () => {
  const { $, $$, app } = await boot();
  const before = $$('.card').length;
  const beefChip = $$('.chip').find((c) => c.dataset.key === 'protein' && c.dataset.val === 'beef');
  beefChip.click();
  const after = $$('.card').length;
  assert.ok(after < before && after > 0, 'beef filter narrows');
  assert.ok(app.state.filtered.every((r) => r.protein === 'beef'));
});
