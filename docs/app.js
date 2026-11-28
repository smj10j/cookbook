/* ===========================================================================
   Tonight's Menu — DOM wiring + rendering. Pure logic lives in lib.js (tested).
   Loaded as <script type="module">, so this runs after the DOM is parsed.
   =========================================================================== */
import {
  esc, inlineMd, cap, fmtMin,
  clampServes,
  formatShoppingList, recipeMatches, searchSuggestions, cuisineChipValues, proteinChipValues, shopSectionsForRecipe,
  hashForKind, parseHash, nutritionPanelHtml, EATING_PLANS, buildPlanVerdicts,
  encodeRouteQuery, decodeRouteQuery, activeFilterEntries, SORTS, sortRecipes, laneFor,
  FOOD_OCCASIONS, occasionLabel, splitCuisineChips, SHELVES, buildShelves, groupByAisle, buildAisleList,
  recipeVariants, applyVariantToSections, variantLabel, variantTitle, variantsConflict, combineVariants,
  isIOSSafari,
} from './lib.js';

// Must exactly match the name of the Shortcut Stephen creates in the Shortcuts app
// (see the in-app setup panel) — shortcuts:// looks shortcuts up by name.
const REMINDERS_SHORTCUT_NAME = 'Add to Groceries';

const PLAN_BY_ID = Object.fromEntries(EATING_PLANS.map((p) => [p.id, p]));

const state = {
  all: [],
  data: null,
  filtered: [],
  q: '',
  kind: 'food',            // 'food' | 'drink' — which tab is showing
  filters: {
    category: new Set(), protein: new Set(), course: new Set(), methods: new Set(),
    heat: new Set(), cuisine: new Set(), time: new Set(),
    base: new Set(), family: new Set(), strength: new Set(), tags: new Set(),  // drink facets
    plan: new Map(),         // eating plans: id -> 'ok' | 'great' (3-tap cycle)
  },
  planVerdicts: new Map(),   // slug -> { planId: verdict }, precomputed at boot
  reader: { list: [], index: -1 },
  selected: new Set(),     // slugs picked for the shopping list (persisted)
  cartOnly: false,         // "In cart" view: show only selected recipes in the current section
  shop: { items: [], overrides: new Map() },  // overlay rows + the reader's own check/uncheck choices (row id -> bool)
  servings: new Map(),     // slug -> servings to shop for (persisted; default = the recipe's own yield)
  shopMode: 'aisle',       // 'aisle' (merged, store order) | 'recipe' (per-dish lines) — persisted
  suggest: { items: [], active: -1 },   // search autocomplete: current suggestions + highlighted row
  copyFormat: 'dash',      // 'dash' | 'checkbox' (persisted)
  variants: new Map(),     // slug -> SELECTED variant keys, in tap order (persisted)
  sort: 'newest',          // 'newest' | 'az' | 'quickest' (in the URL when not the default)
  view: 'list',            // 'list' (printed menu) | 'grid' (photo cards) — persisted per device
  cuisineMore: false,      // the long-tail cuisine chips are expanded
  cook: { slug: null, pane: 'ing' },   // Cook mode: which recipe, which pane (phones show one)
  cookProgress: new Map(), // slug -> { ing: Set<index>, steps: Set<index> } — ticks survive closing
  wake: null,              // the Screen Wake Lock sentinel while Cook mode is open
  showAll: false,          // Food: the flat "everything in one list" view instead of shelves
  displayList: [],         // what's on screen, in screen order — the reader pages through this
};

// Curated flavor tags that become the Drinks "Flavor" filter (kept tight on purpose).
const DRINK_FLAVORS = ['citrusy', 'tropical', 'creamy', 'fruity', 'herbal', 'smoky', 'spicy', 'dessert', 'refreshing', 'boozy'];

const SELECT_KEY = 'tm-selected';
const FORMAT_KEY = 'tm-copyformat';
const VARIANT_KEY = 'tm-variant';
const VIEW_KEY = 'tm-view';
const THEME_KEY = 'tm-theme';
const INTRO_KEY = 'tm-intro-seen';
const SERVINGS_KEY = 'tm-servings';
const SHOPMODE_KEY = 'tm-shopmode';
function loadSelected() {
  try { JSON.parse(localStorage.getItem(SELECT_KEY) || '[]').forEach((s) => state.selected.add(s)); } catch {}
  try { const f = localStorage.getItem(FORMAT_KEY); if (f === 'dash' || f === 'checkbox') state.copyFormat = f; } catch {}
  // Selections are arrays of chip keys in tap order (older builds stored one string).
  try { Object.entries(JSON.parse(localStorage.getItem(VARIANT_KEY) || '{}')).forEach(([s, k]) => state.variants.set(s, Array.isArray(k) ? k : [k])); } catch {}
  try { const v = localStorage.getItem(VIEW_KEY); if (v === 'list' || v === 'grid') state.view = v; } catch {}
  try { Object.entries(JSON.parse(localStorage.getItem(SERVINGS_KEY) || '{}')).forEach(([k, n]) => { const c = clampServes(n); if (c) state.servings.set(k, c); }); } catch {}
  try { const m = localStorage.getItem(SHOPMODE_KEY); if (m === 'aisle' || m === 'recipe') state.shopMode = m; } catch {}
}
function saveSelected() {
  try { localStorage.setItem(SELECT_KEY, JSON.stringify([...state.selected])); } catch {}
}
function saveVariants() {
  try { localStorage.setItem(VARIANT_KEY, JSON.stringify(Object.fromEntries(state.variants))); } catch {}
}
// The selected toggle chips for a recipe, in tap order (stale keys dropped).
function selectedChips(r) {
  const chips = recipeVariants(r);
  return (state.variants.get(r.slug) || []).map((k) => chips.find((c) => c.key === k)).filter(Boolean);
}
// The applied variant: all selected chips combined (null = as written).
function activeVariant(r) {
  const sel = selectedChips(r);
  if (!sel.length) return null;
  return combineVariants(r, sel) || sel[sel.length - 1];
}

const $ = (sel) => document.querySelector(sel);

// ── boot ──────────────────────────────────────────────────────────────────
export async function init() {
  setDate();
  try {
    const res = await fetch('recipes.json', { cache: 'no-cache' });
    state.data = await res.json();
  } catch (e) {
    $('#menu').innerHTML = `<p style="color:var(--stone)">Couldn't load recipes. Run <code>npm run build</code> first.</p>`;
    return;
  }
  state.all = state.data.recipes;
  state.planVerdicts = buildPlanVerdicts(state.all);
  loadSelected();
  // drop any persisted slugs that no longer exist
  const valid = new Set(state.all.map((r) => r.slug));
  [...state.selected].forEach((s) => valid.has(s) || state.selected.delete(s));
  const c = state.data.counts || { food: state.all.length, drink: 0 };
  document.querySelectorAll('.tab-count').forEach((el) => { el.textContent = c[el.dataset.count] ?? ''; });
  $('#colophon-meta').textContent = `${c.food} recipes · ${c.drink} drinks and counting`;
  $('#sort').innerHTML = SORTS.map((o) => `<option value="${o.key}">${esc(o.label)}</option>`).join('');
  syncView();
  syncTheme();
  initIntro();
  buildFilters();
  bindEvents();
  apply({ syncHash: false });   // routeFromHash() below owns the URL on boot
  renderShopbar();
  syncFormatToggle();
  routeFromHash();
}

// ── chrome: theme, intro, layout ─────────────────────────────────────────────
function syncTheme() {
  const paper = document.documentElement.dataset.theme === 'paper';
  const btn = $('#theme-toggle');
  btn.setAttribute('aria-label', paper ? 'Switch to the dark theme' : 'Switch to the paper (light) theme');
  const meta = document.querySelector('meta[name="theme-color"]');
  // Match the browser chrome (iOS status bar, Android toolbar) to the page background.
  const bg = typeof getComputedStyle === 'function'
    ? getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() : '';
  if (meta && bg) meta.setAttribute('content', bg);
}
function toggleTheme() {
  const root = document.documentElement;
  if (root.dataset.theme === 'paper') delete root.dataset.theme; else root.dataset.theme = 'paper';
  try { localStorage.setItem(THEME_KEY, root.dataset.theme === 'paper' ? 'paper' : 'dark'); } catch {}
  syncTheme();
}

// "How this works" shows on a first visit only; the ⓘ in the masthead brings it back.
function initIntro() {
  let seen = false;
  try { seen = localStorage.getItem(INTRO_KEY) === '1'; } catch {}
  showIntro(!seen);
}
function showIntro(show) {
  $('#intro').hidden = !show;
  $('#intro-toggle').setAttribute('aria-expanded', String(show));
}
function dismissIntro() {
  showIntro(false);
  try { localStorage.setItem(INTRO_KEY, '1'); } catch {}
}

