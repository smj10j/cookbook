// Integration tests — drive the real app.js inside jsdom to catch DOM/state bugs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EATING_PLANS, evaluatePlans, buildPlanVerdicts } from '../docs/lib.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'docs/index.html'), 'utf8');
const recipes = JSON.parse(readFileSync(join(root, 'docs/recipes.json'), 'utf8'));

let bootCount = 0;
async function boot(url = 'https://example.com/') {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true });
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

const foodRecipes = recipes.recipes.filter((r) => (r.kind || 'food') === 'food');
const drinkRecipes = recipes.recipes.filter((r) => r.kind === 'drink');

test('boots and renders one card per FOOD recipe (default tab)', async () => {
  const { $$, app } = await boot();
  assert.equal($$('.card').length, foodRecipes.length, 'one card per food recipe on the default tab');
  assert.equal(app.state.all.length, recipes.count, 'state holds food + drinks');
});

test('Drinks tab swaps the dataset, filters, and spec block', async () => {
  const { $, $$, app } = await boot();
  $$('#tabs .tab').find((t) => t.dataset.kind === 'drink').click();
  assert.equal(app.state.kind, 'drink');
  assert.equal($$('.card').length, drinkRecipes.length, 'cards switch to the drinks set');
  const groups = $$('.filter-group').map((g) => g.dataset.group);
  assert.ok(groups.includes('base'), 'a Base filter appears on Drinks');
  assert.ok(!groups.includes('protein'), 'the Protein filter is hidden on Drinks');
  $$('.card')[0].click();
  assert.equal($('#reader').hidden, false);
  const labels = $$('#spread .m-label').map((e) => e.textContent);
  assert.ok(labels.includes('Base') && labels.includes('Glass'), 'drink spec block shows Base + Glass');
});

test('choosing a tab writes a shareable hash to the URL', async () => {
  const { window, $$ } = await boot();
  assert.equal(window.location.hash, '', 'no hash on the default food load');
  $$('#tabs .tab').find((t) => t.dataset.kind === 'drink').click();
  assert.equal(window.location.hash, '#drinks', 'Drinks tab adds #drinks');
  $$('#tabs .tab').find((t) => t.dataset.kind === 'food').click();
  assert.equal(window.location.hash, '#food', 'Food tab adds #food');
});

test('booting with #drinks lands on the Drinks tab (refresh/shareable)', async () => {
  const { app, $$ } = await boot('https://example.com/#drinks');
  assert.equal(app.state.kind, 'drink', 'the drinks section is active from the hash alone');
  assert.equal($$('.card').length, drinkRecipes.length, 'drink cards render on boot');
});

test('a hashchange to #drinks switches tabs; back to #food returns', async () => {
  const { window, app } = await boot();
  window.location.hash = '#drinks';
  window.dispatchEvent(new window.Event('hashchange'));
  assert.equal(app.state.kind, 'drink');
  window.location.hash = '#food';
  window.dispatchEvent(new window.Event('hashchange'));
  assert.equal(app.state.kind, 'food');
});

