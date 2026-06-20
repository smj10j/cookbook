/* ===========================================================================
   Tonight's Menu — DOM wiring + rendering. Pure logic lives in lib.js (tested).
   Loaded as <script type="module">, so this runs after the DOM is parsed.
   =========================================================================== */
import {
  esc, inlineMd, cap, fmtMin, VEG,
  scaleDisplay, classify, clampServes,
  buildShoppingList, formatShoppingList, recipeMatches, cuisineChipValues, shopSectionsForRecipe,
} from './lib.js';

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
  },
  reader: { list: [], index: -1 },
  selected: new Set(),     // slugs picked for the shopping list (persisted)
  shop: { items: [] },     // current overlay item rows
  copyFormat: 'dash',      // 'dash' | 'checkbox' (persisted)
};

// Curated flavor tags that become the Drinks "Flavor" filter (kept tight on purpose).
const DRINK_FLAVORS = ['citrusy', 'tropical', 'creamy', 'fruity', 'herbal', 'smoky', 'spicy', 'dessert', 'refreshing', 'boozy'];

// Hero copy per section.
const HERO = {
  food: {
    kicker: 'The dinner archive',
    headline: 'Dinners we keep <em>coming&nbsp;back</em> to.',
    lede: 'A living flipbook of the recipes worth repeating — pitched like a menu, filtered like a pantry. Pick a night’s craving and turn the page.',
  },
  drink: {
    kicker: 'The home bar',
    headline: 'Drinks worth <em>shaking</em> for.',
    lede: 'A flipbook of the cocktails we keep coming back to — pitched like a bar menu, filtered like a liquor cabinet. Pick a mood and turn the page.',
  },
};

const SELECT_KEY = 'tm-selected';
const FORMAT_KEY = 'tm-copyformat';
function loadSelected() {
  try { JSON.parse(localStorage.getItem(SELECT_KEY) || '[]').forEach((s) => state.selected.add(s)); } catch {}
  try { const f = localStorage.getItem(FORMAT_KEY); if (f === 'dash' || f === 'checkbox') state.copyFormat = f; } catch {}
}
function saveSelected() {
  try { localStorage.setItem(SELECT_KEY, JSON.stringify([...state.selected])); } catch {}
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
  loadSelected();
  // drop any persisted slugs that no longer exist
  const valid = new Set(state.all.map((r) => r.slug));
  [...state.selected].forEach((s) => valid.has(s) || state.selected.delete(s));
  setHero();
  buildFilters();
  bindEvents();
  apply();
  renderShopbar();
  syncFormatToggle();
  const c = state.data.counts || { food: state.all.length, drink: 0 };
  $('#colophon-meta').textContent = `${c.food} recipes · ${c.drink} drinks and counting`;
  routeFromHash();
}

// Swap the hero copy for the active section.
function setHero() {
  const h = HERO[state.kind] || HERO.food;
  $('.hero-kicker').textContent = h.kicker;
  $('.hero-headline').innerHTML = h.headline;
  $('.hero-lede').textContent = h.lede;
}

// Switch tabs: set the kind, reset search + filters (they differ per section), rebuild.
function setKind(kind) {
  if (kind !== 'food' && kind !== 'drink') return;
  state.kind = kind;
  state.q = '';
  $('#search').value = '';
  Object.values(state.filters).forEach((s) => s.clear());
  document.querySelectorAll('#tabs .tab').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
  setHero();
  buildFilters();
  apply();
}

