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
// When a variant is active (the 1C toggle), the list shops for the variant's
// swapped lines, not the as-written ones.
export function shopSectionsForRecipe(recipe, target, variant = null) {
  const factor = target / (recipe.serves || target);
  const sections = variant ? applyVariantToSections(recipe.ingredients, variant) : null;
  return (recipe.ingredients || []).map((sec, si) => ({
    section: sec.section || null,
    items: (sec.items || []).map((line, ii) => {
      const text = sections ? sections[si].items[ii].text : line;
      const p = parseQty(text);
      const cat = classify(text);
      const item = { qty: p.qty, hi: p.hi, rest: p.rest, serves: recipe.serves || target, cat, optional: isOptional(text) };
      return { ...item, display: scaleDisplay(item, factor) };
    }),
  }));
}

// ── filtering ────────────────────────────────────────────────────────────────
export function bucketMatch(total, bucket) {
  const lo = bucket.min ?? -Infinity, hi = bucket.max ?? Infinity;
  return total > lo && total <= hi;
}

// filters: { category, protein, course, methods, heat, cuisine, time } each a Set,
// plus `plan` — a Map of plan id -> 'ok' (great + okay) | 'great' (great fits only).
// Plan selections AND together ("kidney AND heart friendly"), unlike the OR-within-
// group behavior of the other facets — that's the useful health question.
export function recipeMatches(r, { q, filters, cuisineGroups = {}, proteinGroups = {}, timeBuckets = [], planVerdicts = null }) {
  if (filters.plan?.size) {
    for (const [id, mode] of filters.plan) {
      const v = planVerdicts?.get(r.slug)?.[id];
      if (!v || v === 'avoid' || (mode === 'great' && v !== 'optimal')) return false;
    }
  }
  // Food facets
  if (filters.category?.size && !filters.category.has(r.category)) return false;
  if (filters.protein?.size) {
    const ok = filters.protein.has(r.protein) || [...filters.protein].some((s) => proteinGroups[s]?.includes(r.protein));
    if (!ok) return false;
  }
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

// ── nutrition (per-serving estimate + %DV) ───────────────────────────────────
// FDA Daily Values (2,000-calorie reference) used to express each nutrient as a
// percentage of recommended daily intake. `sugar` has no official total-sugars
// DV, so we reference the 50 g added-sugars value as a sensible yardstick.
export const DAILY_VALUES = {
  kcal: 2000, fat: 78, satfat: 20, sodium: 2300, carb: 275, fiber: 28, sugar: 50, protein: 50,
};

// Display order + formatting for the nutrition panel. `dv` keys into DAILY_VALUES;
// `indent` marks a nutrient nested under the row above it (Sat. Fat under Fat).
export const NUTRIENT_DISPLAY = [
  { key: 'kcal', label: 'Calories', unit: '', decimals: 0 },
  { key: 'fat', label: 'Total Fat', unit: 'g', decimals: 1 },
  { key: 'satfat', label: 'Saturated Fat', unit: 'g', decimals: 1, indent: true },
  { key: 'sodium', label: 'Sodium', unit: 'mg', decimals: 0 },
  { key: 'carb', label: 'Total Carbohydrate', unit: 'g', decimals: 1 },
  { key: 'fiber', label: 'Dietary Fiber', unit: 'g', decimals: 1, indent: true },
  { key: 'sugar', label: 'Sugars', unit: 'g', decimals: 1, indent: true },
  { key: 'protein', label: 'Protein', unit: 'g', decimals: 1 },
];

// Percent of the Daily Value for a nutrient amount (rounded integer, or null if
// there's no reference value to compare against).
export function pctOfDV(key, value) {
  const dv = DAILY_VALUES[key];
  if (!dv || value == null) return null;
  return Math.round((value / dv) * 100);
}

const fmtAmount = (v, decimals) => {
  if (v == null) return '0';
  const r = decimals ? Math.round(v * 10 ** decimals) / 10 ** decimals : Math.round(v);
  return String(r);
};

// Turn a recipe's stored nutrition into display rows:
//   { key, label, indent, amount: "12.3g", pct: 18 | null }
// Pass `per` to render a variant's numbers instead of the as-written estimate.
export function nutritionRows(r, per = r?.nutrition?.perServing) {
  if (!per) return [];
  return NUTRIENT_DISPLAY.map((d) => ({
    key: d.key,
    label: d.label,
    indent: !!d.indent,
    amount: fmtAmount(per[d.key], d.decimals) + d.unit,
    pct: pctOfDV(d.key, per[d.key]),
  }));
}

// True when a recipe has a usable nutrition estimate to show.
export function hasNutrition(r) {
  return !!(r?.nutrition?.perServing && r.nutrition.confidence !== 'none');
}

// ── eating-plan fit (research-backed dietary patterns, judged per serving) ──
// Ten doctor/nutritionist-backed eating plans, each compared against ONE
// SERVING of a recipe. Thresholds are per-meal shares of each plan's published
// targets: `optimal` ≈ 1/3 of the plan's strict daily target (or the plan's own
// per-serving standard where one exists — AHA Heart-Check, ADA carb bands);
// `ok` ≈ 40% of its lenient daily cap (dinner is usually the day's biggest
// meal). Past `ok`, the serving genuinely blows the plan's daily budget.
//   limits — ceilings, tiered optimal / ok / avoid.
//   goals  — encouragements (fiber, protein); missing one only downgrades a
//            verdict from optimal to ok, never to avoid.
// Extensible: add an entry here (id, name, icon, url, focus, limits/goals,
// caveat) and it appears in every plan-fit table + flag column automatically.
export const EATING_PLANS = [
  { // NHLBI DASH trials: sodium 2300 standard / 1500 strict, sat fat 6% kcal, sweets ≤5/wk, fiber 30 g/day
    id: 'dash', name: 'DASH', short: 'DASH', icon: '🩺',
    url: 'https://www.nhlbi.nih.gov/education/dash-eating-plan',
    focus: 'Blood pressure (hypertension)',
    caveat: 'NIH-trial pattern — sodium is the headline; the stricter 1,500 mg/day tier sets the ideal.',
    limits: [{ key: 'sodium', optimal: 500, ok: 920 }, { key: 'satfat', optimal: 4.5, ok: 9 }, { key: 'sugar', optimal: 8, ok: 20 }],
    goals: [{ key: 'fiber', min: 6 }],
  },
  { // Rush/NIA MIND score: butter/cheese/fried-food + sweets limits proxied via sat fat & sugars
    id: 'mind', name: 'MIND', short: 'MIND', icon: '🧠',
    url: 'https://www.nia.nih.gov/news/mind-and-mediterranean-diets-linked-fewer-signs-alzheimers-brain-pathology',
    focus: 'Brain health & memory',
    caveat: 'Food-pattern score (leafy greens, berries, olive oil) — sat fat & sweets limits are the computable proxy.',
    limits: [{ key: 'satfat', optimal: 4.5, ok: 9 }, { key: 'sugar', optimal: 8, ok: 20 }],
  },
  { // PREDIMED-style pattern: olive-oil-forward, so total fat is NOT restricted; sat fat ~7–10% kcal
    id: 'mediterranean', name: 'Mediterranean', short: 'Med', icon: '🫒',
    url: 'https://www.heart.org/en/healthy-living/healthy-eating/eat-smart/nutrition-basics/mediterranean-diet',
    focus: 'Heart health & longevity',
    caveat: 'Food-pattern diet — favors olive oil over butter; total fat is deliberately not restricted.',
    limits: [{ key: 'satfat', optimal: 5, ok: 9 }, { key: 'sugar', optimal: 10, ok: 20 }],
    goals: [{ key: 'fiber', min: 5 }],
  },
  { // NHLBI/ATP III TLC: sat fat <7% kcal (~15 g/day), sodium ≤2,300 mg/day
    id: 'tlc', name: 'TLC', short: 'TLC', icon: '📉',
    url: 'https://www.nhlbi.nih.gov/health/TLC-Therapeutic-Lifestyle-Changes-Lower-Cholesterol',
    focus: 'Lowering LDL cholesterol',
    caveat: 'Sat fat is the defining limit (<7% of calories); dietary cholesterol is not tracked here.',
    limits: [{ key: 'satfat', optimal: 5, ok: 9 }, { key: 'sodium', optimal: 767, ok: 920 }],
    goals: [{ key: 'fiber', min: 5 }],
  },
  { // AHA: optimal tier = published Heart-Check per-serving recipe limits for a main dish
    id: 'heart', name: 'AHA Heart-Healthy', short: 'Heart', icon: '❤️',
    url: 'https://www.heart.org/en/healthy-living/healthy-eating/eat-smart/nutrition-basics/aha-diet-and-lifestyle-recommendations',
    focus: 'Heart disease & stroke prevention',
    caveat: 'Ideal tier follows AHA Heart-Check per-serving recipe limits (≤600 mg sodium, ≤3.5 g sat fat).',
    limits: [{ key: 'sodium', optimal: 600, ok: 920 }, { key: 'satfat', optimal: 3.5, ok: 9 }, { key: 'sugar', optimal: 8, ok: 14 }],
  },
  { // ADA carb counting: 45–60 g carbs/meal typical, 30–45 g tighter; sodium <2,300 mg/day; fiber 14 g/1,000 kcal
    id: 'diabetes', name: 'Diabetes Plate', short: 'Diabetes', icon: '🩸',
    url: 'https://diabetes.org/food-nutrition/eating-healthy',
    focus: 'Blood sugar (diabetes & prediabetes)',
    caveat: 'Uses ADA carb-counting bands: 45–60 g carbs per meal, 30–45 g for tighter control.',
    limits: [{ key: 'carb', optimal: 45, ok: 60 }, { key: 'sodium', optimal: 500, ok: 920 }],
    goals: [{ key: 'fiber', min: 6 }],
  },
  { // NKF/KDOQI 2020, stages 3–4 non-dialysis: protein 0.55–0.8 g/kg/day (~75 kg adult), sodium <2,300 mg/day
    id: 'kidney', name: 'Kidney-Friendly', short: 'Kidney', icon: '🫘',
    url: 'https://www.kidney.org/kidney-topics/nutrition-and-kidney-disease-stages-1-5-not-dialysis',
    focus: 'Chronic kidney disease (stages 3–4)',
    caveat: 'Also watch potassium & phosphorus — not tracked here. Protein share assumes a ~75 kg adult; CKD diets are individualized.',
    limits: [{ key: 'protein', optimal: 15, ok: 24 }, { key: 'sodium', optimal: 500, ok: 920 }],
  },
  { // ADA consensus tiers: very-low-carb <26% kcal (~20–50 g/day net); low-carb ~130 g/day
    id: 'lowcarb', name: 'Low-Carb', short: 'Low-Carb', icon: '🥑',
    url: 'https://diabetesfoodhub.org/blog/all-about-low-carb-and-very-low-carb-eating-patterns',
    focus: 'Carb reduction (blood sugar & weight)',
    caveat: 'Ideal ≈ a very-low-carb (keto) meal share; okay ≈ a low-carb (130 g/day) share.',
    limits: [{ key: 'carb', optimal: 15, ok: 45 }],
  },
  { // AHA added-sugar budget: ≤25 g/day women, ≤36 g/day men — compared against TOTAL sugars
    id: 'lowsugar', name: 'Low Added Sugar', short: 'Low Sugar', icon: '🍬',
    url: 'https://www.heart.org/en/healthy-living/healthy-eating/eat-smart/sugar/how-much-sugar-is-too-much',
    focus: 'Metabolic health & weight',
    caveat: 'Compares total sugars against an added-sugar budget — fruit-forward dishes can over-flag.',
    limits: [{ key: 'sugar', optimal: 8, ok: 14 }],
  },
  { // CDC/NIH weight management on a 2,000-kcal reference day; protein goal = satiety
    id: 'balance', name: 'Calorie-Smart', short: 'Cal-Smart', icon: '⚖️',
    url: 'https://www.cdc.gov/healthy-weight-growth/about/tips-for-balancing-food-activity.html',
    focus: 'Weight management',
    caveat: 'Assumes a 2,000-calorie reference day with dinner as its biggest meal.',
    limits: [{ key: 'kcal', optimal: 600, ok: 800 }],
    goals: [{ key: 'protein', min: 20 }],
  },
];

// Tier a value against one limit rule: within `optimal` → 'optimal', within
// `ok` → 'ok', past it → 'avoid'. Missing values count as 0 (a plan can't
// object to a nutrient the dish doesn't have).
export function planTier(value, { optimal, ok }) {
  const v = value ?? 0;
  if (v <= optimal) return 'optimal';
  if (v <= ok) return 'ok';
  return 'avoid';
}

const TIER_RANK = { optimal: 0, ok: 1, avoid: 2 };

// Evaluate one plan against per-serving nutrition. The verdict is the worst
// limit tier; an unmet goal downgrades optimal → ok (never to avoid). Pass
// judgeGoals: false to skip goals for dishes that aren't a whole meal.
export function evaluatePlan(per, plan, { judgeGoals = true } = {}) {
  const limits = (plan.limits || []).map((l) => ({ ...l, value: per[l.key] ?? 0, tier: planTier(per[l.key], l) }));
  const goals = judgeGoals
    ? (plan.goals || []).map((g) => ({ ...g, value: per[g.key] ?? 0, met: (per[g.key] ?? 0) >= g.min }))
    : [];
  let verdict = 'optimal';
  for (const l of limits) if (TIER_RANK[l.tier] > TIER_RANK[verdict]) verdict = l.tier;
  if (verdict === 'optimal' && goals.some((g) => !g.met)) verdict = 'ok';
  return { plan, verdict, limits, goals };
}

// All plan verdicts for a recipe (empty when there's no usable estimate).
// Meal-building goals (fiber, protein) are only a fair demand of a MAIN — a
// salsa, a dessert or a cocktail isn't the meal's fiber source. And no plan
// considers alcohol optimal, so boozy drinks cap at "okay".
// Pass perOverride to judge every plan against a VARIANT's numbers (the 1C
// toggle) — the ⇄ hints are skipped there, since you're already in the variant.
export function evaluatePlans(r, plans = EATING_PLANS, perOverride = null) {
  if (!hasNutrition(r)) return [];
  const kind = r.kind || 'food';
  const judgeGoals = kind === 'food' && (r.category || 'main') === 'main';
  const alcoholic = kind === 'drink' && r.base !== 'non-alcoholic';
  return plans.map((p) => {
    const e = evaluatePlan(perOverride || r.nutrition.perServing, p, { judgeGoals });
    if (alcoholic) {
      e.alcohol = true;
      if (e.verdict === 'optimal') e.verdict = 'ok';
    }
    // A documented planSwaps variant (build-computed nutrition) may lift the
    // verdict — surface it only when it genuinely improves the tier.
    const swappedPer = perOverride ? null : r.nutrition.withSwaps?.[planSetKey(r.planSwaps, p.id)];
    if (swappedPer) {
      const s = evaluatePlan(swappedPer, p, { judgeGoals });
      if (alcoholic && s.verdict === 'optimal') s.verdict = 'ok';
      if (TIER_RANK[s.verdict] < TIER_RANK[e.verdict]) {
        e.swapped = s;
        e.swapText = (r.planSwaps || []).filter((x) => x.for.includes(p.id))
          .map((x) => x.note || `${x.with} (for ${x.replace})`).join('; ');
      }
    }
    return e;
  });
}

// ── recipe variants (the 1C toggle) ──────────────────────────────────────────
// withSwaps is keyed by ascending swap-entry-index sets ("0.2"); a plan's key
// is the set of entries that name it.
export function planSetKey(swaps, planId) {
  const idx = (swaps || []).map((s, i) => (s.for.includes(planId) ? i : -1)).filter((i) => i >= 0);
  return idx.length ? idx.join('.') : '';
}

// Group a recipe's planSwaps into toggleable variants: plans that share an
// identical swap set share one variant (their build-computed nutrition is
// identical). Returns [{ key, plans, swaps, perServing }] — empty when the
// recipe has no swaps or no usable variant nutrition.
export function recipeVariants(r, plans = EATING_PLANS) {
  const swaps = r?.planSwaps || [];
  if (!swaps.length || !r?.nutrition?.withSwaps) return [];
  const byKey = new Map();
  for (const p of plans) {
    const key = planSetKey(swaps, p.id);
    const per = key && r.nutrition.withSwaps[key];
    if (!per) continue;
    if (!byKey.has(key)) byKey.set(key, { key, plans: [], swaps: key.split('.').map((i) => swaps[+i]), perServing: per });
    byKey.get(key).plans.push(p);
  }
  return [...byKey.values()];
}

// ── combining swaps that touch the same ingredient line ──────────────────────
// Two swap entries can name the same `replace` line. There are two cases:
//   • a SUBSTITUTION to a different ingredient (piccata's "zoodles" vs "3 oz
//     spaghetti", kebabs' "chicken" vs "sirloin") — a real either/or, so the
//     chips stay mutually exclusive (a conflict);
//   • a REDUCTION of the SAME ingredient to different amounts (red beans "4 oz"
//     vs "6 oz") — those aren't a conflict at all: toggling both just lands on
//     the smaller portion. `resolveSwapCollisions` folds a colliding set to the
//     stricter (smallest) reduction per line; `ok:false` flags a real conflict.
//
// Comparison scales for ordering two reductions of the SAME line — enough to
// rank mass-vs-mass and volume-vs-volume (the full unit engine is in
// scripts/lib/nutrition.mjs). oz is treated as mass; both sides of a real
// collision share a unit, so relative order is what matters, not the dimension.
const SWAP_MASS_G = { g: 1, gram: 1, grams: 1, mg: 0.001, kg: 1000, kilogram: 1000, oz: 28.3495, ounce: 28.3495, ounces: 28.3495, lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592 };
const SWAP_VOL_ML = { tsp: 4.92892, teaspoon: 4.92892, teaspoons: 4.92892, tbsp: 14.7868, tablespoon: 14.7868, tablespoons: 14.7868, cup: 236.588, cups: 236.588, ml: 1, l: 1000, liter: 1000, litre: 1000, pint: 473.176, quart: 946.353 };
const SWAP_UNIT = new Set([...Object.keys(SWAP_MASS_G), ...Object.keys(SWAP_VOL_ML)]);
const SWAP_DESC = new Set(['fresh', 'dried', 'skin-on', 'skinless', 'boneless', 'thin', 'thick', 'small', 'medium', 'large', 'packed', 'whole', 'ground', 'ripe', 'raw', 'extra', 'virgin', 'lean', 'low-sodium', 'no-salt-added', 'reduced-sodium', 'light']);
const SWAP_EACH_RE = new RegExp(`(${QTY})(?:\\s*[-–—]\\s*(${QTY}))?\\s*([a-zA-Z]+)\\s+each\\b`, 'i');

// The comparable amount of a swap `with:` line, honoring a "(N unit each)" note
// exactly as the nutrition engine does. Returns { value, dim } (grams | ml |
// count) or null when there's no parseable quantity to order by.
export function swapMagnitude(line) {
  const t = String(line).trim();
  const lead = parseQty(t);
  const em = t.match(SWAP_EACH_RE);
  if (lead.qty != null && em) {
    const u = em[3].toLowerCase();
    const per = em[2] ? (parseNum(em[1]) + parseNum(em[2])) / 2 : parseNum(em[1]);
    const count = lead.hi != null ? (lead.qty + lead.hi) / 2 : lead.qty;
    if (per != null && SWAP_MASS_G[u]) return { value: count * per * SWAP_MASS_G[u], dim: 'mass' };
    if (per != null && SWAP_VOL_ML[u]) return { value: count * per * SWAP_VOL_ML[u], dim: 'vol' };
  }
  if (lead.qty == null) return null;
  const mid = lead.hi != null ? (lead.qty + lead.hi) / 2 : lead.qty;
  const first = (lead.rest.split(/\s+/)[0] || '').toLowerCase();
  if (SWAP_MASS_G[first]) return { value: mid * SWAP_MASS_G[first], dim: 'mass' };
  if (SWAP_VOL_ML[first]) return { value: mid * SWAP_VOL_ML[first], dim: 'vol' };
  return { value: mid, dim: 'count' };
}

// The bare ingredient name of a swap line — quantity, unit, "(… each)" note and
// prep clause stripped — so a reduction ("6 oz beans" → "4 oz beans", same name)
// is told apart from a substitution ("couscous" → "cauliflower rice").
export function swapIngredientName(line) {
  let t = String(line).toLowerCase().replace(/\([^)]*\)/g, ' ').split(',')[0];
  const q = parseQty(t.trim());
  const words = (q.qty != null ? q.rest : t).trim().split(/\s+/).filter(Boolean);
  if (words.length && SWAP_UNIT.has(words[0])) words.shift();
  const kept = words.filter((w) => !SWAP_DESC.has(w));
  if (kept.length) kept[kept.length - 1] = singular(kept[kept.length - 1]);
  return kept.join(' ').trim();
}