function syncView() {
  document.querySelectorAll('#view-toggle .view-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
}
function setView(view) {
  if (view !== 'list' && view !== 'grid') return;
  state.view = view;
  try { localStorage.setItem(VIEW_KEY, view); } catch {}
  syncView();
  renderMenu();
}

// ── filter sheet ─────────────────────────────────────────────────────────────
function openFilters() {
  closeSuggest();
  $('#filter-panel').hidden = false;
  $('#filter-scrim').hidden = false;
  $('#filters-toggle').setAttribute('aria-expanded', 'true');
}
function closeFilters() {
  $('#filter-panel').hidden = true;
  $('#filter-scrim').hidden = true;
  $('#filters-toggle').setAttribute('aria-expanded', 'false');
}

// The tab hash for the current section + its filters/search/sort.
function currentHash() {
  return hashForKind(state.kind, encodeRouteQuery({ filters: state.filters, q: state.q, sort: state.sort, all: state.showAll }));
}

// Switch tabs: set the kind, reset search + filters (they differ per section), rebuild.
// syncHash reflects the choice in the URL ('#food' / '#drinks') so it survives a
// refresh and is shareable; pass false when the hash is already being set elsewhere
// (e.g. opening a recipe, or routing from an existing hash).
function setKind(kind, syncHash = true) {
  if (kind !== 'food' && kind !== 'drink') return;
  state.kind = kind;
  state.q = '';
  $('#search').value = '';
  closeSuggest();
  Object.values(state.filters).forEach((s) => s.clear());
  state.cuisineMore = false;
  state.showAll = false;
  document.querySelectorAll('#tabs .tab').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
  buildFilters();
  apply({ syncHash: false });
  if (syncHash) writeHash(currentHash());
}

// Load filters/search/sort from a decoded '?…' route query (refresh, Back, shared link).
function applyRouteQuery(query) {
  const { filters, q, sort, all } = decodeRouteQuery(query);
  state.showAll = !!all;
  Object.values(state.filters).forEach((s) => s.clear());
  for (const [key, vals] of Object.entries(filters)) {
    if (key === 'plan') vals.forEach(([id, mode]) => { if (PLAN_BY_ID[id]) state.filters.plan.set(id, mode); });
    else vals.forEach((v) => state.filters[key].add(v));
  }
  state.q = (q || '').trim().toLowerCase();
  $('#search').value = q || '';
  state.sort = SORTS.some((o) => o.key === sort) ? sort : 'newest';
  buildFilters();
  apply({ syncHash: false });
}

// Reflect a route in the URL without firing hashchange (replaceState, like the reader).
function writeHash(hash) {
  if (location.hash !== hash) history.replaceState(null, '', hash || location.pathname + location.search);
}

function setDate() {
  $('#masthead-date').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// ── filters ─────────────────────────────────────────────────────────────────
// Lane colour for a Protein chip (umbrella "seafood" + both sea lanes share fish blue).
const PROTEIN_LANE = { Seafood: 'fish', seafood: 'fish', fish: 'fish', chicken: 'chicken', beef: 'beef', vegetarian: 'veg', vegan: 'veg' };

function buildFilters() {
  const { data } = state;
  const kindRecipes = state.all.filter((r) => (r.kind || 'food') === state.kind);
  const present = (vocab, pluck) => {
    const found = new Set();
    kindRecipes.forEach((r) => [].concat(pluck(r)).filter((v) => v != null).forEach((v) => found.add(v)));
    return vocab.filter((v) => found.has(v));
  };
  const tagsPresent = new Set(kindRecipes.flatMap((r) => r.tags || []));
  // "Good for" (eating plans) applies to both kinds. Tap cycle per chip:
  // off -> great+okay -> great-only (✓) -> off. Selections AND together.
  const planGroup = { key: 'plan', label: 'Good for', values: EATING_PLANS.map((p) => p.id), labelFor: (id) => `${PLAN_BY_ID[id].icon} ${PLAN_BY_ID[id].short}` };
  const cuisines = splitCuisineChips(cuisineChipValues(kindRecipes, data.cuisineGroups || {}), kindRecipes, data.cuisineGroups || {});
  // Keep the long tail open while one of its cuisines is selected, so it stays visible.
  const moreOpen = state.cuisineMore || cuisines.more.some((v) => state.filters.cuisine.has(v));
  const groups = state.kind === 'drink'
    ? [
        { key: 'base', label: 'Base', values: present(data.vocab.base, (r) => r.base), labelFor: (v) => data.meta.base[v]?.label || cap(v) },
        { key: 'family', label: 'Style', values: present(data.vocab.family, (r) => r.family), labelFor: (v) => data.meta.family[v]?.label || cap(v) },
        { key: 'strength', label: 'Strength', values: present(data.vocab.strength, (r) => r.strength), labelFor: (v) => data.meta.strength[v]?.label || cap(v) },
        { key: 'tags', label: 'Flavor', values: DRINK_FLAVORS.filter((f) => tagsPresent.has(f)), labelFor: cap },
        { key: 'heat', label: 'Heat', values: present(data.vocab.heat, (r) => r.heat).filter((h) => h !== 'none'), labelFor: cap },
        planGroup,
      ]
    : [
        { key: 'category', label: 'Course', values: present(data.vocab.category, (r) => r.category), labelFor: cap },
        { key: 'protein', label: 'Protein', values: proteinChipValues(kindRecipes, data.vocab.protein, data.proteinGroups || {}), labelFor: (v) => data.meta.protein[v]?.label || cap(v), lane: (v) => PROTEIN_LANE[v] },
        { key: 'time', label: 'Time', values: data.timeBuckets.map((b) => b.key), labelFor: (k) => data.timeBuckets.find((b) => b.key === k).label },
        { key: 'tags', label: 'Occasion', values: FOOD_OCCASIONS.filter((t) => tagsPresent.has(t)), labelFor: occasionLabel },
        { key: 'course', label: 'Dish', values: present(data.vocab.course, (r) => r.course).filter((c) => !['main', 'side', 'dessert'].includes(c)), labelFor: cap },
        { key: 'methods', label: 'Method', values: present(data.vocab.methods, (r) => r.methods), labelFor: (v) => data.meta.method[v]?.label || cap(v) },
        { key: 'heat', label: 'Heat', values: present(data.vocab.heat, (r) => r.heat).filter((h) => h !== 'none'), labelFor: cap },
        { key: 'cuisine', label: 'Cuisine', values: moreOpen ? [...cuisines.primary, ...cuisines.more] : cuisines.primary,
          labelFor: (v) => v, more: !moreOpen && cuisines.more.length ? cuisines.more.length : 0 },
        planGroup,
      ];
  state.filterLabels = Object.fromEntries(groups.map((g) => [g.key, g.labelFor]));
  $('#filter-groups').innerHTML = groups
    .filter((g) => g.values.length > 1 || g.key === 'time')
    .map((g) => `
    <div class="filter-group" data-group="${g.key}">
      <span class="filter-group-label">${g.label}</span>
      <div class="chips">
        ${g.values.map((v) => {
          const on = g.key === 'plan' ? state.filters.plan.has(v) : state.filters[g.key].has(v);
          const strict = g.key === 'plan' && state.filters.plan.get(v) === 'great';
          const lane = g.lane?.(v);
          const cls = `chip${lane ? ` lane-${lane}` : ''}${strict ? ' is-strict' : ''}`;
          return `<button class="${cls}" type="button" aria-pressed="${on}" data-key="${g.key}" data-val="${esc(v)}">${lane ? '<span class="chip-dot" aria-hidden="true"></span>' : ''}${esc(g.labelFor(v))}</button>`;
        }).join('')}
        ${g.more ? `<button class="chip chip-more" type="button" data-more="${g.key}">More (${g.more})…</button>` : ''}
      </div>
    </div>`).join('');
}

// Human label for an active filter value (the removable pills above the menu).
function filterLabel(key, val) {
  const f = state.filterLabels?.[key];
  try { return f ? f(val) : val; } catch { return val; }
}

function bindEvents() {
  $('#tabs').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (t && t.dataset.kind !== state.kind) setKind(t.dataset.kind);
  });
  const search = $('#search');
  search.addEventListener('input', (e) => { state.q = e.target.value.trim().toLowerCase(); apply(); renderSuggest(); });
  search.addEventListener('focus', closeFilters);
  search.addEventListener('keydown', onSearchKeydown);
  // Reopen suggestions when refocusing a box that still has a query.
  search.addEventListener('focus', () => { if (state.q) renderSuggest(); });
  // Close on blur, but defer so a click on a suggestion row lands first.
  search.addEventListener('blur', () => setTimeout(closeSuggest, 120));
  $('#search-suggest').addEventListener('mousedown', (e) => {
    // mousedown (not click) so it fires before the input's blur closes the list.
    const row = e.target.closest('.suggest-item');
    if (!row) return;
    e.preventDefault();
    chooseSuggest(row.dataset.slug);
  });
  $('#search-suggest').addEventListener('mousemove', (e) => {
    const row = e.target.closest('.suggest-item');
    if (row) setActiveSuggest([...$('#search-suggest').children].indexOf(row));
  });
  $('#filter-groups').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    if (btn.dataset.more) {                      // "More (n)…" expands the long-tail cuisines
      state.cuisineMore = true;
      buildFilters();
      return;
    }
    const { key, val } = btn.dataset;
    if (key === 'plan') {
      // 3-tap cycle: off -> 'ok' (great + okay) -> 'great' (great only) -> off.
      const m = state.filters.plan;
      const cur = m.get(val);
      if (!cur) m.set(val, 'ok'); else if (cur === 'ok') m.set(val, 'great'); else m.delete(val);
      btn.setAttribute('aria-pressed', String(m.has(val)));
      btn.classList.toggle('is-strict', m.get(val) === 'great');
      btn.title = m.get(val) === 'great' ? 'Great fits only — tap again to clear'
        : m.has(val) ? 'Great + okay fits — tap again for great fits only' : '';
      apply();
      return;
    }
    const set = state.filters[key];
    if (set.has(val)) set.delete(val); else set.add(val);
    btn.setAttribute('aria-pressed', set.has(val));
    apply();
  });
  // Filter sheet
  $('#filters-toggle').addEventListener('click', () => ($('#filter-panel').hidden ? openFilters() : closeFilters()));
  $('#filters-done').addEventListener('click', closeFilters);
  $('#filter-scrim').addEventListener('click', closeFilters);
  $('#filters-clear').addEventListener('click', clearFilters);
  // Removable pills for each active filter
  $('#active-filters').addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    const { key, val } = pill.dataset;
    if (key === 'q') { state.q = ''; $('#search').value = ''; }
    else if (key === 'all') state.showAll = false;
    else state.filters[key]?.delete(val);
    buildFilters();
    apply();
  });
  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; apply(); });
  $('#view-toggle').addEventListener('click', (e) => {
    const b = e.target.closest('.view-btn');
    if (b) setView(b.dataset.view);
  });
  $('#theme-toggle').addEventListener('click', toggleTheme);
  $('#intro-toggle').addEventListener('click', () => ($('#intro').hidden ? showIntro(true) : dismissIntro()));
  $('#intro-dismiss').addEventListener('click', dismissIntro);
  $('#cart-filter').addEventListener('click', () => {
    state.cartOnly = !state.cartOnly;
    apply();   // apply() re-syncs the toggle's pressed state and re-renders the grid
  });
  $('#clear-filters').addEventListener('click', clearFilters);
  $('#empty-clear').addEventListener('click', clearFilters);
  $('#menu').addEventListener('click', (e) => {
    const more = e.target.closest('.shelf-all');
    if (more) { seeShelf(more.dataset.shelf); return; }
    if (e.target.closest('#show-all')) { state.showAll = true; apply(); return; }
    const fresh = e.target.closest('.fresh-card');
    if (fresh) { openReader(fresh.dataset.slug); return; }
    const sel = e.target.closest('.card-select');
    if (sel) { toggleSelect(sel.dataset.select); return; }
    const card = e.target.closest('.card');
    if (card) openReader(card.dataset.slug);
  });
  // Shopping list
  $('#shopbar').addEventListener('click', openShopList);
  $('#reader-cart').addEventListener('click', openShopList);
  $('#shoplist-close').addEventListener('click', closeShopList);
  $('#shoplist').addEventListener('click', (e) => { if (e.target === $('#shoplist')) closeShopList(); });
  $('#shop-mode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-shopmode]');
    if (!b) return;
    state.shopMode = b.dataset.shopmode;
    try { localStorage.setItem(SHOPMODE_KEY, state.shopMode); } catch {}
    renderShopList();
  });
  $('#shop-help').addEventListener('click', () => {
    const note = $('#shop-note');
    note.hidden = !note.hidden;
    $('#shop-help').setAttribute('aria-expanded', String(!note.hidden));
  });
  $('#week-list').addEventListener('click', onWeekClick);
  $('#shop-copy').addEventListener('click', copyShoppingList);
  if (isIOSSafari(navigator)) $('#ios-reminders').hidden = false;
  $('#shop-reminders').addEventListener('click', sendToReminders);
  $('#shop-share').addEventListener('click', shareShoppingList);
  $('#shop-reminders-help').addEventListener('click', () => toggleRemindersHelp(true));
  $('#reminders-help-close').addEventListener('click', () => toggleRemindersHelp(false));
  $('#reminders-help').addEventListener('click', (e) => { if (e.target === $('#reminders-help')) toggleRemindersHelp(false); });
  $('#shop-clear').addEventListener('click', clearSelection);
  $('#format-toggle').addEventListener('click', (e) => {
    const b = e.target.closest('.fmt-btn');
    if (!b) return;
    state.copyFormat = b.dataset.format;
    try { localStorage.setItem(FORMAT_KEY, state.copyFormat); } catch {}
    syncFormatToggle();
  });
  // One checkbox may stand for several recipes' lines (a merged aisle row): tick them all.
  $('#shoplist-body').addEventListener('change', (e) => {
    const cb = e.target.closest('input[type=checkbox][data-ids]');
    if (!cb) return;
    cb.dataset.ids.split(' ').forEach((id) => state.shop.overrides.set(id, cb.checked));
    updateSummary();
  });
  $('#reader-close').addEventListener('click', closeReader);
  $('#reader-share').addEventListener('click', shareCurrentRecipe);
  $('#spread').addEventListener('click', (e) => {
    const tab = e.target.closest('.spread-tab');
    if (tab) { jumpTo(tab.dataset.jump); return; }
    const vbtn = e.target.closest('.vchip');
    if (vbtn) {
      const r = state.reader.list[state.reader.index];
      if (!r || vbtn.disabled) return;
      const k = vbtn.dataset.variant;
      const list = state.variants.get(r.slug) || [];
      if (!k) state.variants.delete(r.slug);                       // "As written" clears all
      else {
        const next = list.includes(k) ? list.filter((x) => x !== k) : [...list, k];
        if (next.length) state.variants.set(r.slug, next); else state.variants.delete(r.slug);
      }
      saveVariants();
      // Re-render the spread in place, keeping the reader's scroll position.
      const scroller = $('#spread .spread-scroll');
      const top = scroller ? scroller.scrollTop : 0;
      renderSpread(0);
      const after = $('#spread .spread-scroll');
      if (after) after.scrollTop = top;
      return;
    }
    const sel = e.target.closest('.spread-select');
    if (!sel) return;
    e.stopPropagation();
    toggleSelect(sel.dataset.select);
  });
  // Cook mode
  $('#cook-open').addEventListener('click', openCook);
  $('#cook-close').addEventListener('click', closeCook);
  $('#cook').addEventListener('click', onCookClick);
  document.addEventListener('visibilitychange', () => {
    // The OS drops a wake lock when the tab is hidden; take it back on return.
    if (!$('#cook').hidden && document.visibilityState === 'visible') requestWake();
  });
  $('#reader-prev').addEventListener('click', () => flip(-1));
  $('#reader-next').addEventListener('click', () => flip(1));
  $('#reader').addEventListener('click', (e) => { if (e.target === $('#reader')) closeReader(); });
  document.addEventListener('keydown', (e) => {
    if (!$('#cook').hidden) { if (e.key === 'Escape') closeCook(); return; }
    if (!$('#shoplist').hidden) { if (e.key === 'Escape') closeShopList(); return; }
    if (!$('#filter-panel').hidden) { if (e.key === 'Escape') closeFilters(); return; }
    if ($('#reader').hidden) return;
    if (e.key === 'Escape') closeReader();
    else if (e.key === 'ArrowLeft') flip(-1);
    else if (e.key === 'ArrowRight') flip(1);
  });
  window.addEventListener('hashchange', routeFromHash);
}

