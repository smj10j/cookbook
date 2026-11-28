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
  // jsdom's Location.assign is a non-configurable, non-writable own property, so
  // it can't be shadowed via defineProperty or a Proxy get-trap (both violate the
  // proxy invariant for that kind of property) — and real navigation is
  // unimplemented in jsdom anyway. Stand in a plain object instead: reads for the
  // bits app.js actually uses forward live to the real location, and assign() is
  // captured rather than navigating.
  let navigatedTo = null;
  const realLoc = window.location;
  set('location', {
    get hash() { return realLoc.hash; },
    get pathname() { return realLoc.pathname; },
    get search() { return realLoc.search; },
    get origin() { return realLoc.origin; },
    get href() { return realLoc.href; },
    assign: (u) => { navigatedTo = u; },
  });
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
  // jsdom has no layout, so window.scrollY is a read-only 0 and scrollTo is
  // unimplemented (it logs noise). Stand in a settable scrollY + a recording
  // scrollTo so tests can drive and assert scroll-preservation behavior.
  let scrollY = 0;
  const scrollCalls = [];
  Object.defineProperty(window, 'scrollY', { get: () => scrollY, configurable: true });
  window.scrollTo = (x, y) => { scrollCalls.push([x, y]); scrollY = y; };
  const app = await import(`../docs/app.js?b=${bootCount++}`);
  await app.init();
  const $ = (s) => window.document.querySelector(s);
  const $$ = (s) => [...window.document.querySelectorAll(s)];
  return {
    window, doc: window.document, app, $, $$,
    getCopied: () => copied, getNavigated: () => navigatedTo,
    setScrollY: (y) => { scrollY = y; }, getScrollCalls: () => scrollCalls,
  };
}

const foodRecipes = recipes.recipes.filter((r) => (r.kind || 'food') === 'food');
// The Food home is grouped into shelves; '#food?all=1' is the flat "everything in one
// list" view, for tests that need every recipe's card on screen.
const FLAT = 'https://example.com/#food?all=1';
// The list opens grouped by aisle; tests that inspect each dish's own lines switch to "By recipe".
const byRecipe = ($) => $('#shop-mode [data-shopmode="recipe"]').click();
const drinkRecipes = recipes.recipes.filter((r) => r.kind === 'drink');