// Fold a set of swap entries to at most one per `replace` line. When several
// entries reduce the SAME ingredient by different amounts, keep the smallest
// portion. Returns { swaps, ok } — ok:false when two entries touch a line but
// aren't orderable reductions of one ingredient (a genuine either/or conflict).
export function resolveSwapCollisions(swaps) {
  const byLine = new Map();
  let ok = true;
  for (const s of swaps || []) {
    const line = s.replace.trim();
    const cur = byLine.get(line);
    if (!cur) { byLine.set(line, s); continue; }
    if (cur.with === s.with) continue;                       // identical swap — dedupe
    const a = swapMagnitude(cur.with), b = swapMagnitude(s.with);
    const sameFood = swapIngredientName(cur.with) === swapIngredientName(s.with);
    if (!sameFood || !a || !b || a.dim !== b.dim || a.value === b.value) { ok = false; continue; }
    if (b.value < a.value) byLine.set(line, s);               // smaller portion wins
  }
  return { swaps: [...byLine.values()], ok };
}

// Two variants conflict only when combining their swaps leaves an unorderable
// same-line collision — the UI grays the second chip out. Same-ingredient
// reductions (and identical entries) combine cleanly and are NOT conflicts.
export function variantsConflict(a, b) {
  return !resolveSwapCollisions([...(a.swaps || []), ...(b.swaps || [])]).ok;
}