function clearFilters() {
  state.q = '';
  $('#search').value = '';
  closeSuggest();
  state.cartOnly = false;
  state.cuisineMore = false;
  state.showAll = false;
  Object.values(state.filters).forEach((s) => s.clear());
  buildFilters();
  apply();
}

// "See all" on a shelf: replace the filters with that shelf's (sort and view stay).
function seeShelf(key) {
  const shelf = SHELVES.find((s) => s.key === key);
  if (!shelf) return;
  Object.values(state.filters).forEach((s) => s.clear());
  state.q = '';
  $('#search').value = '';
  state.showAll = false;
  Object.entries(shelf.filter).forEach(([k, vals]) => vals.forEach((v) => state.filters[k].add(v)));
  buildFilters();
  apply();
  $('#filters').scrollIntoView?.({ block: 'start' });
}

// Re-filter + re-sort the menu, refresh the pills/badges, and (unless told not to)
// mirror the filter state into the URL hash. The hash is left alone while a recipe is
// open (it holds '#/<slug>'), and a plain default view keeps a bare URL.
function apply({ syncHash = true } = {}) {
  syncCartFilter();   // may clear cartOnly if this section has no cart items (keeps the view honest)
  const ctx = {
    q: state.q, filters: state.filters, cuisineGroups: state.data.cuisineGroups || {},
    proteinGroups: state.data.proteinGroups || {},
    timeBuckets: state.data.timeBuckets || [], planVerdicts: state.planVerdicts,
    cartOnly: state.cartOnly, selected: state.selected,
  };
  state.filtered = sortRecipes(
    state.all.filter((r) => (r.kind || 'food') === state.kind && recipeMatches(r, ctx)), state.sort);
  renderMenu();
  renderActiveFilters();
  $('#sort').value = state.sort;
  if (syncHash && $('#reader').hidden) {
    const h = currentHash();
    if (location.hash || h !== hashForKind('food')) writeHash(h);
  }
}