test('closing a recipe restores its section hash, not a bare URL', async () => {
  const { window, app, $, $$ } = await boot();
  $$('#tabs .tab').find((t) => t.dataset.kind === 'drink').click();
  $$('.card')[0].click();                              // open a drink
  assert.match(window.location.hash, /^#\//, 'reader sets a #/<slug> hash');
  $('#reader-close').click();
  assert.equal(window.location.hash, '#drinks', 'closing returns to the Drinks tab');
  assert.equal(app.state.kind, 'drink');
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

test('REGRESSION: selecting EVERY visible card renders a non-empty list (no crash)', async () => {
  const { $, $$, app } = await boot();
  $$('.card-select').forEach((b) => b.click());      // every FOOD card on the default tab
  assert.equal(app.state.selected.size, foodRecipes.length);
  $('#shopbar').click();                       // open the overlay
  assert.equal($('#shoplist').hidden, false);
  const body = $('#shoplist-body').textContent;
  assert.ok(!/No recipes selected/.test(body), 'overlay must not be empty');
  assert.equal($$('.shop-recipe').length, foodRecipes.length, 'one block per selected recipe');
  // total rows == total ingredient lines across the selected recipes
  const totalLines = foodRecipes.reduce((n, r) => n + r.ingredients.reduce((m, s) => m + s.items.length, 0), 0);
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
  assert.equal($('#shopbar').hidden, false, 'corner cart FAB appears');
  assert.equal($('#reader-cart').hidden, false, 'in-reader cart appears');
  assert.equal($('#reader-cart-count').textContent, '1', 'in-reader cart shows the count');
  const cardSel = $$('.card-select').find((b) => b.dataset.select === slug);
  assert.equal(cardSel.getAttribute('aria-pressed'), 'true', 'grid card ✓ kept in sync');
  assert.ok(cardSel.closest('.card-wrap').classList.contains('is-selected'));
  btn.click();
  assert.ok(!app.state.selected.has(slug), 'toggles back off');
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  assert.equal(cardSel.getAttribute('aria-pressed'), 'false', 'grid card un-synced too');
  assert.equal($('#reader-cart').hidden, true, 'in-reader cart hides when the list empties');
});

test('the reader shows an always-expanded per-serving nutrition panel at the bottom', async () => {
  const { $, $$ } = await boot();
  const card = $$('.card').find((c) => c.dataset.slug === 'blackened-steak-salad') || $$('.card')[0];
  card.click();
  const panel = $('#spread .nutrition');
  assert.ok(panel, 'a .nutrition panel renders in the spread');
  assert.equal(panel.tagName.toLowerCase(), 'section', 'it is a plain <section>, not collapsible');
  assert.ok(!$('#spread .nutrition details, #spread .nutrition summary'), 'no collapse affordance');
  // It sits at the very bottom of the spread body.
  const kids = [...$('#spread .spread-inner').children];
  assert.equal(kids[kids.length - 1], panel, 'nutrition is the last block in the spread');
  // Header shows a calorie figure; the panel lists macros with %DV.
  assert.match($('#spread .nutrition-kcal').textContent, /\d+\s*cal/);
  const labels = $$('#spread .nutri-name').map((e) => e.textContent);
  assert.ok(labels.includes('Protein') && labels.includes('Sodium'), 'macros listed');
  assert.ok($$('#spread .nutri-dv').some((e) => /\d+%/.test(e.textContent)), 'a %DV figure shows');
});

test('drinks also get a nutrition panel (calories from the spec)', async () => {
  const { $, $$ } = await boot('https://example.com/#drinks');
  $$('.card')[0].click();
  assert.ok($('#spread .nutrition'), 'drinks carry a nutrition estimate too');
  assert.match($('#spread .nutrition-kcal').textContent, /\d+\s*cal/);
});

test('the nutrition panel carries the eating-plan fit table with linked plans', async () => {
  const { $, $$ } = await boot();
  $$('.card')[0].click();
  const plans = $('#spread .nutrition .plans');
  assert.ok(plans, 'the eating-plan fit table renders inside the nutrition section');
  const rows = $$('#spread .plan-row');
  assert.equal(rows.length, EATING_PLANS.length, 'one row per plan');
  for (const row of rows) {
    const a = row.querySelector('.plan-name a');
    assert.match(a.href, /^https:\/\//, 'every plan links to more information');
    assert.equal(a.target, '_blank');
    assert.ok(row.querySelector('.plan-icon').textContent.trim(), 'every plan shows its icon');
    assert.match(row.querySelector('.plan-fit').textContent, /Great fit|Okay|Poor fit/);
  }
});

test('the Good-for filter cycles off → friendly → great-only → off and badges cards', async () => {
  const { $, $$, app } = await boot();
  const verdicts = buildPlanVerdicts(foodRecipes);
  const chip = $$('.chip').find((c) => c.dataset.key === 'plan' && c.dataset.val === 'kidney');
  assert.ok(chip, 'a Good-for chip renders for the kidney plan');
  const all = $$('.card').length;

  chip.click();                                        // tap 1: great + okay
  const friendly = foodRecipes.filter((r) => verdicts.get(r.slug).kidney !== 'avoid').length;
  assert.equal($$('.card').length, friendly, 'poor fits are hidden');
  assert.equal(chip.getAttribute('aria-pressed'), 'true');
  assert.ok($$('.tag-plan').length > 0, 'visible cards carry the contextual verdict badge');

  chip.click();                                        // tap 2: great only
  const great = foodRecipes.filter((r) => verdicts.get(r.slug).kidney === 'optimal').length;
  assert.equal($$('.card').length, great, 'strict mode keeps only great fits');
  assert.ok(chip.classList.contains('is-strict'));
  assert.ok($$('.tag-plan.is-great').length > 0, 'badges show the ✓ tier');

  chip.click();                                        // tap 3: off
  assert.equal($$('.card').length, all, 'third tap clears the plan filter');
  assert.equal(chip.getAttribute('aria-pressed'), 'false');
  assert.ok(!chip.classList.contains('is-strict'));
  assert.equal($$('.tag-plan').length, 0, 'badges vanish when no plan filter is active');
  assert.equal(app.state.filters.plan.size, 0);
});

test('plan filters AND together across two selected plans', async () => {
  const { $$ } = await boot();
  const verdicts = buildPlanVerdicts(foodRecipes);
  $$('.chip').find((c) => c.dataset.key === 'plan' && c.dataset.val === 'kidney').click();
  $$('.chip').find((c) => c.dataset.key === 'plan' && c.dataset.val === 'heart').click();
  const expected = foodRecipes.filter((r) => {
    const v = verdicts.get(r.slug);
    return v.kidney !== 'avoid' && v.heart !== 'avoid';
  }).length;
  assert.equal($$('.card').length, expected, 'both plans must fit (AND, not OR)');
});

test('the 1C variant toggle swaps ingredients, nutrition, and verdicts in place', async () => {
  const { $, $$ } = await boot('https://example.com/#/broiled-fish-citrus-herbs');
  const toggle = $('#spread .variant-toggle');
  assert.ok(toggle, 'a variant toggle renders for a recipe with planSwaps');
  const chips = $$('#spread .vchip');
  assert.equal(chips[0].textContent.trim(), 'As written');
  assert.ok(chips.length >= 2, 'at least one variant chip');
  assert.equal(chips[0].getAttribute('aria-pressed'), 'true', 'as-written is the default');
  const kcalBefore = $('#spread .nutrition-kcal').textContent;

  chips[1].click();
  const swapped = $$('#spread .ing-list li.is-swapped');
  assert.ok(swapped.length >= 1, 'the swapped ingredient line is highlighted');
  assert.match(swapped[0].textContent, /¾ cup orange juice/);
  assert.match(swapped[0].title, /as written/, 'tooltip keeps the original line');
  assert.notEqual($('#spread .nutrition-kcal').textContent, kcalBefore, 'nutrition switches to the variant');
  assert.ok($('#spread .nutrition-variant'), 'the panel is badged as a variant view');
  assert.ok(!$('#spread .plan-swap'), 'no ⇄ hints inside the variant view');
  const heartRow = $$('#spread .plan-row').find((row) => /AHA Heart/.test(row.textContent));
  assert.match(heartRow.querySelector('.plan-fit').textContent, /Okay/, 'the verdict chip reflects the variant');

  // The choice persists across leaving and reopening the recipe.
  $('#reader-close').click();
  $$('.card').find((c) => c.dataset.slug === 'broiled-fish-citrus-herbs').click();
  assert.equal($$('#spread .vchip')[1].getAttribute('aria-pressed'), 'true', 'variant persisted');

  $$('#spread .vchip')[0].click();                   // back to as-written
  assert.equal($$('#spread .ing-list li.is-swapped').length, 0);
  assert.ok(!$('#spread .nutrition-variant'));
});

test('the shopping list shops for the active variant', async () => {
  const { $, $$ } = await boot('https://example.com/#/broiled-fish-citrus-herbs');
  $$('#spread .vchip')[1].click();                   // apply the variant
  $('#spread .spread-select').click();               // add to the list
  $('#reader-close').click();
  $('#shopbar').click();
  assert.ok($('#shoplist .shop-variant'), 'the overlay marks the variant');
  const rows = $$('#shoplist .shop-qty').map((e) => e.textContent);
  assert.ok(rows.some((t) => /¾ cup orange juice/.test(t)), 'the swapped line is what gets shopped');
  assert.ok(!rows.some((t) => /1½ cups orange juice/.test(t)), 'the as-written line is replaced');
});

test('a plan-unfriendly recipe shows red-ringed icons in the nutrition flag column', async () => {
  // Find a shipped recipe that genuinely blows some plan's per-meal cap.
  const salty = recipes.recipes.find((r) =>
    evaluatePlans(r).some((e) => e.limits.some((l) => l.tier === 'avoid')));
  assert.ok(salty, 'the cookbook contains at least one plan-cap-busting dish');
  const { $, $$ } = await boot(`https://example.com/#/${salty.slug}`);
  assert.ok($$('#spread .plan-flag.is-avoid').length > 0, 'red-ringed plan icon rendered');
  const flag = $$('#spread .plan-flag.is-avoid')[0];
  assert.match(flag.title, /over the .*per-meal cap/, 'tooltip explains the breach');
  assert.ok(flag.closest('.nutri-row'), 'flags sit in the nutrition table rows');
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