// Combine selected toggle chips into one applied variant. Same-ingredient
// reductions of one line fold to the smallest portion, so selection ORDER can't
// change the result. Returns null when the combination's nutrition wasn't
// precomputed (i.e. the chips genuinely conflict).
export function combineVariants(r, chips) {
  if (!chips.length) return null;
  if (chips.length === 1) return chips[0];
  const idx = [...new Set(chips.flatMap((c) => c.swaps.map((s) => r.planSwaps.indexOf(s))))].sort((a, b) => a - b);
  const per = r.nutrition.withSwaps?.[idx.join('.')];
  if (!per) return null;
  const seen = new Set();
  const plans = chips.flatMap((c) => c.plans).filter((p) => !seen.has(p.id) && seen.add(p.id));
  return { key: idx.join('.'), plans, swaps: idx.map((i) => r.planSwaps[i]), perServing: per };
}

// Ingredient sections with a variant's swaps applied, each item marked so the
// UI can highlight what changed: { text, swapped, original? }. Same-line
// reductions are resolved to the smallest portion before applying.
export function applyVariantToSections(sections, variant) {
  const resolved = variant ? resolveSwapCollisions(variant.swaps).swaps : [];
  const map = new Map(resolved.map((s) => [s.replace.trim(), s.with]));
  return (sections || []).map((sec) => ({
    section: sec.section,
    items: (sec.items || []).map((t) => {
      const w = map.get(String(t).trim());
      return w ? { text: w, swapped: true, original: t } : { text: String(t), swapped: false };
    }),
  }));
}