// The removable pill row + the Filters (n) badge + the sheet's "Show N" button.
function renderActiveFilters() {
  const entries = activeFilterEntries(state.filters);
  const pills = entries.map(({ key, val, mode }) => {
    const label = filterLabel(key, val) + (mode === 'great' ? ' ✓' : '');
    return `<button class="pill" type="button" data-key="${key}" data-val="${esc(val)}" aria-label="Remove filter: ${esc(label)}">${esc(label)}<span class="pill-x" aria-hidden="true">×</span></button>`;
  });
  if (state.showAll && !entries.length && !state.q) pills.push(`<button class="pill" type="button" data-key="all" aria-label="Back to the shelves">All in one list<span class="pill-x" aria-hidden="true">×</span></button>`);
  if (state.q) pills.unshift(`<button class="pill" type="button" data-key="q" aria-label="Clear search">“${esc(state.q)}”<span class="pill-x" aria-hidden="true">×</span></button>`);
  $('#active-filters').innerHTML = pills.join('');
  const badge = $('#filters-count');
  badge.hidden = entries.length === 0;
  badge.textContent = entries.length;
  const noun = state.kind === 'drink' ? 'drink' : 'recipe';
  const n = state.filtered.length;
  $('#filters-done').textContent = `Show ${n} ${noun}${n === 1 ? '' : 's'}`;
}

// The "In cart" toggle only makes sense when the current section (food/drink) has
// selected recipes; keep its count/pressed state and visibility in sync, and drop
// cartOnly when there's nothing to show so the grid never strands on an empty view.
function syncCartFilter() {
  const count = state.all.filter((r) => (r.kind || 'food') === state.kind && state.selected.has(r.slug)).length;
  if (state.cartOnly && count === 0) state.cartOnly = false;
  const btn = $('#cart-filter');
  if (!btn) return;
  btn.hidden = count === 0;
  $('#cart-filter-count').textContent = count;
  btn.setAttribute('aria-pressed', String(state.cartOnly));
}

// ── search autocomplete ──────────────────────────────────────────────────────
// Recipes in the section currently on screen (food or drink) — the search scope.
function kindRecipes() {
  return state.all.filter((r) => (r.kind || 'food') === state.kind);
}

// Highlight every occurrence of the query inside an (escaped) string with <mark>.
function highlight(text, q) {
  const safe = esc(text);
  if (!q) return safe;
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
  return safe.replace(re, '<mark>$1</mark>');
}

// A short "why it matched" line for suggestions that aren't a plain name match,
// so a recipe surfaced by a tag or an ingredient explains itself.
function suggestWhy(s, q) {
  if (s.field === 'name') return '';
  const label = s.field === 'tag' ? 'Tag' : s.field === 'ingredient' ? 'Ingredient' : 'Match';
  return `<span class="suggest-why">${label}: ${highlight(s.text, q)}</span>`;
}

// Rebuild the dropdown from the current query. At most 5, scoped to this section,
// updated immediately on every input change.
function renderSuggest() {
  const box = $('#search-suggest');
  const items = state.q ? searchSuggestions(kindRecipes(), state.q, 5) : [];
  state.suggest = { items, active: -1 };
  if (!items.length) { closeSuggest(); return; }
  box.innerHTML = items.map((s, i) => `
    <li class="suggest-item" id="suggest-${i}" role="option" aria-selected="false" data-slug="${esc(s.recipe.slug)}">
      <span class="suggest-title">${highlight(s.recipe.title, state.q)}</span>
      ${suggestWhy(s, state.q)}
    </li>`).join('');
  box.hidden = false;
  $('#search').setAttribute('aria-expanded', 'true');
}

function closeSuggest() {
  const box = $('#search-suggest');
  if (box) { box.hidden = true; box.innerHTML = ''; }
  state.suggest = { items: [], active: -1 };
  const search = $('#search');
  if (search) { search.setAttribute('aria-expanded', 'false'); search.setAttribute('aria-activedescendant', ''); }
}

// Move/paint the keyboard highlight to row `i` (-1 clears it).
function setActiveSuggest(i) {
  state.suggest.active = i;
  const rows = [...$('#search-suggest').children];
  rows.forEach((row, idx) => {
    const on = idx === i;
    row.classList.toggle('is-active', on);
    row.setAttribute('aria-selected', String(on));
  });
  $('#search').setAttribute('aria-activedescendant', i >= 0 ? `suggest-${i}` : '');
}

// Open the chosen recipe and dismiss the list.
function chooseSuggest(slug) {
  if (!slug) return;
  closeSuggest();
  openReader(slug);
}

function onSearchKeydown(e) {
  const { items, active } = state.suggest;
  if (e.key === 'Escape') { closeSuggest(); return; }
  if (!items.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); setActiveSuggest((active + 1) % items.length); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveSuggest((active - 1 + items.length) % items.length); }
  else if (e.key === 'Enter') {
    if (active >= 0 && items[active]) { e.preventDefault(); chooseSuggest(items[active].recipe.slug); }
  }
}

// ── menu (rows / cards) ──────────────────────────────────────────────────────
function renderMenu() {
  const list = state.filtered;
  const total = state.all.filter((r) => (r.kind || 'food') === state.kind).length;
  const noun = state.kind === 'drink' ? 'drink' : 'recipe';
  const filtering = state.q || state.cartOnly || Object.values(state.filters).some((s) => s.size);
  $('#clear-filters').hidden = !(filtering || state.showAll);
  $('#result-count').textContent = filtering ? `${list.length} of ${total} ${noun}s` : `${total} ${noun}s`;
  $('#empty-state').hidden = list.length > 0;
  const menu = $('#menu');
  if (state.kind === 'food' && !filtering && !state.showAll) {
    // The unfiltered Food home: a "Just added" photo row, then lane shelves.
    const { fresh, shelves } = buildShelves(list, { sort: state.sort });
    state.displayList = shelves.flatMap((s) => s.members);
    menu.className = 'menu is-shelves';
    menu.innerHTML = freshHtml(fresh) + shelves.map(shelfHtml).join('')
      + `<div class="show-all-wrap"><button class="show-all" id="show-all" type="button">Show all ${total} recipes as one list</button></div>`;
    return;
  }
  state.displayList = list;
  menu.className = `menu items is-${state.view}`;
  menu.innerHTML = list.map((r) => cardHtml(r)).join('');
}

function freshHtml(fresh) {
  if (!fresh.length) return '';
  return `
  <section class="fresh" aria-labelledby="fresh-h">
    <div class="shelf-head"><h2 class="shelf-title" id="fresh-h">Just added</h2></div>
    <div class="fresh-row">
      ${fresh.map((r) => `
      <button class="fresh-card lane-${laneFor(r)}" type="button" data-slug="${esc(r.slug)}">
        <span class="fresh-img card-visual">${visualHtml(r)}</span>
        <span class="card-lane"><span class="lane-dot" aria-hidden="true"></span>${esc(laneLabel(r))} · ${esc(fmtMin(r.times.total))}</span>
        <span class="fresh-title">${esc(r.title)}</span>
      </button>`).join('')}
    </div>
  </section>`;
}

function shelfHtml(s) {
  return `
  <section class="shelf lane-${s.key}" aria-labelledby="shelf-${s.key}">
    <div class="shelf-head">
      <span class="lane-dot" aria-hidden="true"></span>
      <h2 class="shelf-title" id="shelf-${s.key}">${esc(s.title)}</h2>
      <span class="shelf-count">${s.count}</span>
      <button class="shelf-all" type="button" data-shelf="${s.key}">See all${s.count > s.items.length ? ` ${s.count}` : ''}</button>
    </div>
    <div class="shelf-items items is-${state.view}">${s.items.map((r) => cardHtml(r)).join('')}</div>
  </section>`;
}

// When a "Good for" plan filter is active, each card also shows that plan's verdict
// (✓ great / ~ okay) — contextual only, so cards stay clean otherwise.
function planBadges(r) {
  if (!state.filters.plan.size) return [];
  return [...state.filters.plan.keys()].map((id) => {
    const p = PLAN_BY_ID[id];
    const v = state.planVerdicts.get(r.slug)?.[id];
    if (!p || !v || v === 'avoid') return '';
    const great = v === 'optimal';
    return `<span class="tag tag-plan${great ? ' is-great' : ''}" title="${esc(`${p.name}: ${great ? 'great fit' : 'okay in moderation'}`)}">${p.icon}${great ? '✓' : '~'}</span>`;
  });
}

// "Mild heat" / "Medium heat" / "Hot" (never "Hot heat").
const heatLabel = (h) => (h === 'hot' ? 'Hot' : `${cap(h)} heat`);

// The coloured lane line: what it is (protein / side / dessert / base) + heat + plan badges.
function laneLabel(r) {
  const M = state.data.meta;
  if (r.kind === 'drink') return M.base[r.base]?.label || cap(r.base);
  if (r.category === 'side') return 'Side';
  if (r.category === 'dessert') return 'Dessert';
  return M.protein[r.protein]?.label || cap(r.protein);
}

