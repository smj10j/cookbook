/* ===========================================================================
   Tonight's Menu — DOM wiring + rendering. Pure logic lives in lib.js (tested).
   Loaded as <script type="module">, so this runs after the DOM is parsed.
   =========================================================================== */
import {
  esc, inlineMd, cap, fmtMin, VEG,
  scaleDisplay, classify, clampServes,
  aggregateShoppingLines, recipeMatches, cuisineChipValues, shopSectionsForRecipe,
} from './lib.js';

const state = {
  all: [],
  data: null,
  filtered: [],
  q: '',
  filters: { category: new Set(), protein: new Set(), course: new Set(), methods: new Set(), heat: new Set(), cuisine: new Set(), time: new Set() },
  reader: { list: [], index: -1 },
  selected: new Set(),     // slugs picked for the shopping list (persisted)
  shop: { items: [] },     // current overlay item rows
};

const SELECT_KEY = 'tm-selected';
function loadSelected() {
  try { JSON.parse(localStorage.getItem(SELECT_KEY) || '[]').forEach((s) => state.selected.add(s)); } catch {}
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
  buildFilters();
  bindEvents();
  apply();
  renderShopbar();
  $('#colophon-meta').textContent = `${state.all.length} recipes and counting`;
  routeFromHash();
}

function setDate() {
  $('#masthead-date').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// ── filters ─────────────────────────────────────────────────────────────────
function buildFilters() {
  const { all, data } = state;
  const present = (key, pluck) => {
    const found = new Set();
    all.forEach((r) => [].concat(pluck(r)).forEach((v) => found.add(v)));
    return key.filter((v) => found.has(v));
  };
  const groups = [
    { key: 'category', label: 'Course', values: present(data.vocab.category, (r) => r.category), labelFor: cap },
    { key: 'protein', label: 'Protein', values: present(data.vocab.protein, (r) => r.protein), labelFor: (v) => data.meta.protein[v]?.label || cap(v) },
    { key: 'course', label: 'Dish', values: present(data.vocab.course, (r) => r.course).filter((c) => c !== 'main' && c !== 'side'), labelFor: cap },
    { key: 'methods', label: 'Method', values: present(data.vocab.methods, (r) => r.methods), labelFor: (v) => data.meta.method[v]?.label || cap(v) },
    { key: 'time', label: 'Time', values: data.timeBuckets.map((b) => b.key), labelFor: (k) => data.timeBuckets.find((b) => b.key === k).label },
    { key: 'heat', label: 'Heat', values: present(data.vocab.heat, (r) => r.heat).filter((h) => h !== 'none'), labelFor: cap },
    { key: 'cuisine', label: 'Cuisine', values: cuisineChipValues(all, data.cuisineGroups || {}), labelFor: (v) => v },
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
  $('#shoplist-close').addEventListener('click', closeShopList);
  $('#shoplist').addEventListener('click', (e) => { if (e.target === $('#shoplist')) closeShopList(); });
  $('#shop-serves').addEventListener('input', updateQuantities);
  $('#shop-copy').addEventListener('click', copyShoppingList);
  $('#shop-clear').addEventListener('click', clearSelection);
  $('#shoplist-body').addEventListener('change', updateSummary);
  $('#reader-close').addEventListener('click', closeReader);
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
  state.filtered = state.all.filter((r) => recipeMatches(r, ctx));
  renderMenu();
}

// ── menu (cards) ─────────────────────────────────────────────────────────────
function renderMenu() {
  const list = state.filtered;
  const active = state.q || Object.values(state.filters).some((s) => s.size);
  $('#clear-filters').hidden = !active;
  $('#result-count').textContent = active ? `${list.length} of ${state.all.length} recipes` : `${state.all.length} recipes`;
  $('#empty-state').hidden = list.length > 0;
  $('#menu').innerHTML = list.map((r, i) => cardHtml(r, i)).join('');
}

function cardHtml(r, i) {
  const tags = [
    `<span class="tag tag-protein">${esc(state.data.meta.protein[r.protein]?.label || r.protein)}</span>`,
    ...r.methods.slice(0, 2).map((m) => `<span class="tag">${esc(state.data.meta.method[m]?.label || m)}</span>`),
    r.heat !== 'none' ? `<span class="tag tag-hot">${esc(cap(r.heat))} heat</span>` : '',
  ].filter(Boolean).join('');
  const num = String(i + 1).padStart(2, '0');
  const picked = state.selected.has(r.slug);
  return `
  <div class="card-wrap${picked ? ' is-selected' : ''}">
    <button class="card-select" type="button" data-select="${esc(r.slug)}"
      aria-pressed="${picked}" aria-label="Add ${esc(r.title)} to shopping list" title="Add to shopping list">✓</button>
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

function placeholderHtml(r, num) {
  return `<span class="placeholder-num">${num}</span>
    <div class="placeholder">
      <div class="placeholder-plate">${esc(r.title)}</div>
      <div class="placeholder-sub">${esc(r.cuisine)} · ${esc(cap(r.course))}</div>
    </div>`;
}

// ── reader / flipbook ────────────────────────────────────────────────────────
function openReader(slug, dir = 0) {
  let list = state.filtered.length ? state.filtered : state.all;
  let index = list.findIndex((r) => r.slug === slug);
  if (index === -1) { list = state.all; index = list.findIndex((r) => r.slug === slug); }
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
  stage.innerHTML = spreadHtml(r);
  $('#reader-prev').disabled = index <= 0;
  $('#reader-next').disabled = index >= list.length - 1;
  stage.scrollTop = 0;
  if (dir !== 0 && typeof matchMedia === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const cls = dir > 0 ? 'flip-next' : 'flip-prev';
    stage.classList.remove('flip-next', 'flip-prev');
    void stage.offsetWidth; // reflow to restart animation
    stage.classList.add(cls);
  }
}

function sectionsHtml(sections, kind) {
  return sections.map((s) => {
    const head = s.section ? `<h4 class="subsection-h">${esc(s.section)}</h4>` : '';
    if (kind === 'ing') return head + `<ul class="ing-list">${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
    return head + `<ol class="step-list">${s.items.map((i) => `<li>${inlineMd(i)}</li>`).join('')}</ol>`;
  }).join('');
}

function spreadHtml(r) {
  const M = state.data.meta;
  const heroPlaceholder = `<div class="placeholder"><div class="placeholder-plate">${esc(r.title)}</div>
        <div class="placeholder-sub">${esc(r.cuisine)} · ${esc(cap(r.course))}</div></div>`;
  const heroInner = r.hero
    ? `<img src="${esc(r.hero)}" alt="${esc(r.title)}"
         onerror="this.closest('.spread-hero').innerHTML = this.dataset.fallback"
         data-fallback='${heroPlaceholder.replace(/'/g, '&#39;')}' />`
    : heroPlaceholder;

  const chips = [
    `<span class="schip${VEG.has(r.protein) ? ' is-veg' : ''}">${esc(M.protein[r.protein]?.label || r.protein)}</span>`,
    ...r.methods.map((m) => `<span class="schip">${esc(M.method[m]?.label || m)}</span>`),
    r.heat !== 'none' ? `<span class="schip is-hot">${esc(cap(r.heat))} heat</span>` : '',
    ...r.tags.map((t) => `<span class="schip">${esc(t)}</span>`),
  ].filter(Boolean).join('');

  const meta = [
    ['Serves', r.serves], ['Prep', fmtMin(r.times.prep)], ['Cook', fmtMin(r.times.cook)],
    ['Total', fmtMin(r.times.total)], ['Level', cap(r.difficulty)],
  ].map(([l, v]) => `<div><div class="m-label">${l}</div><div class="m-value">${esc(v)}</div></div>`).join('');

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
    <div class="spread-hero">${heroInner}</div>
    <div class="spread-inner">
      <p class="spread-kicker">${esc(r.cuisine)} · ${esc(cap(r.course))}</p>
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
    </div>`;
}

function routeFromHash() {
  const m = location.hash.match(/^#\/(.+)$/);
  if (m) openReader(decodeURIComponent(m[1]));
  else if (!$('#reader').hidden) closeReader();
}

// ── shopping list ────────────────────────────────────────────────────────────
function toggleSelect(slug) {
  if (state.selected.has(slug)) state.selected.delete(slug);
  else state.selected.add(slug);
  saveSelected();
  const picked = state.selected.has(slug);
  const btn = document.querySelector(`.card-select[data-select="${CSS.escape(slug)}"]`);
  if (btn) {
    btn.setAttribute('aria-pressed', picked);
    btn.closest('.card-wrap').classList.toggle('is-selected', picked);
  }
  renderShopbar();
}

function renderShopbar() {
  const n = state.selected.size;
  $('#shopbar').hidden = n === 0;
  $('#shopbar-count').textContent = n;
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
        const flag = it.cat === 'pantry'
          ? ` <span class="pantry-flag" title="You likely have this — double-check your pantry">⚑</span>` : '';
        return `<label class="shop-item${it.cat !== 'buy' ? ' is-staple' : ''}">
          <input type="checkbox" data-idx="${i}"${it.cat === 'buy' ? ' checked' : ''} />
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
  const text = aggregateShoppingLines(entries).join('\n');
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
