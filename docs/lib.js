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
    /cooking spray|non-?stick spray/.test(t)
  ) return 'core';
  if (EXOTIC.test(t)) return 'buy';
  if (!fresh && /paprika|\bcumin\b|cayenne|chil[ie] (powder|flakes?)|chili flakes?|crushed red pepper|red pepper flakes?|cinnamon|nutmeg|allspice|cardamom|ground clove|\bcoriander\b|turmeric|garlic powder|onion powder|ground ginger|italian seasoning|old bay|curry powder|chili powder|chipotle|ancho|bay (leaf|leaves)|ground mustard|mustard powder|five spice|herbes de provence|dried (oregano|thyme|basil|rosemary|dill|parsley|sage|mint|tarragon|chives)/.test(t)) return 'pantry';
  if (/soy sauce|tamari|balsamic|red wine vinegar|white wine vinegar|rice (wine )?vinegar|apple cider vinegar|sherry vinegar|white vinegar|\bvinegar\b|\bhoney\b|maple syrup|dijon|whole-?grain mustard|yellow mustard|\bmustard\b|ketchup|mayonnaise|\bmayo\b|worcestershire|sriracha|hot sauce|sesame oil|vanilla extract|almond extract|baking soda|baking powder|cornstarch|corn ?starch|\bpanko\b|bread ?crumbs|tomato paste|\bbroth\b|\bstock\b|brown sugar|powdered sugar/.test(t)) return 'pantry';
  return 'buy';
}

// ── ingredient normalization (for merging duplicates on copy) ────────────────
// Measure words (removed; the first one found becomes the line's unit).
const MEASURE = new Set(['cup', 'cups', 'tbsp', 'tablespoon', 'tablespoons', 'tsp', 'teaspoon', 'teaspoons', 'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds', 'g', 'gram', 'grams', 'kg', 'ml', 'l', 'liter', 'liters', 'clove', 'cloves', 'can', 'cans', 'jar', 'jars', 'bottle', 'bottles', 'pinch', 'pinches', 'dash', 'handful', 'handfuls', 'sprig', 'sprigs', 'stalk', 'stalks', 'bunch', 'bunches', 'head', 'heads', 'slice', 'slices', 'wedge', 'wedges', 'round', 'rounds', 'piece', 'pieces', 'fillet', 'fillets', 'filet', 'filets', 'strip', 'strips', 'stick', 'sticks', 'leaf', 'leaves', 'package', 'packages', 'pkg', 'quart', 'quarts', 'pint', 'pints']);
// Descriptors removed anywhere. NB: "baby" is intentionally NOT here (kept distinct).
const DESC = new Set(['small', 'medium', 'large', 'jumbo', 'mini', 'extra', 'fresh', 'dried', 'ground', 'whole', 'ripe', 'raw', 'cooked', 'skinless', 'boneless', 'skin-on', 'skin', 'peeled', 'seeded', 'deseeded', 'deveined', 'drained', 'rinsed', 'packed', 'toasted', 'softened', 'melted', 'divided', 'optional', 'plus', 'minced', 'chopped', 'finely', 'coarsely', 'roughly', 'diced', 'sliced', 'thinly', 'thickly', 'halved', 'quartered', 'crumbled', 'grated', 'shredded', 'julienned', 'cubed', 'freshly', 'trimmed', 'torn', 'to', 'taste', 'for', 'garnish', 'serving', 'of', 'a', 'the', 'about', 'approximately', 'each', 'more', 'as', 'needed']);
const DERIVED = new Set(['juice', 'zest', 'peel', 'rind']); // "lemon juice"/"zest of 1 lemon" -> lemon
const GENERIC_TAIL = new Set(['cheese']);                   // "feta cheese" -> feta
const KEEP_PLURAL = new Set(['greens', 'beans', 'peas', 'oats', 'grits', 'sprouts', 'noodles', 'asparagus', 'couscous', 'hummus', 'molasses']);
const SPELL = { filet: 'fillet', filets: 'fillet', fillets: 'fillet', yoghurt: 'yogurt' };