// Short human label for a variant chip: its plans' icons (details go in title).
export function variantLabel(v) {
  return v.plans.map((p) => p.icon).join('');
}
export function variantTitle(v) {
  const who = v.plans.map((p) => p.short).join(' · ');
  const what = resolveSwapCollisions(v.swaps).swaps.map((s) => s.note || s.with).join('; ');
  return `${who}-friendly: ${what}`;
}

// slug -> { planId: verdict } for every recipe — precomputed once at boot so the
// "Good for" filter doesn't re-evaluate plans on every keystroke.
export function buildPlanVerdicts(recipes) {
  return new Map(recipes.map((r) => [r.slug,
    Object.fromEntries(evaluatePlans(r).map((e) => [e.plan.id, e.verdict]))]));
}

const nutrientUnit = (key) => NUTRIENT_DISPLAY.find((d) => d.key === key)?.unit || '';
const PLAN_NUTRIENT = { kcal: 'calories', fat: 'fat', satfat: 'sat fat', sodium: 'sodium', carb: 'carbs', fiber: 'fiber', sugar: 'sugars', protein: 'protein' };
const planAmt = (v, key) => `${Math.round(v * 10) / 10}${nutrientUnit(key)}`;

// Human reasons a plan isn't a great fit. One consistent vocabulary, matched
// to the verdict chips: every plan sets an IDEAL (within it → ✓ Great fit)
// and a per-meal MAX (within it → ~ Okay; over it → ✗ Poor fit). Goals are
// minimums that only cost the ✓.
//   avoid: "sodium: 2101mg is over this plan's 920mg-per-meal max"
//   ok:    "sodium: 683mg is over the 500mg ideal (but under the 920mg max)"
//   goal:  "fiber: 1.5g is short of the 6g goal"
export function planReasons({ limits, goals, alcohol }) {
  const out = [];
  for (const l of limits) {
    if (l.tier === 'ok') out.push(`${PLAN_NUTRIENT[l.key]}: ${planAmt(l.value, l.key)} is over the ${planAmt(l.optimal, l.key)} ideal (but under the ${planAmt(l.ok, l.key)} max)`);
    else if (l.tier === 'avoid') out.push(`${PLAN_NUTRIENT[l.key]}: ${planAmt(l.value, l.key)} is over this plan's ${planAmt(l.ok, l.key)}-per-meal max`);
  }
  for (const g of goals) if (!g.met) out.push(`${PLAN_NUTRIENT[g.key]}: ${planAmt(g.value, g.key)} is short of the ${planAmt(g.min, g.key)} goal`);
  if (!out.length && alcohol) out.push('contains alcohol — every plan advises moderation');
  return out;
}