function cardHtml(r) {
  const picked = state.selected.has(r.slug);
  const time = fmtMin(r.times.total);
  const extras = [
    r.heat && r.heat !== 'none' ? `<span class="tag tag-hot">· ${esc(heatLabel(r.heat))}</span>` : '',
    ...planBadges(r),
  ].join('');
  return `
  <div class="card-wrap lane-${laneFor(r)}${picked ? ' is-selected' : ''}">
    <button class="card" type="button" data-slug="${esc(r.slug)}">
      <div class="card-visual">${visualHtml(r)}</div>
      <div class="card-body">
        <div class="card-lane"><span class="lane-dot" aria-hidden="true"></span>${esc(laneLabel(r))}<span class="card-lane-time">· ${esc(time)}</span>${extras}</div>
        <div class="card-line"><h3 class="card-title">${esc(r.title)}</h3><span class="leader" aria-hidden="true"></span><span class="card-time">${esc(time)}</span></div>
        <p class="card-tagline">${esc(r.tagline)}</p>
      </div>
    </button>
    <button class="card-select" type="button" data-select="${esc(r.slug)}"
      aria-pressed="${picked}" aria-label="${picked ? 'Remove from' : 'Add to'} shopping list" title="Add to shopping list">
      <svg class="card-select-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
      <svg class="card-select-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
    </button>
  </div>`;
}

function visualHtml(r) {
  if (r.hero) {
    return `<img src="${esc(r.hero)}" alt="" loading="lazy" decoding="async"
      onerror="this.closest('.card-visual').innerHTML = this.dataset.fallback"
      data-fallback='${placeholderHtml(r).replace(/'/g, '&#39;')}' />`;
  }
  return placeholderHtml(r);
}

// "Cuisine · Dish" for food; "Base · Style" for a drink. Returns an escaped string.
function subline(r) {
  const M = state.data.meta;
  return r.kind === 'drink'
    ? `${esc(M.base[r.base]?.label || r.base)} · ${esc(M.family[r.family]?.label || r.family)}`
    : `${esc(r.cuisine)} · ${esc(cap(r.course))}`;
}

function placeholderHtml(r) {
  return `<div class="placeholder">
      <div class="placeholder-plate">${esc(r.title)}</div>
      <div class="placeholder-sub">${subline(r)}</div>
    </div>`;
}

// ── reader / flipbook ────────────────────────────────────────────────────────
function openReader(slug, dir = 0) {
  const target = state.all.find((r) => r.slug === slug);
  if (!target) return;
  // Arriving at a recipe from the other section (e.g. a shared drink link) flips the
  // tab — but keep syncHash off so we don't clobber the '#/<slug>' hash set below.
  if ((target.kind || 'food') !== state.kind) setKind(target.kind || 'food', false);
  const kindList = sortRecipes(state.all.filter((r) => (r.kind || 'food') === state.kind), state.sort);
  let list = state.displayList.length ? state.displayList : kindList;
  let index = list.findIndex((r) => r.slug === slug);
  if (index === -1) { list = kindList; index = list.findIndex((r) => r.slug === slug); }
  if (index === -1) return;
  state.reader = { list, index };
  closeFilters();
  closeSuggest();
  $('#reader').hidden = false;
  document.body.style.overflow = 'hidden';
  renderSpread(dir);
  if (location.hash !== `#/${slug}`) history.replaceState(null, '', `#/${slug}`);
}

function flip(dir) {
  const { list, index } = state.reader;
  const next = index + dir;
  if (next < 0 || next >= list.length) return;
  state.reader.index = next;
  renderSpread(dir);
  history.replaceState(null, '', `#/${list[next].slug}`);
}

function closeReader() {
  $('#reader').hidden = true;
  document.body.style.overflow = '';
  // Leaving a recipe drops back to its section, not a bare URL, so the tab persists.
  if (location.hash.startsWith('#/')) writeHash(currentHash());
}

function renderSpread(dir) {
  const { list, index } = state.reader;
  const r = list[index];
  const stage = $('#spread');
  const animate = dir !== 0 && typeof matchMedia === 'function'
    && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const outgoing = animate ? stage.innerHTML : null;   // snapshot the page we're leaving
  const outgoingLane = [...stage.classList].find((c) => c.startsWith('lane-')) || '';
  stage.className = `spread lane-${laneFor(r)}`;      // the recipe's lane colour drives its accents
  stage.innerHTML = spreadHtml(r);
  $('#reader-prev').disabled = index <= 0;
  $('#reader-next').disabled = index >= list.length - 1;
  const scroller = stage.querySelector('.spread-scroll');
  if (scroller) {
    scroller.scrollTop = 0;
    let queued = false;
    scroller.addEventListener('scroll', () => {
      if (queued) return;
      queued = true;
      const run = () => { queued = false; spyTabs(scroller); };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else run();
    }, { passive: true });
  }
  if (animate) turnPage(outgoing, dir, outgoingLane);
}

// A real page-turn: the page we just left is cloned into a throwaway "leaf" that flips away
// around the spine, revealing the new page already sitting flat beneath it. The leaf is
// sliced into vertical segments hinged in 3D so the sheet BOWS/curls like real paper as it
// turns (see CSS). The live #spread never animates — only this leaf does — so the old
// mobile-WebKit "snap to final frame" bug (animating an overflow:auto layer) can't bite.
const CURL_SEGMENTS = 16;
function turnPage(outgoingHtml, dir, laneClass = '') {
  const stage = $('#spread');
  const book = stage.parentElement;                     // .reader-stage (perspective layer)
  book.querySelectorAll('.turn-leaf').forEach((l) => l.remove());   // never stack leaves
  const next = dir > 0;
  const rect = stage.getBoundingClientRect();
  const W = Math.round(rect.width), H = Math.round(rect.height);
  const leaf = document.createElement('div');
  leaf.setAttribute('aria-hidden', 'true');
  if (W > 40 && H > 40) {
    leaf.className = `turn-leaf ${next ? 'turn-next' : 'turn-prev'} ${laneClass}`;
    leaf.appendChild(buildCurlSegments(outgoingHtml, next, W, H));
  } else {
    // No measurable layout (e.g. the jsdom test env) — fall back to a single-piece flip.
    leaf.className = `spread turn-leaf ${next ? 'turn-next' : 'turn-prev'} ${laneClass}`;
    leaf.innerHTML = outgoingHtml;
  }
  book.appendChild(leaf);
  const done = () => leaf.remove();
  leaf.addEventListener('animationend', done, { once: true });
  setTimeout(done, 2100);                               // fallback if animationend never fires
}

// Build the nested vertical segments. Each shows one vertical band of the page (a clipped
// clone), positioned at the previous segment's far edge so the 3D chain curls.
function buildCurlSegments(html, next, W, H, n = CURL_SEGMENTS) {
  const segW = W / n;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;                                 // parse once, clone per segment
  let inner = null;                                     // build from the leading edge inward
  for (let k = n - 1; k >= 0; k--) {                    // k = distance from the spine
    const seg = document.createElement('div');
    seg.className = 'turn-seg';
    seg.style.width = `${segW}px`;
    seg.style.height = `${H}px`;
    // The spine-most segment (root) sits on the spine side of the leaf — left edge for a
    // forward turn, right edge for a back turn ("spine on the opposite side"). Every other
    // segment hinges off its parent's far edge so the chain marches toward the leading edge.
    seg.style.left = k === 0
      ? (next ? '0px' : `${W - segW}px`)
      : (next ? `${segW}px` : `${-segW}px`);
    const bandLeft = next ? k * segW : W - (k + 1) * segW;           // which band of the page this is
    const face = document.createElement('div');
    face.className = 'turn-seg-face';
    face.style.cssText = `width:${W}px;height:${H}px;left:${-bandLeft}px;`
      + `clip-path:inset(0 ${W - bandLeft - segW}px 0 ${bandLeft}px)`;
    face.appendChild(tpl.content.cloneNode(true));
    seg.appendChild(face);
    const shade = document.createElement('div');
    shade.className = 'turn-seg-shade';
    shade.style.setProperty('--depth', String(k / (n - 1)));        // outer bands darken more
    seg.appendChild(shade);
    if (inner) seg.appendChild(inner);
    inner = seg;
  }
  return inner;                                          // the spine-most segment (the root)
}