function singular(w) {
  if (KEEP_PLURAL.has(w) || w.length <= 3) return w;
  if (w.endsWith('oes')) return w.slice(0, -2);     // tomatoes -> tomato
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y'; // berries -> berry
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}
function tokenize(seg) {
  return seg
    .replace(/[^a-z\s-]/g, ' ')
    .split(/\s+/).filter(Boolean)
    .map((w) => SPELL[w] || w)
    .filter((w) => !DESC.has(w) && !DERIVED.has(w))
    .map((w) => (MEASURE.has(w) ? w : singular(w)))
    .filter(Boolean);
}

// Reduce an ingredient (the text after its quantity) to { unit, display, key }.
// Two ingredients merge iff their `key` matches.
export function analyze(rest) {
  let t = String(rest).toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(zest|juice|peel|rind)\s+of\s+/g, ' ');
  // "A or B" / "A/B": key on the first option, borrowing a trailing noun from the last.
  const alts = t.split(/\s+or\s+|\s*\/\s*/);
  let words = tokenize(alts[0]);
  if (alts.length > 1) {
    const last = tokenize(alts[alts.length - 1]);
    if (words.length && last.length > words.length) {
      const head = last[last.length - 1];
      if (!words.includes(head)) words.push(head);
    }
  }
  let unit = '';
  const nameWords = [];
  for (const w of words) {
    if (MEASURE.has(w)) { if (!unit) unit = w; continue; }
    nameWords.push(w);
  }
  if (nameWords.length > 1 && GENERIC_TAIL.has(nameWords[nameWords.length - 1])) nameWords.pop();
  const display = nameWords.join(' ') || String(rest).trim();
  const key = [...new Set(nameWords)].sort().join(' ');
  return { unit, display, key };
}

// Merge entries (already-scaled qty + rest) into deduped shopping lines.
export function aggregateShoppingLines(entries) {
  const groups = new Map();
  for (const e of entries) {
    const { unit, display, key } = analyze(e.rest);
    const k = key || display.toLowerCase();
    if (!groups.has(k)) groups.set(k, { display, units: new Map() });
    const uk = unit.toLowerCase().replace(/s$/, '');
    const units = groups.get(k).units;
    if (!units.has(uk)) units.set(uk, { qty: 0, unit, hasQty: false });
    const u = units.get(uk);
    if (e.qty != null) { u.qty += e.qty; u.hasQty = true; }
  }
  return [...groups.values()].map((g) => {
    const parts = [...g.units.values()].filter((u) => u.hasQty)
      .map((u) => (fmtQty(u.qty) + (u.unit ? ' ' + u.unit : '')).trim());
    return parts.length ? `${parts.join(' + ')} ${g.display}`.trim() : g.display;
  });
}

// Per-recipe scaled shopping rows (pure; used by the overlay and by tests).
export function shopSectionsForRecipe(recipe, target) {
  const factor = target / (recipe.serves || target);
  return (recipe.ingredients || []).map((sec) => ({
    section: sec.section || null,
    items: (sec.items || []).map((line) => {
      const p = parseQty(line);
      const cat = classify(line);
      const item = { qty: p.qty, hi: p.hi, rest: p.rest, serves: recipe.serves || target, cat };
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
  if (filters.category.size && !filters.category.has(r.category)) return false;
  if (filters.protein.size && !filters.protein.has(r.protein)) return false;
  if (filters.course.size && !filters.course.has(r.course)) return false;
  if (filters.heat.size && !filters.heat.has(r.heat)) return false;
  if (filters.cuisine.size) {
    const ok = filters.cuisine.has(r.cuisine) || [...filters.cuisine].some((s) => cuisineGroups[s]?.includes(r.cuisine));
    if (!ok) return false;
  }
  if (filters.methods.size && !r.methods.some((m) => filters.methods.has(m))) return false;
  if (filters.time.size) {
    const ok = [...filters.time].some((k) => { const b = timeBuckets.find((x) => x.key === k); return b && bucketMatch(r.times.total, b); });
    if (!ok) return false;
  }
  if (q) {
    const hay = [r.title, r.tagline, r.pitch, r.cuisine, (r.tags || []).join(' '),
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