// nutrient key -> plans whose LIMIT on that nutrient this serving breaches —
// feeds the flag column at the end of the nutrition table. tier 'ok' renders
// muted, 'avoid' gets the red ring.
export function nutrientFlags(evals) {
  const flags = {};
  for (const e of evals) {
    for (const l of e.limits) {
      if (l.tier === 'optimal') continue;
      const reason = l.tier === 'ok'
        ? `${PLAN_NUTRIENT[l.key]} ${planAmt(l.value, l.key)} is over its ${planAmt(l.optimal, l.key)} ideal (still under the ${planAmt(l.ok, l.key)} max)`
        : `${PLAN_NUTRIENT[l.key]} ${planAmt(l.value, l.key)} is over its ${planAmt(l.ok, l.key)}-per-meal max`;
      (flags[l.key] ||= []).push({ id: e.plan.id, icon: e.plan.icon, name: e.plan.name, tier: l.tier, reason });
    }
  }
  return flags;
}

const PLAN_FIT_LABEL = { optimal: '✓ Great fit', ok: '~ Okay', avoid: '✗ Poor fit' };

// One plan-fit table row: icon, linked name + focus (+ reasons when not
// optimal), and the verdict chip.
function planRowHtml(e) {
  const reasons = planReasons(e);
  const why = e.verdict !== 'optimal' && reasons.length
    ? `<span class="plan-why">${esc(reasons.join(' · '))}</span>` : '';
  const swap = e.swapped
    ? `<span class="plan-swap">⇄ ${PLAN_FIT_LABEL[e.swapped.verdict]} with ${esc(e.swapText)}</span>` : '';
  return `
        <div class="plan-row is-${e.verdict}">
          <span class="plan-icon" aria-hidden="true">${e.plan.icon}</span>
          <span class="plan-name"><a href="${esc(e.plan.url)}" target="_blank" rel="noopener" title="${esc(e.plan.caveat || e.plan.focus)}">${esc(e.plan.name)}</a>
            <span class="plan-focus">${esc(e.plan.focus)}</span>${why}${swap}</span>
          <span class="plan-fit is-${e.verdict}">${PLAN_FIT_LABEL[e.verdict]}</span>
        </div>`;
}