function sectionsHtml(sections, kind) {
  return sections.map((s) => {
    const head = s.section ? `<h4 class="subsection-h">${esc(s.section)}</h4>` : '';
    if (kind === 'ing') return head + `<ul class="ing-list">${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
    return head + `<ol class="step-list">${s.items.map((i) => `<li>${inlineMd(i)}</li>`).join('')}</ol>`;
  }).join('');
}

// Ingredients with the active variant applied — swapped lines are highlighted
// and carry the as-written line in their tooltip.
function ingredientsHtml(r, variant) {
  return applyVariantToSections(r.ingredients, variant).map((s) => {
    const head = s.section ? `<h4 class="subsection-h">${esc(s.section)}</h4>` : '';
    return head + `<ul class="ing-list">${s.items.map((i) =>
      `<li${i.swapped ? ` class="is-swapped" title="${esc(`as written: ${i.original}`)}"` : ''}>${esc(i.text)}</li>`).join('')}</ul>`;
  }).join('');
}

// The 1C variant toggle — shown only when a recipe has planSwaps variants.
// Chips are ADDITIVE: select several and their swaps apply together (compatible
// swaps touch different lines, so order can't change the result). A chip that
// would rewrite an already-swapped line differently is grayed out.
function variantToggleHtml(r, variants, selKeys) {
  if (!variants.length) return '';
  const selected = selKeys.map((k) => variants.find((c) => c.key === k)).filter(Boolean);
  return `
    <div class="variant-toggle" role="group" aria-label="Recipe variants (combinable)">
      <button class="vchip" type="button" data-variant="" aria-pressed="${!selected.length}">As written</button>
      ${variants.map((v) => {
        const on = selKeys.includes(v.key);
        const conflict = !on && selected.some((s) => variantsConflict(s, v));
        return `<button class="vchip" type="button" data-variant="${esc(v.key)}" aria-pressed="${on}"${
          conflict ? ' disabled title="Conflicts with a selected variant — it swaps the same ingredient differently"'
                   : ` title="${esc(variantTitle(v))}"`}>⇄ ${esc(variantLabel(v))}</button>`;
      }).join('')}
    </div>${selected.length ? `<p class="variant-note">${esc(variantChanges(selected))}</p>` : ''}`;
}

// "What changes" for the selected chips — the swap notes, which are too long for a chip.
function variantChanges(selected) {
  const notes = [...new Set(selected.flatMap((v) => v.swaps.map((sw) => sw.note || sw.with)))];
  return `What changes: ${notes.join('; ')}.`;
}

// The 5-cell spec block — kitchen timings for food, bar spec for a drink.
function metaCells(r) {
  const M = state.data.meta;
  const cells = r.kind === 'drink'
    ? [['Serves', r.serves], ['Time', fmtMin(r.times.total)], ['Base', M.base[r.base]?.label || r.base],
       ['Glass', r.glass], ['Level', cap(r.difficulty)]]
    : [['Serves', r.serves], ['Prep', fmtMin(r.times.prep)], ['Cook', fmtMin(r.times.cook)],
       ['Total', fmtMin(r.times.total)], ['Level', cap(r.difficulty)]];
  return cells.map(([l, v]) => `<div><div class="m-label">${l}</div><div class="m-value">${esc(v)}</div></div>`).join('');
}

function chipsHtml(r) {
  const M = state.data.meta;
  if (r.kind === 'drink') {
    return [
      `<span class="schip is-lane">${esc(M.base[r.base]?.label || r.base)}</span>`,
      `<span class="schip">${esc(M.family[r.family]?.label || r.family)}</span>`,
      ...(r.methods || []).map((m) => `<span class="schip">${esc(M.method[m]?.label || m)}</span>`),
      r.strength ? `<span class="schip">${esc(M.strength[r.strength]?.label || cap(r.strength))}</span>` : '',
      r.heat !== 'none' ? `<span class="schip is-hot">${esc(cap(r.heat))} heat</span>` : '',
      ...(r.tags || []).map((t) => `<span class="schip">${esc(t)}</span>`),
    ].filter(Boolean).join('');
  }
  return [
    `<span class="schip is-lane">${esc(M.protein[r.protein]?.label || r.protein)}</span>`,
    ...(r.methods || []).map((m) => `<span class="schip">${esc(M.method[m]?.label || m)}</span>`),
    r.heat !== 'none' ? `<span class="schip is-hot">${esc(cap(r.heat))} heat</span>` : '',
    ...(r.tags || []).map((t) => `<span class="schip">${esc(t)}</span>`),
  ].filter(Boolean).join('');
}

function spreadHtml(r) {
  const variants = recipeVariants(r);
  const variant = activeVariant(r);
  const heroPlaceholder = `<div class="placeholder"><div class="placeholder-plate">${esc(r.title)}</div>
        <div class="placeholder-sub">${subline(r)}</div></div>`;
  const heroInner = r.hero
    ? `<img src="${esc(r.hero)}" alt="${esc(r.title)}"
         onerror="this.outerHTML = this.dataset.fallback"
         data-fallback='${heroPlaceholder.replace(/'/g, '&#39;')}' />`
    : heroPlaceholder;

  const picked = state.selected.has(r.slug);
  const selectBtn = `<button class="spread-select" type="button" data-select="${esc(r.slug)}"
      aria-pressed="${picked}" aria-label="${picked ? 'Remove from' : 'Add to'} shopping list" title="Add to shopping list">
      <svg class="spread-select-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
      <svg class="spread-select-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
    </button>`;

  const chips = chipsHtml(r);
  const meta = metaCells(r);

  const tips = r.tips?.length
    ? `<div class="tips-box"><div class="section-h">Chef's Tips</div>
        <ul class="tips-list">${r.tips.map((t) => `<li>${inlineMd(t)}</li>`).join('')}</ul></div>` : '';
  const extras = r.extras?.length
    ? `<div class="extras"><div class="section-h">Make It Yours</div><dl>${r.extras
        .map((x) => `<dt>${esc(x.label)}</dt><dd>${inlineMd(x.note)}</dd>`).join('')}</dl></div>` : '';
  const source = r.source?.name
    ? `<p class="spread-source">${r.source.url
        ? `Source: <a href="${esc(r.source.url)}" target="_blank" rel="noopener">${esc(r.source.name)}</a>`
        : esc(r.source.name)}</p>` : '';
  const headnote = r.headnote ? `<p class="spread-headnote">${inlineMd(r.headnote)}</p>` : '';

  return `
    <div class="spread-scroll">
    <div class="spread-hero">${heroInner}${selectBtn}</div>
    <nav class="spread-tabs" aria-label="Jump to">
      ${SPREAD_TABS.map(([k, label], i) => `<button class="spread-tab" type="button" data-jump="${k}" aria-current="${i === 0}">${label}</button>`).join('')}
    </nav>
    <div class="spread-inner" data-sec="overview">
      <p class="spread-kicker">${subline(r)}</p>
      <h2 class="spread-title">${esc(r.title)}</h2>
      <p class="spread-tagline">${esc(r.tagline)}</p>
      <div class="spread-meta">${meta}</div>
      <div class="spread-chips">${chips}</div>
      <p class="spread-pitch">${inlineMd(r.pitch)}</p>
      <div class="spread-columns">
        <div class="col-ingredients" data-sec="ingredients"><div class="section-h">Ingredients</div>${variantToggleHtml(r, variants, state.variants.get(r.slug) || [])}${ingredientsHtml(r, variant)}</div>
        <div class="col-steps" data-sec="method"><div class="section-h">Method</div>${sectionsHtml(r.steps, 'step')}${tips}${extras}</div>
      </div>
      ${headnote}
      ${source}
      ${nutritionPanelHtml(r, { variant })}
    </div>
    </div>`;
}

// ── in-recipe section tabs (jump + scroll-spy) ───────────────────────────────
const SPREAD_TABS = [['overview', 'About'], ['ingredients', 'Ingredients'], ['method', 'Method'], ['nutrition', 'Nutrition']];

// The element a tab jumps to (the nutrition panel is found by its own class).
const secEl = (sc, k) => sc.querySelector(k === 'nutrition' ? '.nutrition' : `[data-sec="${k}"]`);

function setActiveTab(sec) {
  document.querySelectorAll('#spread .spread-tab').forEach((t) => t.setAttribute('aria-current', String(t.dataset.jump === sec)));
}

function jumpTo(sec) {
  const sc = $('#spread .spread-scroll');
  const el = sc && secEl(sc, sec);
  if (!el) return;
  const tabs = sc.querySelector('.spread-tabs');
  const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - (tabs ? tabs.offsetHeight : 0) - 8;
  if (typeof sc.scrollTo === 'function') sc.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  else sc.scrollTop = Math.max(0, top);
  setActiveTab(sec);
}

// Highlight the last section whose top has scrolled up under the tab bar.
function spyTabs(sc) {
  const tabs = sc.querySelector('.spread-tabs');
  const line = sc.getBoundingClientRect().top + (tabs ? tabs.offsetHeight : 0) + 24;
  let cur = 'overview';
  for (const [k] of SPREAD_TABS) {
    const el = secEl(sc, k);
    if (el && el.getBoundingClientRect().top <= line) cur = k;
  }
  setActiveTab(cur);
}

// ── Cook mode ────────────────────────────────────────────────────────────────
// A full-screen kitchen view of the open recipe: big type, ingredients and steps you
// tap to tick off (the next undone step is highlighted), and the screen kept awake via
// the Screen Wake Lock API where the browser supports it. It cooks the ACTIVE variant.
function cookProgressFor(slug) {
  if (!state.cookProgress.has(slug)) state.cookProgress.set(slug, { ing: new Set(), steps: new Set() });
  return state.cookProgress.get(slug);
}

function openCook() {
  const r = state.reader.list[state.reader.index];
  if (!r) return;
  const prog = cookProgressFor(r.slug);
  state.cook = { slug: r.slug, pane: prog.ing.size || prog.steps.size ? 'steps' : 'ing' };
  renderCook();
  $('#cook').hidden = false;
  requestWake();
}

function closeCook() {
  $('#cook').hidden = true;
  releaseWake();
}

async function requestWake() {
  const wl = typeof navigator !== 'undefined' ? navigator.wakeLock : null;
  if (!wl || typeof wl.request !== 'function') return;
  try {
    state.wake = await wl.request('screen');
    $('#cook-awake').hidden = false;
    state.wake.addEventListener?.('release', () => { $('#cook-awake').hidden = true; });
  } catch { $('#cook-awake').hidden = true; }
}