test('boots into Food shelves: every food recipe sits on exactly one shelf; show-all flattens', async () => {
  const { $, $$, app } = await boot();
  assert.equal(app.state.all.length, recipes.count, 'state holds food + drinks');
  assert.ok($('#menu').classList.contains('is-shelves'), 'the unfiltered Food home is shelves');
  const counts = $$('.shelf .shelf-count').map((e) => +e.textContent);
  assert.equal(counts.reduce((x, y) => x + y, 0), foodRecipes.length, 'shelf counts add up to every food recipe');
  assert.ok($$('.fresh-card').length > 0, 'a Just added photo row leads the page');
  $('#show-all').click();
  assert.equal($$('.card').length, foodRecipes.length, 'one card per food recipe in the flat list');
  assert.equal(app.state.showAll, true);
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

test('the "In cart" filter shows only selected recipes and prunes as you remove them', async () => {
  const { $, $$, app } = await boot(FLAT);
  // Hidden until something is in the cart.
  assert.equal($('#cart-filter').hidden, true, 'no cart toggle on an empty cart');
  // Select two specific recipes.
  const slugs = foodRecipes.slice(0, 2).map((r) => r.slug);
  slugs.forEach((s) => $$('.card-select').find((b) => b.dataset.select === s).click());
  const cf = $('#cart-filter');
  assert.equal(cf.hidden, false, 'toggle appears once the section has cart items');
  assert.equal($('#cart-filter-count').textContent, '2');
  // Turn the cart view on — only the two selected cards remain.
  cf.click();
  assert.equal(app.state.cartOnly, true);
  assert.equal(cf.getAttribute('aria-pressed'), 'true');
  assert.equal($$('.card').length, 2, 'grid narrows to the cart');
  assert.deepEqual($$('.card').map((c) => c.dataset.slug).sort(), [...slugs].sort());
  // Remove one from within the cart view — it drops out of the grid immediately.
  $$('.card-select').find((b) => b.dataset.select === slugs[0]).click();
  assert.equal($$('.card').length, 1, 'removed recipe leaves the cart view');
  assert.equal($$('.card')[0].dataset.slug, slugs[1]);
  assert.equal($('#cart-filter-count').textContent, '1');
  // Remove the last one — the view collapses back to the full grid and the toggle hides.
  $$('.card-select').find((b) => b.dataset.select === slugs[1]).click();
  assert.equal(app.state.cartOnly, false, 'cartOnly clears when the cart empties');
  assert.equal($('#cart-filter').hidden, true);
  assert.equal($$('.card').length, foodRecipes.length, 'grid returns to all recipes');
});

test('removing a cart item in the "In cart" view keeps the scroll position', async () => {
  const { $, $$, app, setScrollY, getScrollCalls } = await boot(FLAT);
  const slugs = foodRecipes.slice(0, 3).map((r) => r.slug);
  slugs.forEach((s) => $$('.card-select').find((b) => b.dataset.select === s).click());
  $('#cart-filter').click();
  assert.equal(app.state.cartOnly, true);
  // Reader has scrolled down the cart list.
  setScrollY(640);
  const before = getScrollCalls().length;
  // Remove one while others remain: the grid re-renders, but scroll is pinned so the
  // page doesn't snap toward the top.
  $$('.card-select').find((b) => b.dataset.select === slugs[0]).click();
  assert.equal(app.state.cartOnly, true, 'still in the cart view');
  assert.equal($$('.card').length, 2, 'removed card left the grid');
  assert.deepEqual(getScrollCalls().slice(before).at(-1), [0, 640], 'scroll restored to where it was');
  // Take the cart down to its last item (still cartOnly), then remove that last one —
  // the view falls back to the full grid and must NOT pin the stale scroll position.
  $$('.card-select').find((b) => b.dataset.select === slugs[1]).click();
  assert.equal(app.state.cartOnly, true, 'one item left keeps the cart view');
  setScrollY(999);
  const beforeEmpty = getScrollCalls().length;
  $$('.card-select').find((b) => b.dataset.select === slugs[2]).click();
  assert.equal(app.state.cartOnly, false, 'cart emptied -> back to full grid');
  assert.ok(
    !getScrollCalls().slice(beforeEmpty).some((c) => c[1] === 999),
    'no scroll pinning when the cart empties and the full grid returns',
  );
});

test('"In cart" toggle is per-section and clears with Clear filters', async () => {
  const { $, $$, app } = await boot(FLAT);
  $$('.card-select')[0].click();               // one food recipe in the cart
  $('#cart-filter').click();
  assert.equal(app.state.cartOnly, true);
  assert.equal($('#clear-filters').hidden, false, 'cart view counts as an active filter');
  // Switching to Drinks (no drinks in cart) hides the toggle and shows the full drink set.
  $$('#tabs .tab').find((t) => t.dataset.kind === 'drink').click();
  assert.equal($('#cart-filter').hidden, true, 'no toggle when this section has no cart items');
  assert.equal($$('.card').length, drinkRecipes.length);
  // Back on Food, re-enable and confirm Clear filters resets it.
  $$('#tabs .tab').find((t) => t.dataset.kind === 'food').click();
  $('#cart-filter').click();
  assert.equal(app.state.cartOnly, true);
  $('#clear-filters').click();
  assert.equal(app.state.cartOnly, false, 'Clear filters turns the cart view off');
  assert.equal($('#cart-filter').getAttribute('aria-pressed'), 'false');
  assert.ok($('#menu').classList.contains('is-shelves'), 'with nothing active, Food is back to its shelves');
});

test('REGRESSION: selecting EVERY visible card renders a non-empty list (no crash)', async () => {
  const { $, $$, app } = await boot(FLAT);
  $$('.card-select').forEach((b) => b.click());      // every FOOD card on the default tab
  assert.equal(app.state.selected.size, foodRecipes.length);
  $('#shopbar').click();                       // open the overlay
  assert.equal($('#shoplist').hidden, false);
  assert.ok($$('.aisle').length > 3, 'the default view groups everything by aisle');
  byRecipe($);
  const body = $('#shoplist-body').textContent;
  assert.ok(!/No recipes selected/.test(body), 'overlay must not be empty');
  assert.equal($$('.shop-recipe').length, foodRecipes.length, 'one block per selected recipe');
  // total rows == total ingredient lines across the selected recipes
  const totalLines = foodRecipes.reduce((n, r) => n + r.ingredients.reduce((m, s) => m + s.items.length, 0), 0);
  assert.equal($$('.shop-item').length, totalLines);
});

test('REGRESSION: Clear Selection truly clears (no stale items reappear)', async () => {
  const { $, $$, app } = await boot(FLAT);
  // select three, open, then clear
  $$('.card-select').slice(0, 3).forEach((b) => b.click());
  $('#shopbar').click();
  byRecipe($);
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
  const { $, $$ } = await boot(FLAT);
  // pick the blackened steak salad (known to contain salt/oil/paprika/balsamic + produce)
  const card = $$('.card-select').find((b) => b.dataset.select === 'blackened-steak-salad');
  card.click();
  $('#shopbar').click();
  byRecipe($);
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

test('each dish has its own servings stepper that rescales its lines (and is remembered)', async () => {
  const { $, $$, window } = await boot(FLAT);
  $$('.card-select').find((b) => b.dataset.select === 'blackened-steak-salad').click();
  $('#shopbar').click();
  byRecipe($);
  const qty = () => $$('.shop-item').find((el) => el.textContent.includes('sirloin')).querySelector('.shop-qty').textContent;
  assert.match(qty(), /^1 lb/, 'defaults to the recipe\'s own 2 servings');
  assert.equal($('.week-serves-n').textContent, '2');
  $('.week-serves [data-serves="1"]').click();
  $('.week-serves [data-serves="1"]').click();
  assert.equal($('.week-serves-n').textContent, '4');
  assert.match(qty(), /^2 lb/, 'doubled for 4 servings');
  assert.match($('.shop-recipe-serves').textContent, /scaled from 2 to 4/);
  assert.deepEqual(JSON.parse(window.localStorage.getItem('tm-servings')), { 'blackened-steak-salad': 4 });
});

test('copy: merges duplicates, excludes staples, formats as a dash list', async () => {
  const { $, $$, getCopied } = await boot(FLAT);
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
  const { $, $$, getCopied } = await boot(FLAT);
  $$('.card-select')[0].click();
  $('#shopbar').click();
  $('#format-toggle .fmt-btn[data-format="checkbox"]').click();
  $('#shop-copy').click();
  await Promise.resolve();
  const text = getCopied();
  assert.ok(text.split('\n').some((l) => l.startsWith('- [ ] ')), 'checklist lines present');
});

test('iOS "Add to Reminders" controls stay hidden on a non-iOS UA (no clutter for other users)', async () => {
  const { $ } = await boot();
  assert.equal($('#ios-reminders').hidden, true, 'reminders row hidden by default test/Node UA');
});

test('Add to Reminders sends checked items to the Shortcut via shortcuts:// deep link', async () => {
  const { $, $$, getNavigated } = await boot(FLAT);
  $$('.card-select').find((b) => b.dataset.select === 'blackened-steak-salad').click();
  $('#shopbar').click();
  $('#ios-reminders').hidden = false;   // simulate iOS — visibility itself is covered by the UA test above
  $('#shop-reminders').click();
  const url = getNavigated();
  assert.ok(url && url.startsWith('shortcuts://run-shortcut?'), 'navigates to a shortcuts:// deep link');
  assert.ok(url.includes(encodeURIComponent('Add to Groceries')), 'names the exact Shortcut to run');
  assert.ok(/[?&]input=text/.test(url), 'passes the list as text input');
  const text = decodeURIComponent(url.split('text=')[1]);
  assert.ok(!text.includes('- '), 'plain format has no bullets — one line per reminder');
  assert.ok(/sirloin/i.test(text), 'includes a checked ingredient');
});

test('Add to Reminders flashes "Nothing checked" instead of navigating when nothing is checked', async () => {
  const { $, $$, getNavigated } = await boot(FLAT);
  $$('.card-select').find((b) => b.dataset.select === 'blackened-steak-salad').click();
  $('#shopbar').click();
  byRecipe($);
  $$('.shop-item input[type=checkbox]').forEach((cb) => { if (cb.checked) cb.click(); });
  $('#ios-reminders').hidden = false;
  $('#shop-reminders').click();
  assert.equal(getNavigated(), null, 'no navigation when nothing is checked');
  assert.equal($('#shop-copied').textContent, 'Nothing checked');
});

test('Share… falls back to clipboard copy when the Web Share API is unavailable', async () => {
  const { $, $$, getCopied } = await boot(FLAT);
  $$('.card-select').find((b) => b.dataset.select === 'blackened-steak-salad').click();
  $('#shopbar').click();
  $('#ios-reminders').hidden = false;
  $('#shop-share').click();
  await Promise.resolve();
  const text = getCopied();
  assert.ok(text && /sirloin/i.test(text), 'shared/copied text includes a checked ingredient');
  assert.ok(!text.includes('- '), 'plain format has no bullets');
});

test('Add to Reminders help panel opens and closes', async () => {
  const { $ } = await boot();
  assert.equal($('#reminders-help').hidden, true);
  $('#shop-reminders-help').click();
  assert.equal($('#reminders-help').hidden, false);
  $('#reminders-help-close').click();
  assert.equal($('#reminders-help').hidden, true);
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
  const { $, $$, app } = await boot(FLAT);
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
  const { $, $$, window } = await boot('https://example.com/#/broiled-fish-citrus-herbs');
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
  window.location.hash = '#/broiled-fish-citrus-herbs';
  window.dispatchEvent(new window.Event('hashchange'));
  assert.equal($$('#spread .vchip')[1].getAttribute('aria-pressed'), 'true', 'variant persisted');

  $$('#spread .vchip')[0].click();                   // back to as-written
  assert.equal($$('#spread .ing-list li.is-swapped').length, 0);
  assert.ok(!$('#spread .nutrition-variant'));
});

test('variant chips are ADDITIVE: selecting two applies both swap sets', async () => {
  // blackened-steak-salad has two disjoint chips: 🍬 (honey) and ⚖️ (steak + oil).
  const { $, $$ } = await boot('https://example.com/#/blackened-steak-salad');
  const chips = $$('#spread .vchip').filter((c) => c.dataset.variant);
  assert.ok(chips.length >= 2, 'two combinable chips render');
  chips[0].click();
  const oneSwap = $$('#spread .ing-list li.is-swapped').length;
  $$('#spread .vchip').filter((c) => c.dataset.variant)[1].click();
  const bothSwaps = $$('#spread .ing-list li.is-swapped').length;
  assert.ok(bothSwaps > oneSwap, `both chips' swaps apply together (${oneSwap} → ${bothSwaps})`);
  const pressed = $$('#spread .vchip').filter((c) => c.getAttribute('aria-pressed') === 'true');
  assert.equal(pressed.length, 2, 'both chips stay selected');
  assert.equal($$('#spread .vchip')[0].getAttribute('aria-pressed'), 'false', 'As written is off');
  assert.ok($('#spread .nutrition-variant'), 'panel badges the combined variant');
  // deselecting one chip drops back to the other alone
  $$('#spread .vchip').filter((c) => c.dataset.variant)[0].click();
  assert.equal($$('#spread .ing-list li.is-swapped').length, bothSwaps - oneSwap);
  // "As written" clears everything
  $$('#spread .vchip')[0].click();
  assert.equal($$('#spread .ing-list li.is-swapped').length, 0);
});

test('the shopping list shops for the active variant', async () => {
  const { $, $$ } = await boot('https://example.com/#/broiled-fish-citrus-herbs');
  $$('#spread .vchip')[1].click();                   // apply the variant
  $('#spread .spread-select').click();               // add to the list
  $('#reader-close').click();
  $('#shopbar').click();
  assert.ok($('#shoplist .shop-variant'), 'the overlay marks the variant');
  byRecipe($);
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
  assert.match(flag.title, /over its .*-per-meal max/, 'tooltip explains the breach');
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

test('search autocomplete: typing shows ≤5 section-scoped suggestions; a click opens the recipe', async () => {
  const { $, $$, window } = await boot();
  const input = $('#search');
  input.value = 'a';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  const box = $('#search-suggest');
  assert.equal(box.hidden, false, 'dropdown opens on input');
  const rows = $$('#search-suggest .suggest-item');
  assert.ok(rows.length > 0 && rows.length <= 5, 'between 1 and 5 suggestions');
  assert.equal(input.getAttribute('aria-expanded'), 'true');
  // Every suggestion is a FOOD recipe (the active section), never a drink.
  const foodSlugs = new Set(foodRecipes.map((r) => r.slug));
  rows.forEach((row) => assert.ok(foodSlugs.has(row.dataset.slug), 'suggestions stay in the food section'));
  // Choosing one (mousedown, which fires before blur) opens that recipe.
  const slug = rows[0].dataset.slug;
  rows[0].dispatchEvent(new window.Event('mousedown', { bubbles: true }));
  assert.equal($('#reader').hidden, false, 'choosing a suggestion opens the reader');
  assert.match(window.location.hash, new RegExp(`#/${slug}$`), 'reader routes to the chosen recipe');
  assert.equal(box.hidden, true, 'dropdown closes after choosing');
});

test('search autocomplete: Drinks suggestions never leak Food recipes', async () => {
  const { $, $$, window } = await boot('https://example.com/#drinks');
  const input = $('#search');
  input.value = 'a';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  const rows = $$('#search-suggest .suggest-item');
  assert.ok(rows.length > 0, 'drinks produce suggestions too');
  const drinkSlugs = new Set(drinkRecipes.map((r) => r.slug));
  rows.forEach((row) => assert.ok(drinkSlugs.has(row.dataset.slug), 'only drinks are suggested on the Drinks tab'));
});

test('search autocomplete: switching sections clears the query and closes the dropdown', async () => {
  const { $, $$, window } = await boot();
  const input = $('#search');
  input.value = 'a';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.ok($$('#search-suggest .suggest-item').length > 0);
  $$('#tabs .tab').find((t) => t.dataset.kind === 'drink').click();
  assert.equal($('#search-suggest').hidden, true, 'dropdown closes on section switch');
  assert.equal(input.value, '', 'search resets for the new section');
});

test('search autocomplete: arrow keys move the highlight and Enter opens it', async () => {
  const { $, $$, window } = await boot();
  const input = $('#search');
  input.value = 'a';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  const rows = $$('#search-suggest .suggest-item');
  assert.ok(rows.length >= 2, 'need at least two suggestions to navigate');
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.ok(rows[0].classList.contains('is-active'), 'first ArrowDown highlights row 0');
  assert.equal(input.getAttribute('aria-activedescendant'), 'suggest-0');
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.ok(rows[1].classList.contains('is-active') && !rows[0].classList.contains('is-active'), 'moves to row 1');
  const slug = rows[1].dataset.slug;
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal($('#reader').hidden, false, 'Enter opens the highlighted recipe');
  assert.match(window.location.hash, new RegExp(`#/${slug}$`));
});

test('search autocomplete: Escape closes the dropdown without opening a recipe', async () => {
  const { $, $$, window } = await boot();
  const input = $('#search');
  input.value = 'a';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal($('#search-suggest').hidden, false);
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal($('#search-suggest').hidden, true, 'Escape hides the list');
  assert.equal($('#reader').hidden, true, 'and does not open a recipe');
});

// ── Round 1 presentation: menu list, sort, URL state, filter sheet, pills, chrome ──
const byNewest = (list) => [...list].sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')) || a.title.localeCompare(b.title));

test('the menu opens as a printed list, newest first; the layout toggle switches to photos and persists', async () => {
  const { $, $$, window } = await boot(FLAT);
  assert.ok($('#menu').classList.contains('is-list'), 'list view by default');
  assert.deepEqual($$('.card').slice(0, 5).map((c) => c.dataset.slug), byNewest(foodRecipes).slice(0, 5).map((r) => r.slug));
  assert.ok($$('.card .leader').length > 0, 'menu rows carry dotted leaders');
  $$('#view-toggle .view-btn').find((b) => b.dataset.view === 'grid').click();
  assert.ok($('#menu').classList.contains('is-grid') && !$('#menu').classList.contains('is-list'));
  assert.equal(window.localStorage.getItem('tm-view'), 'grid');
});

test('every card and the open recipe carry their lane colour class', async () => {
  const { $, $$ } = await boot(FLAT);
  assert.ok($$('.card-wrap').every((w) => /\blane-(fish|chicken|beef|veg|sides|dessert)\b/.test(w.className)));
  $$('.card').find((c) => c.dataset.slug === 'blackened-steak-salad').click();
  assert.ok($('#spread').classList.contains('lane-beef'), 'the spread picks up the beef lane');
});

test('sort: Quickest reorders by total time and the reader pages in that order', async () => {
  const { $, $$, window } = await boot(FLAT);
  const sel = $('#sort');
  sel.value = 'quickest';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  const totals = $$('.card').map((c) => foodRecipes.find((r) => r.slug === c.dataset.slug).times.total);
  assert.deepEqual(totals, [...totals].sort((a, b) => a - b), 'cards ascend by total time');
  assert.equal(window.location.hash, '#food?all=1&sort=quickest', 'a non-default sort is in the URL');
  $$('.card')[0].click();
  $('#reader-next').click();
  assert.equal(window.location.hash, `#/${$$('.card')[1].dataset.slug}`, 'next follows the sorted menu');
});

test('filters live in the URL: chips write it, closing a recipe restores it, booting reads it', async () => {
  const { $, $$, window } = await boot();
  $$('.chip').find((c) => c.dataset.key === 'protein' && c.dataset.val === 'beef').click();
  assert.equal(window.location.hash, '#food?protein=beef');
  $$('.card')[0].click();
  assert.match(window.location.hash, /^#\//);
  $('#reader-close').click();
  assert.equal(window.location.hash, '#food?protein=beef', 'closing returns to the filtered menu');

  const b = await boot('https://example.com/#food?protein=beef&sort=az');
  assert.ok(b.app.state.filters.protein.has('beef'));
  assert.equal(b.app.state.sort, 'az');
  assert.equal(b.$('#sort').value, 'az');
  assert.ok(b.$$('.card').length > 0 && b.app.state.filtered.every((r) => r.protein === 'beef'));
  assert.equal(b.$$('.chip').find((c) => c.dataset.key === 'protein' && c.dataset.val === 'beef').getAttribute('aria-pressed'), 'true');
  const titles = b.app.state.filtered.map((r) => r.title);
  assert.deepEqual(titles, [...titles].sort((x, y) => x.localeCompare(y)), 'A–Z order from the URL');
});

test('a shared link with a strict plan filter and a search restores both', async () => {
  const { app, $ } = await boot('https://example.com/#food?plan=kidney!&q=salmon');
  assert.equal(app.state.filters.plan.get('kidney'), 'great');
  assert.equal(app.state.q, 'salmon');
  assert.equal($('#search').value, 'salmon');
  assert.ok(app.state.filtered.every((r) => app.state.planVerdicts.get(r.slug).kidney === 'optimal'));
});

test('active filters show as removable pills and a Filters badge', async () => {
  const { $, $$, app } = await boot();
  assert.equal($('#filters-count').hidden, true, 'no badge with nothing active');
  $$('.chip').find((c) => c.dataset.key === 'protein' && c.dataset.val === 'chicken').click();
  $$('.chip').find((c) => c.dataset.key === 'time' && c.dataset.val === 'under-30').click();
  assert.equal($('#filters-count').hidden, false);
  assert.equal($('#filters-count').textContent, '2');
  const pills = $$('#active-filters .pill');
  assert.deepEqual(pills.map((p) => p.dataset.val), ['chicken', 'under-30']);
  assert.match(pills[1].textContent, /Under 30 min/, 'pills use human labels');
  pills[0].click();
  assert.equal(app.state.filters.protein.size, 0, 'tapping a pill removes that filter');
  assert.equal($$('.chip').find((c) => c.dataset.val === 'chicken').getAttribute('aria-pressed'), 'false', 'and un-presses its chip');
  assert.equal($$('#active-filters .pill').length, 1);
});

test('the filter sheet opens from the toolbar, shows a live count, and closes on Done / scrim / Escape', async () => {
  const { $, $$, window } = await boot();
  const toggle = $('#filters-toggle');
  assert.equal($('#filter-panel').hidden, true, 'closed by default');
  toggle.click();
  assert.equal($('#filter-panel').hidden, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  $$('.chip').find((c) => c.dataset.key === 'protein' && c.dataset.val === 'beef').click();
  const beef = foodRecipes.filter((r) => r.protein === 'beef').length;
  assert.equal($('#filters-done').textContent, `Show ${beef} recipes`);
  $('#filters-done').click();
  assert.equal($('#filter-panel').hidden, true);
  toggle.click();
  $('#filter-scrim').click();
  assert.equal($('#filter-panel').hidden, true, 'scrim closes it');
  toggle.click();
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal($('#filter-panel').hidden, true, 'Escape closes it');
});

test('Occasion chips filter food by tag; one-off cuisines wait behind "More"', async () => {
  const { $, $$, app } = await boot();
  const occ = $$('.chip').find((c) => c.dataset.key === 'tags' && c.dataset.val === 'weeknight');
  assert.ok(occ, 'a Weeknight occasion chip exists');
  occ.click();
  assert.ok(app.state.filtered.length > 0 && app.state.filtered.every((r) => r.tags.includes('weeknight')));
  const more = $('.chip-more');
  assert.ok(more, 'singleton cuisines are folded behind More');
  const before = $$('.chip').filter((c) => c.dataset.key === 'cuisine').length;
  more.click();
  assert.ok($$('.chip').filter((c) => c.dataset.key === 'cuisine').length > before, 'More reveals the rest');
  assert.equal($('.chip-more'), null);
});

test('first visit shows "How this works"; dismissing it sticks, the ⓘ brings it back', async () => {
  const { $, window } = await boot();
  assert.equal($('#intro').hidden, false, 'shown on a first visit');
  $('#intro-dismiss').click();
  assert.equal($('#intro').hidden, true);
  assert.equal(window.localStorage.getItem('tm-intro-seen'), '1');
  $('#intro-toggle').click();
  assert.equal($('#intro').hidden, false, 'ⓘ reopens it');
});

test('the theme toggle flips to paper and back, and remembers the choice', async () => {
  const { $, window } = await boot();
  const root = window.document.documentElement;
  assert.equal(root.dataset.theme, undefined, 'dark by default');
  $('#theme-toggle').click();
  assert.equal(root.dataset.theme, 'paper');
  assert.equal(window.localStorage.getItem('tm-theme'), 'paper');
  $('#theme-toggle').click();
  assert.equal(root.dataset.theme, undefined);
  assert.equal(window.localStorage.getItem('tm-theme'), 'dark');
});


// ── Round 2: shelves ──
test('a shelf "See all" applies its filter (and URL); clearing returns to the shelves', async () => {
  const { $, $$, app, window } = await boot();
  $$('.shelf-all').find((b) => b.dataset.shelf === 'beef').click();
  const beefMains = foodRecipes.filter((r) => r.protein === 'beef' && r.category === 'main');
  assert.equal($$('.card').length, beefMains.length, 'every beef main, as a flat list');
  assert.ok(!$('#menu').classList.contains('is-shelves'));
  assert.equal(window.location.hash, '#food?category=main&protein=beef');
  $('#clear-filters').click();
  assert.ok($('#menu').classList.contains('is-shelves'));
  assert.equal(app.state.filters.protein.size, 0);
});

test('the reader pages through the shelves in on-screen order; Just added cards open recipes', async () => {
  const { $, $$, app, window } = await boot();
  const order = app.state.displayList.map((r) => r.slug);
  const fish = $$('.shelf.lane-fish .card').map((c) => c.dataset.slug);
  assert.deepEqual(order.slice(0, fish.length), fish, 'shelf order leads the reader list');
  $$('.shelf.lane-fish .card')[0].click();
  $('#reader-next').click();
  assert.equal(window.location.hash, `#/${order[1]}`);
  $('#reader-close').click();
  const fresh = $$('.fresh-card')[0];
  fresh.click();
  assert.equal($('#reader').hidden, false);
  assert.equal(window.location.hash, `#/${fresh.dataset.slug}`);
});

test('"All in one list" shows as a pill and returns to the shelves; Drinks never shelve', async () => {
  const { $, $$ } = await boot(FLAT);
  const pill = $$('#active-filters .pill').find((p) => p.dataset.key === 'all');
  assert.ok(pill, 'the flat view is announced as a removable pill');
  pill.click();
  assert.ok($('#menu').classList.contains('is-shelves'));
  $$('#tabs .tab').find((t) => t.dataset.kind === 'drink').click();
  assert.ok(!$('#menu').classList.contains('is-shelves'), 'drinks stay one flat list');
  assert.equal($$('.card').length, drinkRecipes.length);
});


// ── Round 3: the recipe as a cooking tool ──
test('the reader has jump tabs, and its controls sit in a bar under the page (not over the text)', async () => {
  const { $, $$ } = await boot('https://example.com/#/blackened-steak-salad');
  const tabs = $$('#spread .spread-tab');
  assert.deepEqual(tabs.map((t) => t.textContent), ['About', 'Ingredients', 'Method', 'Nutrition']);
  assert.equal(tabs[0].getAttribute('aria-current'), 'true');
  tabs[2].click();
  assert.equal($$('#spread .spread-tab')[2].getAttribute('aria-current'), 'true', 'the tapped tab becomes current');
  for (const id of ['#reader-prev', '#reader-next', '#reader-share', '#cook-open']) {
    assert.ok($(id).closest('.reader-bar'), `${id} lives in the reader bar`);
  }
});

test('variant chips read in words and explain what changes', async () => {
  const { $, $$ } = await boot('https://example.com/#/blackened-steak-salad');
  const chips = $$('#spread .vchip').filter((c) => c.dataset.variant);
  assert.ok(chips.every((c) => !/\p{Extended_Pictographic}/u.test(c.textContent)), 'no emoji-only chips');
  assert.ok(chips.some((c) => /Low Sugar/.test(c.textContent)));
  assert.equal($('#spread .variant-note'), null, 'no note while As written');
  chips.find((c) => /Low Sugar/.test(c.textContent)).click();
  assert.match($('#spread .variant-note').textContent, /^What changes: .*honey/);
});

test('Cook mode: big-type checklist that ticks ingredients and walks the steps', async () => {
  const { $, $$, window } = await boot('https://example.com/#/blackened-steak-salad');
  let wakeRequested = 0;
  const lock = { release() {}, addEventListener() {} };
  try { Object.defineProperty(globalThis.navigator, 'wakeLock', { value: { request: async () => { wakeRequested++; return lock; } }, configurable: true }); } catch {}
  $('#cook-open').click();
  assert.equal($('#cook').hidden, false);
  assert.match($('#cook-title').textContent, /Blackened Steak Salad/);
  assert.ok($('#cook').classList.contains('lane-beef'));
  assert.ok($('#cook').classList.contains('pane-ing'), 'a fresh recipe starts on the ingredients');
  if (globalThis.navigator?.wakeLock) assert.equal(wakeRequested, 1, 'asks the screen to stay awake');
  const items = $$('#cook .cook-item');
  assert.ok(items.length > 10);
  items[0].click();
  assert.equal($$('#cook .cook-item')[0].getAttribute('aria-pressed'), 'true', 'tap ticks an ingredient');
  $('#cook .cook-start').click();
  assert.ok($('#cook').classList.contains('pane-steps'));
  const firstCurrent = $('#cook .cook-step.is-current');
  assert.equal(firstCurrent.dataset.s, '0', 'step 1 is highlighted first');
  firstCurrent.click();
  assert.equal($('#cook .cook-step.is-current').dataset.s, '1', 'ticking a step moves the highlight on');
  assert.match($('#cook-progress').textContent, /^1\//);
  // Escape leaves Cook mode but keeps the recipe open; ticks survive a reopen.
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal($('#cook').hidden, true);
  assert.equal($('#reader').hidden, false, 'still on the recipe');
  $('#cook-open').click();
  assert.ok($('#cook').classList.contains('pane-steps'), 'resumes where you were');
  assert.equal($('#cook .cook-step.is-current').dataset.s, '1');
  $('#cook [data-reset]').click();
  assert.equal($$('#cook .cook-step[aria-pressed="true"]').length, 0, 'reset clears the ticks');
  try { delete globalThis.navigator.wakeLock; } catch {}
});

test('Cook mode cooks the active variant', async () => {
  const { $, $$ } = await boot('https://example.com/#/broiled-fish-citrus-herbs');
  $$('#spread .vchip')[1].click();
  $('#cook-open').click();
  assert.ok($$('#cook .cook-item.is-swapped').some((i) => /¾ cup orange juice/.test(i.textContent)));
  assert.equal($('#cook-variant').hidden, false);
});


// ── Round 4: This week + aisle shopping ──
test('This week lists the picked dishes; the aisle view merges shared items and ticks every source line', async () => {
  const { $, $$ } = await boot(FLAT);
  for (const slug of ['blackened-steak-salad', 'chicken-piccata']) $$('.card-select').find((b) => b.dataset.select === slug).click();
  $('#shopbar').click();
  assert.match($('#shopbar').textContent, /This week/);
  assert.equal($$('#week-list .week-item').length, 2, 'one row per picked dish');
  assert.equal($('#shop-mode [data-shopmode="aisle"]').getAttribute('aria-pressed'), 'true', 'aisle view by default');
  const heads = $$('.aisle-h').map((h) => h.firstChild.textContent.trim());
  assert.equal(heads[0], 'Produce', 'store order starts in produce');
  const garlic = $$('.shop-line').find((l) => /garlic/i.test(l.textContent));
  assert.ok(garlic, 'garlic appears once');
  assert.match(garlic.textContent, /2 dishes/);
  assert.equal($$('.shop-line').filter((l) => /garlic/i.test(l.textContent)).length, 1);
  const cb = garlic.querySelector('input');
  if (cb.checked) cb.click();                         // untick in the aisle view…
  byRecipe($);                                        // …and both dishes' garlic lines follow
  const garlicRows = $$('.shop-item').filter((el) => /garlic/i.test(el.textContent));
  assert.ok(garlicRows.length >= 2);
  assert.ok(garlicRows.every((el) => !el.querySelector('input').checked));
});

test('copying from This week lists items in store order', async () => {
  const { $, $$, getCopied } = await boot(FLAT);
  for (const slug of ['blackened-steak-salad', 'classic-daiquiri']) {
    const b = $$('.card-select').find((x) => x.dataset.select === slug);
    if (b) b.click();
  }
  $$('#tabs .tab').find((t) => t.dataset.kind === 'drink').click();
  $$('.card-select').find((x) => x.dataset.select === 'classic-daiquiri').click();
  $('#shopbar').click();
  $('#shop-copy').click();
  await Promise.resolve();
  const lines = getCopied().split('\n');
  const idx = (re) => lines.findIndex((l) => re.test(l));
  assert.ok(idx(/greens|tomato/i) >= 0 && idx(/sirloin/i) > idx(/greens|tomato/i), 'produce before meat');
  assert.ok(idx(/rum/i) > idx(/sirloin/i), 'the bar comes last');
});

test('the week list removes a dish, opens a dish, and remembers the grouping choice', async () => {
  const { $, $$, app, window } = await boot(FLAT);
  const slugs = foodRecipes.slice(0, 2).map((r) => r.slug);
  slugs.forEach((s) => $$('.card-select').find((b) => b.dataset.select === s).click());
  $('#shopbar').click();
  byRecipe($);
  assert.equal(window.localStorage.getItem('tm-shopmode'), 'recipe');
  $(`.week-remove[data-remove="${slugs[0]}"]`).click();
  assert.ok(!app.state.selected.has(slugs[0]), 'removed from the week');
  assert.equal($$('#week-list .week-item').length, 1);
  assert.equal($$('.shop-recipe').length, 1);
  $(`.week-open[data-open="${slugs[1]}"]`).click();
  assert.equal($('#shoplist').hidden, true, 'the list closes…');
  assert.equal(window.location.hash, `#/${slugs[1]}`, '…and the dish opens');
  $('#reader-cart').click();
  $(`.week-remove[data-remove="${slugs[1]}"]`).click();
  assert.equal($('#shoplist').hidden, true, 'removing the last dish closes the panel');
  assert.equal(app.state.selected.size, 0);
});

test('the list explains itself behind ⓘ instead of a wall of text', async () => {
  const { $, $$ } = await boot(FLAT);
  $$('.card-select')[0].click();
  $('#shopbar').click();
  assert.equal($('#shop-note').hidden, true);
  $('#shop-help').click();
  assert.equal($('#shop-note').hidden, false);
  assert.equal($('#shop-help').getAttribute('aria-expanded'), 'true');
});

// ── Content guard: the redesign must never drop authored content ──
test('every recipe and drink renders all of its authored content in the reader', async () => {
  const { $, $$, window } = await boot();
  const lines = (secs) => (secs || []).reduce((n, s) => n + (s.items ? s.items.length : 1), 0);
  const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const r of recipes.recipes) {
    window.location.hash = `#/${r.slug}`;
    window.dispatchEvent(new window.Event('hashchange'));
    const where = r.slug;
    assert.equal($('#spread .spread-title').textContent, r.title, `${where}: title`);
    assert.equal($('#spread .spread-tagline').textContent, r.tagline, `${where}: tagline`);
    assert.ok($('#spread .spread-pitch').textContent.length > r.pitch.length * 0.8, `${where}: pitch`);
    if (/\*[^*]+\*/.test(r.pitch)) assert.ok($('#spread .spread-pitch em'), `${where}: the italic money line`);
    assert.equal($$('#spread .ing-list li').length, lines(r.ingredients), `${where}: every ingredient line`);
    assert.equal($$('#spread .step-list li').length, lines(r.steps), `${where}: every step`);
    assert.equal($$('#spread .tips-list li').length, (r.tips || []).length, `${where}: every tip`);
    assert.equal($$('#spread .extras dt').length, (r.extras || []).length, `${where}: every extra`);
    if (r.headnote) assert.ok($('#spread .spread-headnote'), `${where}: headnote`);
    if (r.source?.name) assert.match($('#spread .spread-source').textContent, new RegExp(reEsc(r.source.name)), `${where}: source credit`);
    if (r.photo) assert.ok(!$('#spread').textContent.includes(r.photo), `${where}: the photo: hint stays off the page`);
    assert.ok(!/undefined|NaN|\[object Object\]/.test($('#spread').textContent), `${where}: no template junk`);
  }
});