// The nutrition panel, rendered at the very bottom of a spread — always shown
// in full (no collapse). Built here (pure) so it can be unit-tested; app.js just
// drops the string in. Includes the eating-plan fit: a flag column on each
// nutrient row (plans that nutrient runs past) and a per-plan verdict table.
export function nutritionPanelHtml(r, { variant = null } = {}) {
  if (!hasNutrition(r)) return '';
  const rows = nutritionRows(r, variant ? variant.perServing : undefined);
  const n = r.nutrition;
  // Plan verdicts from a thin estimate would mislead (missing ingredients bias
  // every limit toward "fits") — only judge plans on high-confidence numbers.
  // With a variant active, every plan is judged against the variant's numbers.
  const evals = n.confidence === 'high' ? evaluatePlans(r, EATING_PLANS, variant?.perServing || null) : [];
  const flags = nutrientFlags(evals);
  const kcal = rows.find((x) => x.key === 'kcal');
  const body = rows.map((x) => {
    const fl = (flags[x.key] || []).map((f) =>
      `<span class="plan-flag is-${f.tier}" title="${esc(`${f.name} — ${f.reason}`)}" role="img" aria-label="${esc(`${f.name}: ${f.reason}`)}">${f.icon}</span>`).join('');
    return `
        <div class="nutri-row${x.indent ? ' is-sub' : ''}">
          <span class="nutri-name">${esc(x.label)}</span>
          <span class="nutri-amt">${esc(x.amount)}</span>
          <span class="nutri-dv">${x.pct == null ? '' : esc(x.pct + '%')}</span>
          <span class="nutri-flags">${fl}</span>
        </div>`;
  }).join('');
  // A short caveat when coverage is thin, so the estimate is never oversold.
  const note = n.confidence === 'high'
    ? 'Estimated from ingredients — per serving.'
    : `Rough estimate — ${n.matched} of ${n.considered} ingredients matched.`;
  const flagFoot = evals.length
    ? ' <span class="nutrition-foot">†Icons mark plans where this nutrient is over the ideal (faded icon) or over the per-meal max (red ring) — hover one for the numbers.</span>' : '';
  const plans = evals.length ? `
      <div class="plans">
        <div class="plans-head"><span>Eating-plan fit</span><span class="plans-sub">this serving vs. a per-meal share</span></div>
        ${evals.map(planRowHtml).join('')}
        <p class="plans-note">Each plan sets two bars per meal: an <em>ideal</em> (≈⅓ of its strict daily target) and a <em>max</em> (≈40% of its daily cap). <strong>✓ Great fit</strong> — everything is within the ideals. <strong>~ Okay</strong> — something is over an ideal but everything is under the maxes. <strong>✗ Poor fit</strong> — something is over a max, so one serving crowds the plan’s whole day. A screening aid, not medical advice; cocktails top out at <em>okay</em>.</p>
      </div>` : '';
  const variantBadge = variant
    ? ` <span class="nutrition-variant" title="${esc(variantTitle(variant))}">⇄ ${variantLabel(variant)} variant</span>` : '';
  return `
    <section class="nutrition">
      <div class="nutrition-summary">
        <span class="nutrition-label">Nutrition <span class="nutrition-est">(estimated, per serving)</span>${variantBadge}</span>
        <span class="nutrition-kcal">${kcal ? esc(kcal.amount) : ''} cal</span>
      </div>
      <div class="nutrition-panel">
        <div class="nutri-head"><span>Amount per serving · serves ${esc(r.serves)}</span><span class="nutri-dv-head">% DV*</span><span class="nutri-flag-head">${evals.length ? 'Plans†' : ''}</span></div>
        ${body}
        <p class="nutrition-note">${esc(note)} <span class="nutrition-foot">*Percent of a 2,000-calorie daily value.</span>${flagFoot}</p>
      </div>${plans}
    </section>`;
}