function releaseWake() {
  try { state.wake?.release?.(); } catch {}
  state.wake = null;
  $('#cook-awake').hidden = true;
}

function renderCook() {
  const r = state.all.find((x) => x.slug === state.cook.slug);
  if (!r) return;
  const prog = cookProgressFor(r.slug);
  const variant = activeVariant(r);
  $('#cook').className = `cook lane-${laneFor(r)} pane-${state.cook.pane}`;
  $('#cook-title').textContent = r.title;
  const vline = $('#cook-variant');
  vline.hidden = !variant;
  vline.textContent = variant ? `Cooking the ⇄ ${variantLabel(variant)} version` : '';
  document.querySelectorAll('#cook .cook-pane-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pane === state.cook.pane)));

  let i = 0;
  $('#cook-ing').innerHTML = `<h3 class="cook-h">Ingredients</h3>` + applyVariantToSections(r.ingredients, variant).map((sec) =>
    (sec.section ? `<h4 class="cook-sub">${esc(sec.section)}</h4>` : '')
    + sec.items.map((it) => {
      const n = i++;
      return `<button class="cook-item${it.swapped ? ' is-swapped' : ''}" type="button" data-i="${n}" aria-pressed="${prog.ing.has(n)}"><span class="cook-tick" aria-hidden="true"></span><span>${esc(it.text)}</span></button>`;
    }).join('')).join('')
    + `<button class="primary-btn cook-start" type="button" data-pane-go="steps">Start cooking →</button>`;

  const steps = (r.steps || []).flatMap((sec) => (sec.items || []).map((text, k) => ({ text, section: k === 0 ? sec.section : null })));
  const current = steps.findIndex((_, j) => !prog.steps.has(j));
  $('#cook-steps').innerHTML = `<h3 class="cook-h">Steps</h3>` + steps.map((st, j) =>
    (st.section ? `<h4 class="cook-sub">${esc(st.section)}</h4>` : '')
    + `<button class="cook-step${j === current ? ' is-current' : ''}" type="button" data-s="${j}" aria-pressed="${prog.steps.has(j)}"${j === current ? ' aria-current="step"' : ''}>
        <span class="cook-step-n">${j + 1}</span><span class="cook-step-text">${inlineMd(st.text)}</span></button>`).join('')
    + (current === -1 && steps.length ? `<p class="cook-done">All done — enjoy it.</p>` : '')
    + `<button class="link-btn cook-reset" type="button" data-reset="1">Reset ticks</button>`;
  $('#cook-progress').textContent = steps.length ? `${prog.steps.size}/${steps.length}` : '';
}

function onCookClick(e) {
  const prog = state.cook.slug ? cookProgressFor(state.cook.slug) : null;
  if (!prog) return;
  const toggle = (set, n) => (set.has(n) ? set.delete(n) : set.add(n));
  const item = e.target.closest('.cook-item');
  const step = e.target.closest('.cook-step');
  const pane = e.target.closest('[data-pane], [data-pane-go]');
  if (item) toggle(prog.ing, +item.dataset.i);
  else if (step) toggle(prog.steps, +step.dataset.s);
  else if (e.target.closest('[data-reset]')) { prog.ing.clear(); prog.steps.clear(); state.cook.pane = 'ing'; }
  else if (pane) state.cook.pane = pane.dataset.pane || pane.dataset.paneGo;
  else return;
  renderCook();
  if (pane) $('#cook .cook-body')?.scrollTo?.(0, 0);
}

function routeFromHash() {
  const route = parseHash(location.hash);
  if (route.type === 'recipe') { openReader(route.slug); return; }
  // A tab/home hash: close any open reader, then select the section it names and load
  // any filters/search/sort it carries.
  if (!$('#reader').hidden) closeReader();
  if (route.kind !== state.kind) setKind(route.kind, false);
  const want = route.query || '';
  const have = encodeRouteQuery({ filters: state.filters, q: state.q, sort: state.sort, all: state.showAll });
  if (want !== have) applyRouteQuery(want);
}

// Shareable, preview-friendly URL for a recipe: …/r/<slug>/ (a real path, unlike the
// in-app #/<slug> hash which link crawlers can't see).
function shareUrl(slug) {
  const base = location.origin + location.pathname.replace(/[^/]*$/, '');
  return `${base}r/${slug}/`;
}

function shareCurrentRecipe() {
  const r = state.reader.list[state.reader.index];
  if (!r) return;
  const url = shareUrl(r.slug);
  if (navigator.share) { navigator.share({ title: r.title, url }).catch(() => {}); return; }
  const btn = $('#reader-share');
  const done = () => {
    btn.classList.add('copied');              // CSS swaps the share glyph for a check
    clearTimeout(shareCurrentRecipe._t);
    shareCurrentRecipe._t = setTimeout(() => btn.classList.remove('copied'), 1800);
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done).catch(() => fallbackCopy(url, done));
  else fallbackCopy(url, done);
}

// ── shopping list ────────────────────────────────────────────────────────────
function toggleSelect(slug) {
  const wasCartOnly = state.cartOnly;
  const picked = !state.selected.has(slug);
  if (picked) state.selected.add(slug); else state.selected.delete(slug);
  saveSelected();
  reflectSelection(slug, picked);
  renderShopbar();   // may flip cartOnly off when that was the last item in the cart
  // In the "In cart" view, re-filter so a removed recipe leaves the grid (and the
  // view collapses gracefully when the last item goes). Preserve the scroll position
  // across the re-render — a full grid rebuild otherwise snaps the page toward the top
  // — but only while the cart view stays put; when the cart empties and we fall back
  // to the full grid, let it settle at the top as usual.
  if (wasCartOnly) {
    const keepScroll = state.cartOnly ? window.scrollY : null;
    apply();
    if (keepScroll != null) window.scrollTo(0, keepScroll);
  }
}

// Keep every control for this recipe in sync — the grid card's ✓ and the in-recipe
// "Add to list" button can both be on screen, and either can flip the selection.
function reflectSelection(slug, picked) {
  document.querySelectorAll(`.card-select[data-select="${CSS.escape(slug)}"]`).forEach((btn) => {
    btn.setAttribute('aria-pressed', picked);
    btn.setAttribute('aria-label', picked ? 'Remove from shopping list' : 'Add to shopping list');
    btn.closest('.card-wrap')?.classList.toggle('is-selected', picked);
  });
  document.querySelectorAll(`.spread-select[data-select="${CSS.escape(slug)}"]`).forEach((btn) => {
    btn.setAttribute('aria-pressed', picked);
    btn.setAttribute('aria-label', picked ? 'Remove from shopping list' : 'Add to shopping list');
  });
}

function renderShopbar() {
  const n = state.selected.size;
  $('#shopbar').hidden = n === 0;
  $('#shopbar-count').textContent = n;
  document.body.classList.toggle('has-cart', n > 0);   // lets CSS yield the masthead date
  // In-reader cart (the floating corner cart is hidden behind the reader overlay)
  const rc = $('#reader-cart');
  if (rc) { rc.hidden = n === 0; $('#reader-cart-count').textContent = n; }
  syncCartFilter();   // keep the "In cart" toggle's count/visibility current
}

function syncFormatToggle() {
  document.querySelectorAll('#format-toggle .fmt-btn')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.format === state.copyFormat)));
}

function openShopList() {
  if (!state.selected.size) return;
  $('#shoplist').hidden = false;
  document.body.style.overflow = 'hidden';
  renderShopList();
}

function closeShopList() {
  $('#shoplist').hidden = true;
  document.body.style.overflow = '';
}

function clearSelection() {
  const wasCartOnly = state.cartOnly;
  state.selected.clear();
  saveSelected();
  state.shop.items = [];
  state.shop.overrides.clear();
  $('#shoplist-body').innerHTML = '';          // never leave a stale list behind
  $('#week-list').innerHTML = '';
  document.querySelectorAll('.card-wrap.is-selected').forEach((w) => {
    w.classList.remove('is-selected');
    w.querySelector('.card-select')?.setAttribute('aria-pressed', 'false');
  });
  document.querySelectorAll('.spread-select[aria-pressed="true"]').forEach((b) => {
    b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', 'Add to shopping list');
  });
  renderShopbar();
  if (wasCartOnly) apply();   // cart emptied — drop the "In cart" view back to the full grid
  closeShopList();
}

// ── This week: picked dishes + the shopping list ─────────────────────────────
const servingsFor = (r) => state.servings.get(r.slug) ?? r.serves ?? 2;
function saveServings() {
  try { localStorage.setItem(SERVINGS_KEY, JSON.stringify(Object.fromEntries(state.servings))); } catch {}
}
const weekRecipes = () => [...state.selected].map((slug) => state.all.find((r) => r.slug === slug)).filter(Boolean);

// Every ingredient line of every picked dish, scaled to that dish's servings and with
// its active variant applied. Ids are stable (slug|section|line) so a reader's own
// check/uncheck choices survive re-renders, servings changes and view switches.
function shopRows() {
  const rows = [];
  for (const r of weekRecipes()) {
    const target = servingsFor(r);
    shopSectionsForRecipe(r, target, activeVariant(r)).forEach((sec, si) => sec.items.forEach((it, ii) => {
      rows.push({
        ...it, id: `${r.slug}|${si}|${ii}`, slug: r.slug, section: sec.section,
        // Shop for the top of a range ("1–1.25 lb" -> 1¼ lb) so you never come home short.
        qtyScaled: it.qty != null ? (it.hi ?? it.qty) * (target / (it.serves || target)) : null,
      });
    }));
  }
  return rows;
}
// Default: buy fresh/specialty items; staples and optional bits start unchecked.
const isChecked = (row) => (state.shop.overrides.has(row.id) ? state.shop.overrides.get(row.id) : row.cat === 'buy' && !row.optional);

