/* ===========================================================================
   Tonight's Menu — client app. Vanilla JS, no build step.
   Loads recipes.json, renders the filterable menu, and drives the flipbook.
   =========================================================================== */

const state = {
  all: [],
  data: null,
  filtered: [],
  q: '',
  filters: { protein: new Set(), course: new Set(), methods: new Set(), heat: new Set(), cuisine: new Set(), time: new Set() },
  reader: { list: [], index: -1 },
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Minimal inline markdown: *italic* / _italic_  ->  <em>. Everything else escaped.
const inlineMd = (s) =>
  esc(s).replace(/(\*|_)(?=\S)([^*_]+?)\1/g, '<em>$2</em>');

const VEG = new Set(['vegetarian', 'vegan']);
const fmtMin = (m) => (m == null ? '—' : `${m} min`);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ── boot ──────────────────────────────────────────────────────────────────
init();

async function init() {
  setDate();
  try {
    const res = await fetch('recipes.json', { cache: 'no-cache' });
    state.data = await res.json();
  } catch (e) {
    $('#menu').innerHTML = `<p style="color:var(--stone)">Couldn't load recipes. Run <code>npm run build</code> first.</p>`;
    return;
  }
  state.all = state.data.recipes;
  buildFilters();
  bindEvents();
  apply();
  $('#colophon-meta').textContent =
    `${state.all.length} recipes · built ${new Date(state.data.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
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
    { key: 'protein', label: 'Protein', values: present(data.vocab.protein, (r) => r.protein), labelFor: (v) => data.meta.protein[v]?.label || cap(v) },
    { key: 'course', label: 'Course', values: present(data.vocab.course, (r) => r.course), labelFor: cap },
    { key: 'methods', label: 'Method', values: present(data.vocab.methods, (r) => r.methods), labelFor: (v) => data.meta.method[v]?.label || cap(v) },
    { key: 'time', label: 'Time', values: data.timeBuckets.map((b) => b.key), labelFor: (k) => data.timeBuckets.find((b) => b.key === k).label },
    { key: 'heat', label: 'Heat', values: present(data.vocab.heat, (r) => r.heat).filter((h) => h !== 'none'), labelFor: cap },
    { key: 'cuisine', label: 'Cuisine', values: data.facets.cuisines, labelFor: (v) => v },
  ];
  const html = groups
    .filter((g) => g.values.length > 1 || g.key === 'time')
    .map(
      (g) => `
    <div class="filter-group" data-group="${g.key}">
      <span class="filter-group-label">${g.label}</span>
      <div class="chips">
        ${g.values
          .map((v) => {
            const cls = g.key === 'protein' && VEG.has(v) ? 'chip chip-veg' : g.key === 'heat' ? 'chip chip-hot' : 'chip';
            return `<button class="${cls}" type="button" role="button" aria-pressed="false" data-key="${g.key}" data-val="${esc(v)}">${esc(g.labelFor(v))}</button>`;
          })
          .join('')}
      </div>
    </div>`
    )
    .join('');
  $('#filter-groups').innerHTML = html;
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
    const card = e.target.closest('.card');
    if (card) openReader(card.dataset.slug);
  });
  $('#reader-close').addEventListener('click', closeReader);
  $('#reader-prev').addEventListener('click', () => flip(-1));
  $('#reader-next').addEventListener('click', () => flip(1));
  $('#reader').addEventListener('click', (e) => { if (e.target === $('#reader')) closeReader(); });
  document.addEventListener('keydown', (e) => {
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

function matchesTime(total, bucketKey) {
  const b = state.data.timeBuckets.find((x) => x.key === bucketKey);
  const lo = b.min ?? -Infinity, hi = b.max ?? Infinity;
  return total > lo && total <= hi;
}

function apply() {
  const { q, filters } = state;
  state.filtered = state.all.filter((r) => {
    if (filters.protein.size && !filters.protein.has(r.protein)) return false;
    if (filters.course.size && !filters.course.has(r.course)) return false;
    if (filters.heat.size && !filters.heat.has(r.heat)) return false;
    if (filters.cuisine.size && !filters.cuisine.has(r.cuisine)) return false;
    if (filters.methods.size && !r.methods.some((m) => filters.methods.has(m))) return false;
    if (filters.time.size && ![...filters.time].some((k) => matchesTime(r.times.total, k))) return false;
    if (q) {
      const hay = [r.title, r.tagline, r.pitch, r.cuisine, r.tags.join(' '),
        r.ingredients.flatMap((s) => s.items).join(' ')].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  renderMenu();
}

// ── menu (cards) ─────────────────────────────────────────────────────────────
function renderMenu() {
  const list = state.filtered;
  const menu = $('#menu');
  const active = state.q || Object.values(state.filters).some((s) => s.size);
  $('#clear-filters').hidden = !active;
  $('#result-count').textContent = active
    ? `${list.length} of ${state.all.length} recipes`
    : `${state.all.length} recipes`;
  $('#empty-state').hidden = list.length > 0;
  menu.innerHTML = list.map((r, i) => cardHtml(r, i)).join('');
}

function cardHtml(r, i) {
  const tags = [
    `<span class="tag tag-protein">${esc(state.data.meta.protein[r.protein]?.label || r.protein)}</span>`,
    ...r.methods.slice(0, 2).map((m) => `<span class="tag">${esc(state.data.meta.method[m]?.label || m)}</span>`),
    r.heat !== 'none' ? `<span class="tag tag-hot">${esc(cap(r.heat))} heat</span>` : '',
  ].filter(Boolean).join('');
  const num = String(i + 1).padStart(2, '0');
  return `
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
  </button>`;
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
  $('#spread').innerHTML = spreadHtml(r);
  $('#reader-prev').disabled = index <= 0;
  $('#reader-next').disabled = index >= list.length - 1;
  const stage = $('#spread');
  stage.scrollTop = 0;
  if (dir !== 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const cls = dir > 0 ? 'flip-next' : 'flip-prev';
    stage.classList.remove('flip-next', 'flip-prev');
    void stage.offsetWidth; // reflow to restart animation
    stage.classList.add(cls);
  }
}

function sectionsHtml(sections, kind) {
  return sections
    .map((s) => {
      const head = s.section ? `<h4 class="subsection-h">${esc(s.section)}</h4>` : '';
      if (kind === 'ing') {
        return head + `<ul class="ing-list">${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
      }
      return head + `<ol class="step-list">${s.items.map((i) => `<li>${inlineMd(i)}</li>`).join('')}</ol>`;
    })
    .join('');
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
    ['Serves', r.serves],
    ['Prep', fmtMin(r.times.prep)],
    ['Cook', fmtMin(r.times.cook)],
    ['Total', fmtMin(r.times.total)],
    ['Level', cap(r.difficulty)],
  ].map(([l, v]) => `<div><div class="m-label">${l}</div><div class="m-value">${esc(v)}</div></div>`).join('');

  const tips = r.tips?.length
    ? `<div class="tips-box"><div class="section-h">Chef's Tips</div>
        <ul class="tips-list">${r.tips.map((t) => `<li>${inlineMd(t)}</li>`).join('')}</ul></div>`
    : '';

  const extras = r.extras?.length
    ? `<div class="extras"><div class="section-h">Make It Yours</div><dl>${r.extras
        .map((x) => `<dt>${esc(x.label)}</dt><dd>${inlineMd(x.note)}</dd>`).join('')}</dl></div>`
    : '';

  const source = r.source?.name
    ? `<p class="spread-source">${r.source.url
        ? `Source: <a href="${esc(r.source.url)}" target="_blank" rel="noopener">${esc(r.source.name)}</a>`
        : esc(r.source.name)}</p>`
    : '';

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
        <div class="col-ingredients">
          <div class="section-h">Ingredients</div>
          ${sectionsHtml(r.ingredients, 'ing')}
        </div>
        <div class="col-steps">
          <div class="section-h">Method</div>
          ${sectionsHtml(r.steps, 'step')}
          ${tips}
          ${extras}
        </div>
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