// ── routing (hash <-> app route) ─────────────────────────────────────────────
// Recipes are addressed as '#/<slug>'. The Food/Drinks tabs get their own hash
// ('#food' / '#drinks') so a tab choice survives a refresh and is shareable.
export function hashForKind(kind) {
  return kind === 'drink' ? '#drinks' : '#food';
}

// Parse a location.hash into a route:
//   { type: 'recipe', slug }          — '#/<slug>'
//   { type: 'tab',    kind }          — '#food' | '#drinks'
//   { type: 'home',   kind: 'food' }  — empty/unknown hash (the default section)
export function parseHash(hash) {
  const h = String(hash || '').replace(/^#/, '');
  if (h.startsWith('/')) {
    const slug = decodeURIComponent(h.slice(1));
    return slug ? { type: 'recipe', slug } : { type: 'home', kind: 'food' };
  }
  if (h === 'drinks') return { type: 'tab', kind: 'drink' };
  if (h === 'food') return { type: 'tab', kind: 'food' };
  return { type: 'home', kind: 'food' };
}

// Cuisine chips: umbrella groups (e.g. "Asian") first, then the specific cuisines.
export function cuisineChipValues(recipes, cuisineGroups = {}) {
  const present = new Set(recipes.map((r) => r.cuisine));
  const groupKeys = Object.keys(cuisineGroups).filter((g) => cuisineGroups[g].some((c) => present.has(c)));
  return [...groupKeys, ...[...present].filter((c) => !groupKeys.includes(c)).sort()];
}

// Protein chips: umbrella groups (e.g. "Seafood") first, then the specific proteins in
// their vocab order. An umbrella only appears when ≥1 member protein is actually present,
// and a member protein isn't dropped just because its umbrella shows — both are offered.
export function proteinChipValues(recipes, vocabOrder = [], proteinGroups = {}) {
  const present = new Set(recipes.map((r) => r.protein));
  const groupKeys = Object.keys(proteinGroups).filter((g) => proteinGroups[g].some((p) => present.has(p)));
  return [...groupKeys, ...vocabOrder.filter((p) => present.has(p) && !groupKeys.includes(p))];
}