const PANTRY_FLAG = ` <span class="pantry-flag" title="You likely have this — double-check your pantry">⚑</span>`;
const OPTIONAL_FLAG = ` <span class="pantry-flag" title="Optional — copied into its own section only if you check it">optional</span>`;

function renderShopList() {
  const recipes = weekRecipes();
  $('#week-list').innerHTML = recipes.map((r) => {
    const v = activeVariant(r);
    const n = servingsFor(r);
    return `
    <li class="week-item lane-${laneFor(r)}">
      <button class="week-open" type="button" data-open="${esc(r.slug)}" title="Open the recipe">
        <span class="week-thumb card-visual">${visualHtml(r)}</span>
        <span class="week-text"><span class="week-title">${esc(r.title)}</span>
          <span class="week-sub">${esc(laneLabel(r))} · ${esc(fmtMin(r.times.total))}${v ? ` · <span class="shop-variant" title="${esc(variantTitle(v))}">⇄ ${esc(variantLabel(v))}</span>` : ''}</span></span>
      </button>
      <div class="week-serves" role="group" aria-label="${esc(`Servings for ${r.title}`)}">
        <button type="button" class="step-btn" data-serves="-1" data-slug="${esc(r.slug)}" aria-label="Fewer servings"${n <= 1 ? ' disabled' : ''}>−</button>
        <span class="week-serves-n">${n}</span>
        <button type="button" class="step-btn" data-serves="1" data-slug="${esc(r.slug)}" aria-label="More servings"${n >= 50 ? ' disabled' : ''}>+</button>
      </div>
      <button type="button" class="week-remove" data-remove="${esc(r.slug)}" aria-label="${esc(`Remove ${r.title} from this week`)}">×</button>
    </li>`;
  }).join('');
  document.querySelectorAll('#shop-mode [data-shopmode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.shopmode === state.shopMode)));
  const rows = shopRows();
  state.shop.items = rows;
  $('#shoplist-body').innerHTML = !rows.length ? '<p class="shop-empty">Nothing picked yet.</p>'
    : state.shopMode === 'recipe' ? recipeViewHtml(recipes, rows) : aisleViewHtml(rows);
  updateSummary();
}

// By recipe: each dish's own lines, as written (scaled), one checkbox per line.
function recipeViewHtml(recipes, rows) {
  return recipes.map((r) => {
    const mine = rows.filter((row) => row.slug === r.slug);
    let lastSection;
    const body = mine.map((it) => {
      const head = it.section && it.section !== lastSection ? `<div class="shop-section">${esc(it.section)}</div>` : '';
      lastSection = it.section;
      const flag = it.optional ? OPTIONAL_FLAG : it.cat === 'pantry' ? PANTRY_FLAG : '';
      return `${head}<label class="shop-item${it.cat !== 'buy' || it.optional ? ' is-staple' : ''}">
          <input type="checkbox" data-ids="${esc(it.id)}"${isChecked(it) ? ' checked' : ''} />
          <span class="shop-qty">${esc(it.display)}</span>${flag}
        </label>`;
    }).join('');
    const n = servingsFor(r);
    const note = r.serves && r.serves !== n ? `<span class="shop-recipe-serves"> · scaled from ${r.serves} to ${n}</span>` : '';
    const v = activeVariant(r);
    const vnote = v ? ` <span class="shop-variant" title="${esc(variantTitle(v))}">⇄ ${esc(variantLabel(v))} variant</span>` : '';
    return `<div class="shop-recipe lane-${laneFor(r)}"><div class="shop-recipe-title">${esc(r.title)}${vnote}${note}</div>${body}</div>`;
  }).join('');
}

// By aisle: identical ingredients merged across dishes into what you actually buy,
// grouped in store order. One checkbox covers every dish's line for that item.
function aisleViewHtml(rows) {
  const { aisles, optional } = groupByAisle(rows.map((r) => ({ id: r.id, qty: r.qtyScaled, rest: r.rest, optional: r.optional, cat: r.cat })));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const line = (it, opt) => {
    const checked = it.ids.some((id) => isChecked(byId.get(id)));
    const cats = it.cats || [];
    const staple = opt || !cats.includes('buy');
    const flag = opt ? '' : !cats.includes('buy') && cats.includes('pantry') ? PANTRY_FLAG : '';
    const dishes = new Set(it.ids.map((id) => id.split('|')[0])).size;   // ids are slug|section|line
    const meta = dishes > 1 ? `<span class="shop-line-meta">${dishes} dishes</span>` : '';
    return `<label class="shop-line${staple ? ' is-staple' : ''}">
        <input type="checkbox" data-ids="${esc(it.ids.join(' '))}"${checked ? ' checked' : ''} />
        <span class="shop-line-text">${esc(it.line)}</span>${flag}${meta}
      </label>`;
  };
  return aisles.map((a) => `
    <section class="aisle"><h3 class="aisle-h">${esc(a.aisle)} <span class="aisle-n">${a.items.length}</span></h3>
      ${a.items.map((it) => line(it, false)).join('')}
    </section>`).join('')
    + (optional.length ? `<section class="aisle"><h3 class="aisle-h">Optional <span class="aisle-n">${optional.length}</span></h3>
      ${optional.map((it) => line({ ...it, count: 1 }, true)).join('')}</section>` : '');
}

function onWeekClick(e) {
  const step = e.target.closest('[data-serves]');
  if (step) {
    const r = state.all.find((x) => x.slug === step.dataset.slug);
    if (!r) return;
    state.servings.set(r.slug, clampServes(servingsFor(r) + Number(step.dataset.serves)) || 1);
    saveServings();
    renderShopList();
    return;
  }
  const rm = e.target.closest('[data-remove]');
  if (rm) {
    toggleSelect(rm.dataset.remove);
    if (!state.selected.size) closeShopList(); else renderShopList();
    return;
  }
  const open = e.target.closest('[data-open]');
  if (open) { closeShopList(); openReader(open.dataset.open); }
}

function updateSummary() {
  const n = state.selected.size;
  const checked = document.querySelectorAll('.shoplist-body input:checked').length;
  $('#shop-summary').textContent =
    `${n} dish${n !== 1 ? 'es' : ''} · ${checked} item${checked !== 1 ? 's' : ''} checked`;
}

// Scaled { qty, rest } entries for every checked row, or null if nothing's checked —
// shared by the clipboard, Reminders, and Share actions (independent of the view).
function checkedEntries() {
  const rows = state.shop.items.filter(isChecked);
  return rows.length ? rows.map((r) => ({ qty: r.qtyScaled, rest: r.rest })) : null;
}

function copyShoppingList() {
  const entries = checkedEntries();
  if (!entries) { flashCopied('Nothing checked'); return; }
  const text = formatShoppingList(buildAisleList(entries), state.copyFormat);
  const done = (msg) => flashCopied(msg);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => done('Copied ✓')).catch(() => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}

// Hands checked items to a Shortcut (installed once by Stephen) that adds each
// one as its own reminder in the Groceries list. There's no web API into
// Reminders — shortcuts:// is Apple's sanctioned bridge for this.
function sendToReminders() {
  const entries = checkedEntries();
  if (!entries) { flashCopied('Nothing checked'); return; }
  const text = formatShoppingList(buildAisleList(entries), 'plain');
  const url = `shortcuts://run-shortcut?name=${encodeURIComponent(REMINDERS_SHORTCUT_NAME)}&input=text&text=${encodeURIComponent(text)}`;
  flashCopied('Opening Shortcuts…');
  location.assign(url);
}

// No-setup fallback: hands the list to the iOS share sheet. Reminders will file
// it as a single reminder with the items in its notes, not separate checkable
// items — that's the tradeoff for skipping the Shortcut setup.
function shareShoppingList() {
  const entries = checkedEntries();
  if (!entries) { flashCopied('Nothing checked'); return; }
  const text = formatShoppingList(buildAisleList(entries), 'plain');
  if (navigator.share) { navigator.share({ title: 'Grocery list', text }).catch(() => {}); return; }
  const done = (msg) => flashCopied(msg);
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => done('Copied ✓')).catch(() => fallbackCopy(text, done));
  else fallbackCopy(text, done);
}

function toggleRemindersHelp(show) {
  $('#reminders-help').hidden = !show;
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done('Copied ✓'); } catch { done('Copy failed'); }
  document.body.removeChild(ta);
}

function flashCopied(msg) {
  const el = $('#shop-copied');
  el.textContent = msg; el.hidden = false;
  clearTimeout(flashCopied._t);
  flashCopied._t = setTimeout(() => { el.hidden = true; }, 1800);
}

// Expose state for the test harness; auto-boot in the browser only.
export { state };
if (typeof window !== 'undefined' && !globalThis.__NO_AUTO_INIT__) init();
