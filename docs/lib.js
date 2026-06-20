/* ===========================================================================
   Tonight's Menu — pure logic (no DOM). Imported by app.js and by the test suite.
   Everything here is a pure function so it can be unit-tested in Node.
   =========================================================================== */

// ── text helpers ─────────────────────────────────────────────────────────────
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Minimal inline markdown: *italic* / _italic_ -> <em>. Everything else escaped.
export const inlineMd = (s) => esc(s).replace(/(\*|_)(?=\S)([^*_]+?)\1/g, '<em>$2</em>');
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const fmtMin = (m) => (m == null ? '—' : `${m} min`);
export const VEG = new Set(['vegetarian', 'vegan']);

// ── quantity parsing & scaling ───────────────────────────────────────────────
const UNI_FRAC = { '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4, '⅕': 1 / 5, '⅖': 2 / 5, '⅗': 3 / 5, '⅘': 4 / 5, '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8 };
const FRAC_CLASS = '½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞';
const QTY = `(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?[${FRAC_CLASS}]?|[${FRAC_CLASS}])`;
const QTY_RE = new RegExp(`^\\s*(${QTY})(?:\\s*[-–—]\\s*(${QTY}))?\\s+(.*)$`);
const FRAC_OUT = [[0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'], [1, '']];

export function parseNum(tok) {
  tok = String(tok).trim();
  let m;
  if ((m = tok.match(new RegExp(`^(\\d+)\\s*([${FRAC_CLASS}])$`)))) return +m[1] + UNI_FRAC[m[2]];
  if (UNI_FRAC[tok] != null) return UNI_FRAC[tok];
  if ((m = tok.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + +m[2] / +m[3];
  if ((m = tok.match(/^(\d+)\/(\d+)$/))) return +m[1] / +m[2];
  if (/^\d*\.?\d+$/.test(tok)) return +tok;
  return null;
}

export function parseQty(text) {
  if (typeof text !== 'string') return { qty: null, hi: null, rest: String(text ?? '') };
  const m = text.match(QTY_RE);
  if (!m) return { qty: null, hi: null, rest: text };
  return { qty: parseNum(m[1]), hi: m[2] ? parseNum(m[2]) : null, rest: m[3] };
}

export function fmtQty(n) {
  if (n == null || n < 0) return '';
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  let best = FRAC_OUT[0], bd = Infinity;
  for (const f of FRAC_OUT) { const d = Math.abs(frac - f[0]); if (d < bd) { bd = d; best = f; } }
  let w = whole, fc = best[1];
  if (best[0] === 1) { w += 1; fc = ''; }
  if (w === 0 && fc === '') return n > 0 ? String(Math.round(n * 100) / 100) : '0';
  return (w > 0 ? String(w) : '') + fc;
}

export function scaleDisplay(item, factor) {
  if (item.qty == null) return item.rest; // unscalable (e.g. "Salt and pepper to taste")
  const lo = fmtQty(item.qty * factor);
  const hi = item.hi != null ? '–' + fmtQty(item.hi * factor) : '';
  return (lo + hi + ' ' + item.rest).trim();
}

export function clampServes(v) {
  const n = parseInt(v, 10);
  return isNaN(n) ? null : Math.max(1, Math.min(50, n));
}

// ── shopping-list classification (default checkbox state) ────────────────────
// Genuinely specialty items — kept CHECKED (you probably need to buy these).
const EXOTIC = /saffron|sumac|za'?atar|gochujang|gochugaru|harissa|ras el hanout|garam masala|dukkah|\bmiso\b|tahini|fish sauce|hoisin|oyster sauce|pomegranate molasses|tamarind|black garlic|truffle|furikake|togarashi|\bdashi\b|preserved lemon/;

// 'core'   basics everyone has (salt, oil, sugar, flour, water, butter) — unchecked, no flag
// 'pantry' common spices + standard condiments — unchecked, ⚑ flag (probably have, double-check)
// 'buy'    fresh produce, proteins, specialty items — checked
export function classify(text) {
  const t = String(text).toLowerCase();
  const fresh = /\bfresh\b/.test(t);
  if (
    /\bsalt\b/.test(t) ||
    /(black|white|ground|cracked|table)\s+pepper|peppercorns?|salt and pepper|freshly ground pepper/.test(t) ||
    (/\boil\b/.test(t) && !/oil-cured|oil-packed/.test(t)) ||
    (/\bsugar\b/.test(t) && !/sugar snap/.test(t)) ||
    (/\bbutter\b/.test(t) && !/butter lettuce|nut butter|peanut butter|almond butter/.test(t)) ||
    /\bwater\b/.test(t) ||
    /\bflour\b/.test(t) ||
    (/\bice\b/.test(t) && !/ice cream/.test(t)) ||      // ice is a given; ice cream you buy
    /cooking spray|non-?stick spray/.test(t)
  ) return 'core';
  if (EXOTIC.test(t)) return 'buy';
  if (!fresh && /paprika|\bcumin\b|cayenne|chil[ie] (powder|flakes?)|chili flakes?|crushed red pepper|red pepper flakes?|cinnamon|nutmeg|allspice|cardamom|ground clove|\bcoriander\b|turmeric|garlic powder|onion powder|ground ginger|italian seasoning|old bay|curry powder|chili powder|chipotle|ancho|bay (leaf|leaves)|ground mustard|mustard powder|five spice|herbes de provence|dried (oregano|thyme|basil|rosemary|dill|parsley|sage|mint|tarragon|chives)/.test(t)) return 'pantry';
  if (/soy sauce|tamari|balsamic|red wine vinegar|white wine vinegar|rice (wine )?vinegar|apple cider vinegar|sherry vinegar|white vinegar|\bvinegar\b|\bhoney\b|maple syrup|dijon|whole-?grain mustard|yellow mustard|\bmustard\b|ketchup|mayonnaise|\bmayo\b|worcestershire|sriracha|hot sauce|sesame oil|vanilla extract|almond extract|baking soda|baking powder|cornstarch|corn ?starch|\bpanko\b|bread ?crumbs|tomato paste|\bbroth\b|\bstock\b|brown sugar|powdered sugar/.test(t)) return 'pantry';
  // Drink staples you almost certainly already have a bottle/jar of.
  if (/\bbitters\b|simple syrup|\bagave\b|grenadine|orgeat|\bsyrup\b/.test(t)) return 'pantry';
  return 'buy';
}

// ── ingredient normalization + smart merging (for the copied shopping list) ──
// Measure/portion words: the first one found becomes the line's unit; the rest drop.
// NB: slice/wedge/round/fillet are NOT here — they're preparations, handled below.
const MEASURE = new Set(['cup', 'cups', 'tbsp', 'tablespoon', 'tablespoons', 'tsp', 'teaspoon', 'teaspoons', 'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds', 'g', 'gram', 'grams', 'kg', 'ml', 'l', 'liter', 'liters', 'clove', 'cloves', 'can', 'cans', 'jar', 'jars', 'bottle', 'bottles', 'pinch', 'pinches', 'dash', 'dashes', 'handful', 'handfuls', 'sprig', 'sprigs', 'stalk', 'stalks', 'bunch', 'bunches', 'head', 'heads', 'ear', 'ears', 'bulb', 'bulbs', 'piece', 'pieces', 'strip', 'strips', 'stick', 'sticks', 'leaf', 'leaves', 'package', 'packages', 'pkg', 'quart', 'quarts', 'pint', 'pints', 'splash', 'splashes', 'barspoon', 'barspoons', 'part', 'parts']);
// Descriptors + preparations removed anywhere. "baby" is intentionally NOT here (kept distinct).
const DESC = new Set(['small', 'medium', 'large', 'jumbo', 'mini', 'extra', 'fresh', 'dried', 'ground', 'whole', 'ripe', 'raw', 'cooked', 'skinless', 'boneless', 'skin-on', 'skin', 'peeled', 'seeded', 'deseeded', 'deveined', 'drained', 'rinsed', 'packed', 'toasted', 'softened', 'melted', 'divided', 'plus', 'minced', 'chopped', 'finely', 'coarsely', 'roughly', 'diced', 'sliced', 'thinly', 'thickly', 'halved', 'quartered', 'crumbled', 'grated', 'shredded', 'julienned', 'cubed', 'freshly', 'trimmed', 'torn', 'smashed', 'pitted', 'husked', 'shucked', 'cut', 'into', 'bite', 'size', 'bite-size', 'florets', 'floret', 'fillet', 'fillets', 'filet', 'filets', 'very', 'to', 'taste', 'for', 'garnish', 'serving', 'of', 'a', 'an', 'the', 'and', 'about', 'approximately', 'each', 'more', 'as', 'needed']);
// Preparations that imply a derived form: removed from the name; recorded as `prep`.
const DERIVED = new Set(['juice', 'zest', 'peel', 'rind', 'slice', 'slices', 'wedge', 'wedges', 'round', 'rounds']);
const GENERIC_TAIL = new Set(['cheese']);                  // "feta cheese" -> feta
const KEEP_PLURAL = new Set(['greens', 'beans', 'peas', 'oats', 'grits', 'sprouts', 'noodles', 'asparagus', 'couscous', 'hummus', 'molasses', 'chives']);
const HERBS = new Set(['thyme', 'rosemary', 'sage', 'dill', 'parsley', 'cilantro', 'mint', 'basil', 'tarragon', 'chive', 'oregano', 'marjoram']);
const SPELL = { filet: 'fillet', filets: 'fillet', fillets: 'fillet', yoghurt: 'yogurt' };

function singular(w) {
  if (KEEP_PLURAL.has(w) || w.length <= 3) return w;
  if (w.endsWith('oes')) return w.slice(0, -2);     // tomatoes -> tomato
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y'; // berries -> berry
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}
function detectPrep(t) {
  if (/\bjuiced?\b/.test(t)) return 'juice';
  if (/\bzest(ed)?\b/.test(t)) return 'zest';
  if (/\b(slice|sliced|slices|wedge|wedges|round|rounds)\b/.test(t)) return 'slice';
  return 'whole';
}
function nameTokens(seg) {
  let unit = '';
  const name = [];
  for (let w of seg.replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean)) {
    if (/^[\d/.-]+$/.test(w)) continue;            // stray numbers
    w = SPELL[w] || w;
    if (MEASURE.has(w)) { if (!unit) unit = w; continue; }
    if (DESC.has(w) || DERIVED.has(w)) continue;
    name.push(singular(w));
  }
  return { unit, name };
}

// Reduce an ingredient (text after its quantity) to { key, display, unit, prep, count }.
// Two ingredients merge iff their `key` matches. `prep`/`count` feed the yield rules.
export function normalizeIngredient(rest) {
  const raw = String(rest);
  let t = raw.toLowerCase().replace(/\([^)]*\)/g, ' ');
  const prep = detectPrep(t);
  t = t.replace(/\b(zest|juice|peel|rind)\s+of\s+/g, ' ').split(',')[0]; // drop the prep clause
  const numTok = t.match(new RegExp(`(\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d+(?:\\.\\d+)?|[${FRAC_CLASS}])`));
  const count = numTok ? parseNum(numTok[0]) : null;
  const alts = t.split(/\s+or\s+|\s*\/\s*/);          // "A or B" -> first option (+ borrow noun)
  let { unit, name } = nameTokens(alts[0]);
  if (alts.length > 1) {
    const last = nameTokens(alts[alts.length - 1]);
    if (name.length && last.name.length > name.length) {
      const head = last.name[last.name.length - 1];
      if (!name.includes(head)) name = name.concat(head);
    }
  }
  // Bitters: every variant (Angostura, aromatic, orange, "a dash of bitters") is just one
  // bottle to buy — collapse them all to a single "bitters" line. (Match the raw text:
  // singular() would have already turned "bitters" into "bitter" in `name`.)
  if (/\bbitters\b/.test(t)) return { key: 'bitters', display: 'bitters', unit: '', prep: 'whole', count };
  // "feta cheese" and "feta" should MERGE, but "blue cheese" must not display as "blue".
  // So drop a generic trailing noun (cheese) from the KEY only, keeping it in the display.
  const display = name.join(' ') || raw.trim();
  const keyWords = name.length > 1 && GENERIC_TAIL.has(name[name.length - 1]) ? name.slice(0, -1) : name;
  return { key: [...new Set(keyWords)].sort().join(' '), display, unit, prep, count };
}

// Optional ingredients ("Optional: …" / "… (optional)") get their own copy section.
export function isOptional(line) {
  return /^\s*optional\b/i.test(String(line)) || /\(optional\)/i.test(String(line));
}
function cleanOptional(line) {
  return String(line).replace(/^\s*optional\s*:?\s*/i, '').replace(/\s*\(optional\)/i, '').trim();
}

const fmtUnit = (q, unit) => (fmtQty(q) + (unit ? ' ' + unit : '')).trim();

function genericLine(g) {
  const byUnit = new Map();
  for (const e of g.entries) {
    const uk = (e.unit || '').replace(/s$/, '');
    if (!byUnit.has(uk)) byUnit.set(uk, { qty: 0, unit: e.unit, hasQty: false });
    const u = byUnit.get(uk);
    if (e.qty != null) { u.qty += e.qty; u.hasQty = true; }
  }
  const parts = [...byUnit.values()].filter((u) => u.hasQty).map((u) => fmtUnit(u.qty, u.unit));
  return parts.length ? `${parts.join(' + ')} ${g.display}`.trim() : g.display;
}

// Garlic: collect cloves and express as bulbs (~10 cloves/bulb) — what you actually buy.
function garlicRule(g) {
  let cloves = 0;
  for (const e of g.entries) {
    const u = (e.unit || '').replace(/s$/, '');
    if (u === 'bulb' || u === 'head') cloves += (e.qty ?? 1) * 10;
    else cloves += e.qty ?? 1;                       // cloves, or a bare count
  }
  cloves = Math.round(cloves);
  const bulbs = Math.max(1, Math.ceil(cloves / 10));
  return `${bulbs} bulb${bulbs !== 1 ? 's' : ''} garlic (≈${cloves} clove${cloves !== 1 ? 's' : ''})`;
}

// Citrus: estimate whole fruit. Juiced fruit also yields zest; sliced/whole fruit can't be
// juiced. ~3 tbsp juice and ~1 tbsp zest per lemon/lime.
function citrusRule(g) {
  const fruit = g.display;
  let juice = 0, zest = 0, whole = 0;
  for (const e of g.entries) {
    const u = (e.unit || '').replace(/s$/, ''), q = e.qty;
    if (e.prep === 'juice') juice += u === 'tbsp' ? (q ?? 3) / 3 : u === 'tsp' ? (q ?? 9) / 9 : u === 'cup' ? (q ?? 0) * 16 / 3 : (q ?? 1);
    else if (e.prep === 'zest') zest += u === 'tsp' ? (q ?? 3) / 3 : (q ?? 1);
    else whole += q ?? 1;
  }
  const jl = Math.ceil(juice - 1e-9), wl = Math.ceil(whole - 1e-9), zl = Math.ceil(zest - 1e-9);
  const n = Math.max(1, jl + wl + Math.max(0, zl - (jl + wl)));
  return `${n} ${fruit}${n !== 1 ? 's' : ''}`;
}

// Fresh herbs are sold in bunches regardless of the small amount a recipe calls for.
function herbRule(g) {
  let cups = 0;
  for (const e of g.entries) if ((e.unit || '').replace(/s$/, '') === 'cup') cups += e.qty ?? 0;
  const b = Math.max(1, Math.ceil(cups));
  return `${b} bunch${b !== 1 ? 'es' : ''} ${g.display}`;
}

// Bitters are bought by the bottle and used by the dash — quantity is meaningless on a list.
function bittersRule() {
  return 'bitters';
}

function ruleFor(key, display) {
  if (key === 'garlic') return garlicRule;
  if (key === 'bitters') return bittersRule;
  if (display === 'lemon' || display === 'lime') return citrusRule;
  if (HERBS.has(key)) return herbRule;
  return null;
}

// Build the merged shopping list from checked entries ({ qty (scaled), rest }).
// Returns { lines, optional }. Identical ingredients merge; staple filtering is upstream.
export function buildShoppingList(entries) {
  const groups = new Map();
  const optional = [];
  for (const e of entries) {
    if (isOptional(e.rest)) { optional.push(cleanOptional(e.rest)); continue; }
    const n = normalizeIngredient(e.rest);
    const k = n.key || n.display;
    if (!groups.has(k)) groups.set(k, { display: n.display, entries: [] });
    const qty = e.qty != null ? e.qty : n.count;
    groups.get(k).entries.push({ qty, unit: n.unit, prep: n.prep });
  }
  const lines = [];
  for (const [k, g] of groups) {
    const rule = ruleFor(k, g.display);
    lines.push(rule ? rule(g) : genericLine(g));
  }
  return { lines, optional: [...new Set(optional)] };
}

// Format the shopping list for the clipboard.
//   'dash'     -> "- item"          (universal: plaintext / RTF / markdown)
//   'checkbox' -> "- [ ] item"      (markdown task list)
export function formatShoppingList({ lines, optional }, format = 'dash') {
  const bullet = format === 'checkbox' ? '- [ ] ' : '- ';
  const out = lines.map((l) => bullet + l);
  if (optional.length) out.push('', 'Optional:', ...optional.map((l) => bullet + l));
  return out.join('\n');
}

// Per-recipe scaled shopping rows (pure; used by the overlay and by tests).
export function shopSectionsForRecipe(recipe, target) {
  const factor = target / (recipe.serves || target);
  return (recipe.ingredients || []).map((sec) => ({
    section: sec.section || null,
    items: (sec.items || []).map((line) => {
      const p = parseQty(line);
      const cat = classify(line);
      const item = { qty: p.qty, hi: p.hi, rest: p.rest, serves: recipe.serves || target, cat, optional: isOptional(line) };
      return { ...item, display: scaleDisplay(item, factor) };
    }),
  }));
}

// ── filtering ────────────────────────────────────────────────────────────────
export function bucketMatch(total, bucket) {
  const lo = bucket.min ?? -Infinity, hi = bucket.max ?? Infinity;
  return total > lo && total <= hi;
}

// filters: { category, protein, course, methods, heat, cuisine, time } each a Set.
export function recipeMatches(r, { q, filters, cuisineGroups = {}, timeBuckets = [] }) {
  // Food facets
  if (filters.category?.size && !filters.category.has(r.category)) return false;
  if (filters.protein?.size && !filters.protein.has(r.protein)) return false;
  if (filters.course?.size && !filters.course.has(r.course)) return false;
  if (filters.cuisine?.size) {
    const ok = filters.cuisine.has(r.cuisine) || [...filters.cuisine].some((s) => cuisineGroups[s]?.includes(r.cuisine));
    if (!ok) return false;
  }
  // Drink facets
  if (filters.base?.size && !filters.base.has(r.base)) return false;
  if (filters.family?.size && !filters.family.has(r.family)) return false;
  if (filters.strength?.size && !filters.strength.has(r.strength)) return false;
  if (filters.tags?.size && !(r.tags || []).some((t) => filters.tags.has(t))) return false;
  // Shared facets
  if (filters.heat?.size && !filters.heat.has(r.heat)) return false;
  if (filters.methods?.size && !(r.methods || []).some((m) => filters.methods.has(m))) return false;
  if (filters.time?.size) {
    const ok = [...filters.time].some((k) => { const b = timeBuckets.find((x) => x.key === k); return b && bucketMatch(r.times.total, b); });
    if (!ok) return false;
  }
  if (q) {
    const hay = [r.title, r.tagline, r.pitch, r.cuisine, r.base, r.family, (r.tags || []).join(' '),
      (r.ingredients || []).flatMap((s) => s.items).join(' ')].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

// Cuisine chips: umbrella groups (e.g. "Asian") first, then the specific cuisines.
export function cuisineChipValues(recipes, cuisineGroups = {}) {
  const present = new Set(recipes.map((r) => r.cuisine));
  const groupKeys = Object.keys(cuisineGroups).filter((g) => cuisineGroups[g].some((c) => present.has(c)));
  return [...groupKeys, ...[...present].filter((c) => !groupKeys.includes(c)).sort()];
}