function setDate() {
  $('#masthead-date').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// ── filters ─────────────────────────────────────────────────────────────────
function buildFilters() {
  const { data } = state;
  const kindRecipes = state.all.filter((r) => (r.kind || 'food') === state.kind);
  const present = (vocab, pluck) => {
    const found = new Set();
    kindRecipes.forEach((r) => [].concat(pluck(r)).filter((v) => v != null).forEach((v) => found.add(v)));
    return vocab.filter((v) => found.has(v));
  };
  const flavorsPresent = new Set(kindRecipes.flatMap((r) => r.tags || []));
  const groups = state.kind === 'drink'
    ? [
        { key: 'base', label: 'Base', values: present(data.vocab.base, (r) => r.base), labelFor: (v) => data.meta.base[v]?.label || cap(v) },
        { key: 'family', label: 'Style', values: present(data.vocab.family, (r) => r.family), labelFor: (v) => data.meta.family[v]?.label || cap(v) },
        { key: 'strength', label: 'Strength', values: present(data.vocab.strength, (r) => r.strength), labelFor: (v) => data.meta.strength[v]?.label || cap(v) },
        { key: 'tags', label: 'Flavor', values: DRINK_FLAVORS.filter((f) => flavorsPresent.has(f)), labelFor: cap },
        { key: 'heat', label: 'Heat', values: present(data.vocab.heat, (r) => r.heat).filter((h) => h !== 'none'), labelFor: cap },
      ]
    : [
        { key: 'category', label: 'Course', values: present(data.vocab.category, (r) => r.category), labelFor: cap },
        { key: 'protein', label: 'Protein', values: present(data.vocab.protein, (r) => r.protein), labelFor: (v) => data.meta.protein[v]?.label || cap(v) },
        { key: 'course', label: 'Dish', values: present(data.vocab.course, (r) => r.course).filter((c) => !['main', 'side', 'dessert'].includes(c)), labelFor: cap },
        { key: 'methods', label: 'Method', values: present(data.vocab.methods, (r) => r.methods), labelFor: (v) => data.meta.method[v]?.label || cap(v) },
        { key: 'time', label: 'Time', values: data.timeBuckets.map((b) => b.key), labelFor: (k) => data.timeBuckets.find((b) => b.key === k).label },
        { key: 'heat', label: 'Heat', values: present(data.vocab.heat, (r) => r.heat).filter((h) => h !== 'none'), labelFor: cap },
        { key: 'cuisine', label: 'Cuisine', values: cuisineChipValues(kindRecipes, data.cuisineGroups || {}), labelFor: (v) => v },
      ];
  $('#filter-groups').innerHTML = groups
    .filter((g) => g.values.length > 1 || g.key === 'time')
    .map((g) => `
    <div class="filter-group" data-group="${g.key}">
      <span class="filter-group-label">${g.label}</span>
      <div class="chips">
        ${g.values.map((v) => {
          const cls = g.key === 'protein' && VEG.has(v) ? 'chip chip-veg' : g.key === 'heat' ? 'chip chip-hot' : 'chip';
          return `<button class="${cls}" type="button" aria-pressed="false" data-key="${g.key}" data-val="${esc(v)}">${esc(g.labelFor(v))}</button>`;
        }).join('')}
      </div>
    </div>`).join('');
}

function bindEvents() {
  $('#tabs').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (t && t.dataset.kind !== state.kind) setKind(t.dataset.kind);
  });
  $('#search').addEventListener('input', (e) => { state.q = e.target.value.trim().toLowerCase(); apply(); });
  $('#filter-groups').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    const { key, val } = btn.dataset;
    const set = state.filters[key];
    if (set.has(val)) set.delete(val); else set.add(val);
    btn.setAttribute('aria-pressed', set.has(val));
    apply();
  });
  $('#clear-filters').addEventListener('click', clearFilters);
  $('#empty-clear').addEventListener('click', clearFilters);
  $('#menu').addEventListener('click', (e) => {
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
  $('#shop-serves').addEventListener('input', updateQuantities);
  $('#shop-copy').addEventListener('click', copyShoppingList);
  $('#shop-clear').addEventListener('click', clearSelection);
  $('#format-toggle').addEventListener('click', (e) => {
    const b = e.target.closest('.fmt-btn');
    if (!b) return;
    state.copyFormat = b.dataset.format;
    try { localStorage.setItem(FORMAT_KEY, state.copyFormat); } catch {}
    syncFormatToggle();
  });
  $('#shoplist-body').addEventListener('change', updateSummary);
  $('#reader-close').addEventListener('click', closeReader);
  $('#reader-share').addEventListener('click', shareCurrentRecipe);
  $('#spread').addEventListener('click', (e) => {
    const sel = e.target.closest('.spread-select');
    if (!sel) return;
    e.stopPropagation();
    toggleSelect(sel.dataset.select);
  });
  $('#reader-prev').addEventListener('click', () => flip(-1));
  $('#reader-next').addEventListener('click', () => flip(1));
  $('#reader').addEventListener('click', (e) => { if (e.target === $('#reader')) closeReader(); });
  document.addEventListener('keydown', (e) => {
    if (!$('#shoplist').hidden) { if (e.key === 'Escape') closeShopList(); return; }
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
  Object.values(state.filters).forEach((s) => s.clear());
  document.querySelectorAll('.chip[aria-pressed="true"]').forEach((c) => c.setAttribute('aria-pressed', 'false'));
  apply();
}

function apply() {
  const ctx = { q: state.q, filters: state.filters, cuisineGroups: state.data.cuisineGroups || {}, timeBuckets: state.data.timeBuckets || [] };
  state.filtered = state.all.filter((r) => (r.kind || 'food') === state.kind && recipeMatches(r, ctx));
  renderMenu();
}

// ── menu (cards) ─────────────────────────────────────────────────────────────
function renderMenu() {
  const list = state.filtered;
  const total = state.all.filter((r) => (r.kind || 'food') === state.kind).length;
  const noun = state.kind === 'drink' ? 'drink' : 'recipe';
  const active = state.q || Object.values(state.filters).some((s) => s.size);
  $('#clear-filters').hidden = !active;
  $('#result-count').textContent = active ? `${list.length} of ${total} ${noun}s` : `${total} ${noun}s`;
  $('#empty-state').hidden = list.length > 0;
  $('#menu').innerHTML = list.map((r, i) => cardHtml(r, i)).join('');
}

// Card eyebrow tags — protein/method/heat for food; base/style/heat for a drink.
function cardTags(r) {
  const M = state.data.meta;
  if (r.kind === 'drink') {
    return [
      `<span class="tag tag-protein">${esc(M.base[r.base]?.label || r.base)}</span>`,
      `<span class="tag">${esc(M.family[r.family]?.label || r.family)}</span>`,
      r.heat !== 'none' ? `<span class="tag tag-hot">${esc(cap(r.heat))} heat</span>` : '',
    ].filter(Boolean).join('');
  }
  return [
    `<span class="tag tag-protein">${esc(M.protein[r.protein]?.label || r.protein)}</span>`,
    ...(r.methods || []).slice(0, 2).map((m) => `<span class="tag">${esc(M.method[m]?.label || m)}</span>`),
    r.heat !== 'none' ? `<span class="tag tag-hot">${esc(cap(r.heat))} heat</span>` : '',
  ].filter(Boolean).join('');
}

function cardHtml(r, i) {
  const tags = cardTags(r);
  const num = String(i + 1).padStart(2, '0');
  const picked = state.selected.has(r.slug);
  return `
  <div class="card-wrap${picked ? ' is-selected' : ''}">
    <button class="card-select" type="button" data-select="${esc(r.slug)}"
      aria-pressed="${picked}" aria-label="${picked ? 'Remove from' : 'Add to'} shopping list" title="Add to shopping list">
      <svg class="card-select-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
      <svg class="card-select-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
    </button>
    <button class="card" data-slug="${esc(r.slug)}" style="animation-delay:${Math.min(i * 45, 540)}ms">
      <div class="card-visual">${visualHtml(r, num)}</div>
      <div class="card-body">
        <div class="card-tags">${tags}</div>
        <h3 class="card-title">${esc(r.title)}</h3>
        <p class="card-tagline">${esc(r.tagline)}</p>
        <div class="card-foot">
          <span class="choose">Open this →</span>
          <span class="time">≈ ${r.times.total} min</span>
        </div>
      </div>
    </button>
  </div>`;
}

function visualHtml(r, num) {
  if (r.hero) {
    return `<img src="${esc(r.hero)}" alt="${esc(r.title)}" loading="lazy"
      onerror="this.closest('.card-visual').innerHTML = this.dataset.fallback"
      data-fallback='${placeholderHtml(r, num).replace(/'/g, '&#39;')}' />`;
  }
  return placeholderHtml(r, num);
}

// "Cuisine · Dish" for food; "Base · Style" for a drink. Returns an escaped string.
function subline(r) {
  const M = state.data.meta;
  return r.kind === 'drink'
    ? `${esc(M.base[r.base]?.label || r.base)} · ${esc(M.family[r.family]?.label || r.family)}`
    : `${esc(r.cuisine)} · ${esc(cap(r.course))}`;
}

function placeholderHtml(r, num) {
  return `<span class="placeholder-num">${num}</span>
    <div class="placeholder">
      <div class="placeholder-plate">${esc(r.title)}</div>
      <div class="placeholder-sub">${subline(r)}</div>
    </div>`;
}

// ── reader / flipbook ────────────────────────────────────────────────────────
function openReader(slug, dir = 0) {
  const target = state.all.find((r) => r.slug === slug);
  if (!target) return;
  // Arriving at a recipe from the other section (e.g. a shared drink link) flips the tab.
  if ((target.kind || 'food') !== state.kind) setKind(target.kind || 'food');
  const kindList = state.all.filter((r) => (r.kind || 'food') === state.kind);
  let list = state.filtered.length ? state.filtered : kindList;
  let index = list.findIndex((r) => r.slug === slug);
  if (index === -1) { list = kindList; index = list.findIndex((r) => r.slug === slug); }
  if (index === -1) return;
  state.reader = { list, index };
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
  if (location.hash.startsWith('#/')) history.replaceState(null, '', location.pathname + location.search);
}

function renderSpread(dir) {
  const { list, index } = state.reader;
  const r = list[index];
  const stage = $('#spread');
  const animate = dir !== 0 && typeof matchMedia === 'function'
    && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const outgoing = animate ? stage.innerHTML : null;   // snapshot the page we're leaving
  stage.innerHTML = spreadHtml(r);
  $('#reader-prev').disabled = index <= 0;
  $('#reader-next').disabled = index >= list.length - 1;
  const scroller = stage.querySelector('.spread-scroll');
  if (scroller) scroller.scrollTop = 0;
  if (animate) turnPage(outgoing, dir);
}

// A real page-turn: the page we just left is cloned into a "leaf" that lifts and rotates
// away around the spine (right edge swings toward you going forward; left edge going back),
// revealing the new page already sitting flat beneath it. A sweeping shade darkens the
// leaf as it turns. The live #spread never animates — only this throwaway leaf does — so
// the mobile-WebKit "snap to final frame" bug (animating an overflow:auto layer) can't bite.
function turnPage(outgoingHtml, dir) {
  const stage = $('#spread');
  const book = stage.parentElement;                     // .reader-stage (perspective layer)
  book.querySelectorAll('.turn-leaf').forEach((l) => l.remove());   // never stack leaves
  const leaf = document.createElement('div');
  leaf.className = `spread turn-leaf ${dir > 0 ? 'turn-next' : 'turn-prev'}`;
  leaf.setAttribute('aria-hidden', 'true');
  leaf.innerHTML = `${outgoingHtml}<div class="turn-shade" aria-hidden="true"></div>`;
  book.appendChild(leaf);
  const done = () => leaf.remove();
  leaf.addEventListener('animationend', done, { once: true });
  setTimeout(done, 1500);                               // fallback if animationend never fires
}

function sectionsHtml(sections, kind) {
  return sections.map((s) => {
    const head = s.section ? `<h4 class="subsection-h">${esc(s.section)}</h4>` : '';
    if (kind === 'ing') return head + `<ul class="ing-list">${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
    return head + `<ol class="step-list">${s.items.map((i) => `<li>${inlineMd(i)}</li>`).join('')}</ol>`;
  }).join('');
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
      `<span class="schip">${esc(M.base[r.base]?.label || r.base)}</span>`,
      `<span class="schip">${esc(M.family[r.family]?.label || r.family)}</span>`,
      ...(r.methods || []).map((m) => `<span class="schip">${esc(M.method[m]?.label || m)}</span>`),
      r.strength ? `<span class="schip">${esc(M.strength[r.strength]?.label || cap(r.strength))}</span>` : '',
      r.heat !== 'none' ? `<span class="schip is-hot">${esc(cap(r.heat))} heat</span>` : '',
      ...(r.tags || []).map((t) => `<span class="schip">${esc(t)}</span>`),
    ].filter(Boolean).join('');
  }
  return [
    `<span class="schip${VEG.has(r.protein) ? ' is-veg' : ''}">${esc(M.protein[r.protein]?.label || r.protein)}</span>`,
    ...(r.methods || []).map((m) => `<span class="schip">${esc(M.method[m]?.label || m)}</span>`),
    r.heat !== 'none' ? `<span class="schip is-hot">${esc(cap(r.heat))} heat</span>` : '',
    ...(r.tags || []).map((t) => `<span class="schip">${esc(t)}</span>`),
  ].filter(Boolean).join('');
}

function spreadHtml(r) {
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
    <div class="spread-inner">
      <p class="spread-kicker">${subline(r)}</p>
      <h2 class="spread-title">${esc(r.title)}</h2>
      <p class="spread-tagline">${esc(r.tagline)}</p>
      <div class="spread-meta">${meta}</div>
      <div class="spread-chips">${chips}</div>
      <p class="spread-pitch">${inlineMd(r.pitch)}</p>
      <div class="spread-columns">
        <div class="col-ingredients"><div class="section-h">Ingredients</div>${sectionsHtml(r.ingredients, 'ing')}</div>
        <div class="col-steps"><div class="section-h">Method</div>${sectionsHtml(r.steps, 'step')}${tips}${extras}</div>
      </div>
      ${headnote}
      ${source}
    </div>
    </div>`;
}

function routeFromHash() {
  const m = location.hash.match(/^#\/(.+)$/);
  if (m) openReader(decodeURIComponent(m[1]));
  else if (!$('#reader').hidden) closeReader();
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
  const picked = !state.selected.has(slug);
  if (picked) state.selected.add(slug); else state.selected.delete(slug);
  saveSelected();
  reflectSelection(slug, picked);
  renderShopbar();
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
  state.selected.clear();
  saveSelected();
  state.shop.items = [];
  $('#shoplist-body').innerHTML = '';          // never leave a stale list behind
  document.querySelectorAll('.card-wrap.is-selected').forEach((w) => {
    w.classList.remove('is-selected');
    w.querySelector('.card-select')?.setAttribute('aria-pressed', 'false');
  });
  document.querySelectorAll('.spread-select[aria-pressed="true"]').forEach((b) => {
    b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', 'Add to shopping list');
  });
  renderShopbar();
  closeShopList();
}

function renderShopList() {
  const target = clampServes($('#shop-serves').value) || 2;
  const recipes = state.all.filter((r) => state.selected.has(r.slug));
  const items = [];
  let idx = 0;
  const html = recipes.map((r) => {
    const body = shopSectionsForRecipe(r, target).map((sec) => {
      const head = sec.section ? `<div class="shop-section">${esc(sec.section)}</div>` : '';
      const rows = sec.items.map((it) => {
        const i = idx++;
        items.push(it);
        const checked = it.cat === 'buy' && !it.optional;
        const flag = it.optional
          ? ` <span class="pantry-flag" title="Optional — copied into its own section only if you check it">optional</span>`
          : it.cat === 'pantry'
          ? ` <span class="pantry-flag" title="You likely have this — double-check your pantry">⚑</span>` : '';
        return `<label class="shop-item${it.cat !== 'buy' || it.optional ? ' is-staple' : ''}">
          <input type="checkbox" data-idx="${i}"${checked ? ' checked' : ''} />
          <span class="shop-qty" data-idx="${i}">${esc(it.display)}</span>${flag}
        </label>`;
      }).join('');
      return head + rows;
    }).join('');
    const note = r.serves ? `<span class="shop-recipe-serves"> · scaled from ${r.serves}</span>` : '';
    return `<div class="shop-recipe"><div class="shop-recipe-title">${esc(r.title)}${note}</div>${body}</div>`;
  }).join('');
  $('#shoplist-body').innerHTML = html || '<p style="color:var(--stone)">No recipes selected.</p>';
  state.shop.items = items;
  updateSummary();
}

function updateQuantities() {
  const target = clampServes($('#shop-serves').value);
  if (target == null) return;
  state.shop.items.forEach((item, i) => {
    const span = document.querySelector(`.shop-qty[data-idx="${i}"]`);
    if (span) span.textContent = scaleDisplay(item, target / (item.serves || target));
  });
}

function updateSummary() {
  const recipes = state.selected.size;
  const checked = document.querySelectorAll('.shoplist-body input:checked').length;
  $('#shop-summary').textContent =
    `${recipes} recipe${recipes !== 1 ? 's' : ''} · ${checked} item${checked !== 1 ? 's' : ''} checked`;
}

function copyShoppingList() {
  const checks = [...document.querySelectorAll('.shoplist-body input[type=checkbox]:checked')];
  if (!checks.length) { flashCopied('Nothing checked'); return; }
  const target = clampServes($('#shop-serves').value) || 2;
  const entries = checks.map((cb) => {
    const item = state.shop.items[+cb.dataset.idx];
    const qty = item.qty != null ? item.qty * (target / (item.serves || target)) : null;
    return { qty, rest: item.rest };
  });
  const text = formatShoppingList(buildShoppingList(entries), state.copyFormat);
  const done = (msg) => flashCopied(msg);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => done('Copied ✓')).catch(() => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
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
