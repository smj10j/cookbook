// ===========================================================================
// Nutrition engine — pure, build-time logic. Imported by build.mjs and tests.
//
// Reads the hand-maintained ingredient database (data/nutrition.json), where
// every ingredient's nutrition is stored PER its smallest divisible unit
// (a single cherry tomato, a teaspoon of sugar, a fluid ounce of rum…). Given a
// recipe, it parses each ingredient line, matches it to a database entry,
// converts the line's quantity into that entry's base units, sums the macros,
// and divides by the serving count to get per-serving nutrition.
//
// It is deliberately best-effort: a line it can't parse or match is skipped and
// reported, and the recipe's nutrition is flagged by how much it managed to
// cover. Garnishes and "to taste" lines contribute nothing and don't count
// against coverage. The numbers are estimates, by design.
// ===========================================================================
import { readFileSync } from 'node:fs';
import { parseNum } from '../../docs/lib.js';

// The eight nutrients we track. Keys match the database `n` objects and the
// per-serving output. (Grams except kcal=calories, sodium=milligrams.)
export const NUTRIENT_KEYS = ['kcal', 'protein', 'carb', 'fat', 'satfat', 'fiber', 'sugar', 'sodium'];

// ── unit conversion tables ───────────────────────────────────────────────────
// Mass units → grams.
const MASS_G = {
  g: 1, gram: 1, grams: 1, mg: 0.001, kg: 1000, kilogram: 1000,
  oz: 28.3495, ounce: 28.3495, lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592,
};
// Volume units → millilitres. (Cooking conventions; US measures.)
const VOL_ML = {
  tsp: 4.92892, teaspoon: 4.92892, tbsp: 14.7868, tablespoon: 14.7868,
  cup: 236.588, cups: 236.588, ml: 1, milliliter: 1, l: 1000, liter: 1000, litre: 1000,
  pint: 473.176, pt: 473.176, quart: 946.353, qt: 946.353, gallon: 3785.41,
  splash: 3.7, dash: 0.62, pinch: 0.31, drop: 0.05, barspoon: 5, part: 30, shot: 44.36,
};
// Generic grams for count/piece units, used only when a recipe references a piece
// word that doesn't match the entry's own base unit (a rough fallback).
const PIECE_G = {
  clove: 3, head: 300, bunch: 45, sprig: 2, stalk: 40, stick: 113, leaf: 1, leaves: 1,
  ear: 100, bulb: 60, can: 400, slice: 20, wheel: 8, wedge: 25, sprigs: 2, cloves: 3,
  thumb: 12, piece: 20, handful: 30, knob: 12, fillet: 170, filet: 170, breast: 170,
};
// A reasonable default density (g/ml) for produce/solids measured by volume.
const DEFAULT_DENSITY = 0.6;

// Lines that carry no meaningful nutrition — they don't count against coverage.
const NEGLIGIBLE_RE = /\b(for garnish|to garnish|for serving|to serve|for the (rim|glass|bag|pan|skin)|for brushing|for searing|for finishing|for the final sear|for drizzling|for rolling|table-?side|to finish|to taste|to season|as needed|optional twist)\b|, divided$|\bice$|^crushed ice$/i;

const singular = (w) => {
  if (!w) return w;
  if (w.length > 4 && /(shes|ches|xes|ses|zes)$/.test(w)) return w.slice(0, -2); // dashes→dash, pinches→pinch
  if (w.length > 3 && w.endsWith('oes')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
};
// Amount descriptors that sit between the quantity and the unit ("1 heaping tsp",
// "1 small pinch", "2 large cloves") — skipped so the real unit word is found.
const SIZE_DESC = new Set(['heaping', 'heaped', 'scant', 'rounded', 'level', 'generous', 'small', 'medium', 'large', 'big', 'thin', 'thick']);
const isMass = (u) => Object.prototype.hasOwnProperty.call(MASS_G, u);
const isVol = (u) => Object.prototype.hasOwnProperty.call(VOL_ML, u);
const isCountUnit = (u) => !isMass(u) && !isVol(u); // the entry's base is a discrete piece

// All measure words we recognise as a *unit token* at the head of a line.
const UNIT_WORDS = new Set([
  ...Object.keys(MASS_G), ...Object.keys(VOL_ML), ...Object.keys(PIECE_G),
  'cups', 'cloves', 'sprigs', 'leaves', 'slices', 'wedges', 'wheels', 'stalks', 'sticks',
  'heads', 'bulbs', 'ears', 'cans', 'bunches', 'pieces', 'pints', 'quarts',
]);

// ── line parsing ─────────────────────────────────────────────────────────────
// Strip a leading quantity (incl. ranges and unicode fractions) and capture the
// midpoint number, then the unit token (if any) and the remaining noun phrase.
const FRAC = '½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞';
const NUMTOK = `(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?[${FRAC}]?|[${FRAC}])`;
const LEAD_RE = new RegExp(`^\\s*(${NUMTOK})(?:\\s*[-–—]\\s*(${NUMTOK}))?\\s*(.*)$`);

export function parseLine(line, kind = 'food') {
  let text = String(line).trim();
  // Drop leading parenthetical sizes like "1 (14.5 oz) can …" → keep the count,
  // remove the size note so the unit token is the next real word.
  const lead = text.match(LEAD_RE);
  let qty = null;
  if (lead) {
    const lo = parseNum(lead[1]);
    const hi = lead[2] != null ? parseNum(lead[2]) : null;
    qty = hi != null && lo != null ? (lo + hi) / 2 : lo;
    text = lead[3];
  }
  // Remove any parenthetical aside so it doesn't pollute the unit / name.
  const rest = text.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  // The name is everything up to the first comma — the clause after it is a
  // preparation ("…, finely diced", "…, drained") that we don't want in the name.
  const main = rest.split(',')[0].trim();
  // The unit token is the first measure word, skipping any leading amount
  // descriptor ("heaping tsp", "small pinch", "large clove").
  const words = main.split(/\s+/).filter(Boolean);
  let unit = '';
  let nameStart = 0;
  let i = 0;
  while (i < words.length && SIZE_DESC.has(words[i].toLowerCase())) i++;
  if (i < words.length) {
    const w0 = singular(words[i].toLowerCase());
    if (UNIT_WORDS.has(w0) || UNIT_WORDS.has(words[i].toLowerCase())) {
      unit = w0;
      nameStart = i + 1;
    }
  }
  const name = words.slice(nameStart).join(' ');
  return { qty, unit, name, rest };
}

// ── matching a line to a database entry ──────────────────────────────────────
// Build a fast lookup index: every key and alias (normalised) → canonical key.
export function buildIndex(db) {
  const index = new Map();
  for (const key of Object.keys(db)) {
    index.set(normalizeName(key), key);
    for (const a of db[key].aliases || []) index.set(normalizeName(a), key);
  }
  return index;
}

// Normalise a name to a lookup token: lowercase, strip accents/punctuation,
// collapse spaces, singularise the trailing word.
export function normalizeName(s) {
  let t = String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Hyphens join descriptors to nouns ("extra-virgin", "best-quality", "skin-on");
  // split them so descriptor-peeling and noun matching can see the words.
  t = t.replace(/[^a-z0-9\s-]/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  const words = t.split(' ');
  if (words.length) words[words.length - 1] = singular(words[words.length - 1]);
  return words.join(' ');
}

// Descriptors/preparations to peel away when the full phrase doesn't match.
const STOP = new Set([
  'fresh', 'freshly', 'dried', 'ground', 'whole', 'large', 'small', 'medium', 'jumbo', 'mini',
  'ripe', 'raw', 'cooked', 'boneless', 'skinless', 'skin-on', 'skin', 'peeled', 'seeded',
  'deseeded', 'deveined', 'drained', 'rinsed', 'packed', 'toasted', 'softened', 'melted',
  'minced', 'chopped', 'finely', 'coarsely', 'roughly', 'diced', 'sliced', 'thinly', 'thickly',
  'halved', 'quartered', 'crumbled', 'grated', 'shredded', 'julienned', 'cubed', 'trimmed',
  'torn', 'smashed', 'pitted', 'husked', 'shucked', 'cut', 'into', 'bite', 'size', 'bite-size',
  'good', 'best', 'quality', 'high', 'low', 'extra', 'virgin', 'light', 'dark', 'hot', 'cold',
  'plus', 'more', 'for', 'the', 'a', 'an', 'of', 'and', 'or', 'about', 'each', 'thin', 'heaping',
  'pounded', 'stemmed', 'unpeeled', 'reserved', 'prepared', 'crushed', 'boil', 'mashed',
]);

// Cut/preparation nouns that describe a FORM of the ingredient, not the ingredient
// ("sea bass fillets" → sea bass, "fennel fronds" → fennel). Peeled when matching.
const CUT = new Set([
  'fillet', 'fillets', 'filet', 'filets', 'steak', 'steaks', 'frond', 'fronds', 'strip', 'strips',
  'piece', 'pieces', 'slice', 'slices', 'wedge', 'wedges', 'chunk', 'chunks', 'coin', 'coins',
  'floret', 'florets', 'half', 'halves', 'wheel', 'wheels',
]);

// Try to match a parsed name against the database, peeling descriptors and
// falling back to trailing noun phrases. Returns the canonical key or null.
export function matchName(name, db, index = buildIndex(db)) {
  const norm = normalizeName(name);
  if (!norm) return null;
  if (index.has(norm)) return index.get(norm);

  const words = norm.split(' ');
  // Content-word candidate: drop descriptors/cut-words from anywhere, then try the
  // whole remainder and its trailing noun phrases ("skin on sea bass fillets" → "sea bass").
  const content = words.filter((w) => !STOP.has(w) && !CUT.has(w));
  if (content.length) {
    const joined = content.join(' ');
    if (index.has(joined)) return index.get(joined);
    if (content.length >= 2 && index.has(content.slice(-2).join(' '))) return index.get(content.slice(-2).join(' '));
    if (index.has(content[content.length - 1])) return index.get(content[content.length - 1]);
  }
  // Try dropping leading descriptor words ("small red onion" → "red onion").
  for (let i = 0; i < words.length; i++) {
    if (i > 0 && !STOP.has(words[i - 1])) break; // only peel a run of leading descriptors
    const cand = words.slice(i).join(' ');
    if (cand && index.has(cand)) return index.get(cand);
  }
  // Try trailing noun phrases: last two words, then the last word.
  if (words.length >= 2) {
    const last2 = words.slice(-2).join(' ');
    if (index.has(last2)) return index.get(last2);
  }
  const last = words[words.length - 1];
  if (index.has(last)) return index.get(last);
  // Try each interior single word (longest-first) as a last resort.
  for (const w of [...words].sort((a, b) => b.length - a.length)) {
    if (w.length > 2 && !STOP.has(w) && index.has(w)) return index.get(w);
  }
  return null;
}

// ── unit conversion: how many base units does this line represent? ───────────
function lineToGrams(qty, unit, entry, kind) {
  if (!unit) return null;
  if (isMass(unit)) {
    if (unit === 'oz' && kind === 'drink') return null; // fluid, not weight
    return qty * MASS_G[unit];
  }
  if (Object.prototype.hasOwnProperty.call(PIECE_G, unit)) return qty * PIECE_G[unit];
  return null;
}
function lineToMl(qty, unit, kind) {
  if (!unit) return null;
  if (unit === 'oz') return kind === 'drink' ? qty * 29.5735 : null; // fluid oz in drinks
  if (isVol(unit)) return qty * VOL_ML[unit];
  return null;
}

// Returns the number of `entry.unit` units the line represents, or null if it
// genuinely can't be converted.
export function toBaseUnits({ qty, unit }, entry, kind = 'food') {
  if (qty == null) return null;
  const base = entry.unit;
  const g = entry.g;

  // 1. No unit token: a bare count ("6 olives", "2 fillets"). If the base unit is
  //    itself a piece, that's a direct count. Otherwise the item is stored by
  //    weight/volume, so we need its per-piece weight (`each`) to convert — without
  //    it we can't honestly resolve "6 <weight-based thing>", so report it unmatched.
  if (!unit) {
    if (isCountUnit(base)) return qty;
    if (entry.each) return (qty * entry.each) / g;
    return null;
  }
  // 2. Exact same unit as the base.
  if (unit === base || singular(unit) === singular(base)) return qty;

  // 3. Base unit is volumetric → convert the line to ml and divide.
  if (isVol(base)) {
    const ml = lineToMl(qty, unit, kind);
    if (ml != null) return ml / VOL_ML[base];
    const grams = lineToGrams(qty, unit, entry, kind);
    if (grams != null) return grams / (g || 1); // grams → base via the base's own gram weight
    return null;
  }

  // 4. Base unit is mass or a counted piece → convert the line to grams and divide by g.
  const grams = lineToGrams(qty, unit, entry, kind);
  if (grams != null && g) return grams / g;

  // 5. Line is a volume but the base is mass/piece → ml × density → grams ÷ g.
  const ml = lineToMl(qty, unit, kind);
  if (ml != null && g) return (ml * (entry.density ?? DEFAULT_DENSITY)) / g;

  return null;
}

// ── per-line and per-recipe nutrition ────────────────────────────────────────
const zero = () => Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0]));

// Nutrition contributed by ONE ingredient line. Returns
// { status: 'ok'|'skip'|'unmatched', nutrients?, key? }.
export function lineNutrition(line, db, index, kind = 'food') {
  const raw = String(line);
  const parsed = parseLine(raw, kind);
  if (!parsed.name) return { status: 'skip' };
  // Skip pure garnish/seasoning lines — but ONLY when there's no real quantity.
  // A quantified line ("1¼ cups sugar, plus more for rolling") still counts; the
  // "for rolling" aside was already trimmed from the name at the comma.
  if (parsed.qty == null && NEGLIGIBLE_RE.test(raw)) return { status: 'skip' };
  const key = matchName(parsed.name, db, index);
  if (!key) {
    // A line with no quantity and an unrecognised name is almost always a
    // garnish/aromatic ("Fresh basil sprigs") — skip rather than penalise.
    return parsed.qty == null ? { status: 'skip' } : { status: 'unmatched', name: parsed.name };
  }
  const entry = db[key];
  const units = toBaseUnits(parsed, entry, kind);
  if (units == null || !isFinite(units) || units < 0) {
    return parsed.qty == null ? { status: 'skip' } : { status: 'unmatched', name: parsed.name };
  }
  const nutrients = {};
  for (const k of NUTRIENT_KEYS) nutrients[k] = (entry.n[k] || 0) * units;
  return { status: 'ok', key, units, nutrients };
}

// Per-serving nutrition for a recipe. Returns the totals, the per-serving
// values, and coverage metadata (how confident the estimate is).
export function recipeNutrition(recipe, db, index = buildIndex(db)) {
  const kind = recipe.kind === 'drink' ? 'drink' : 'food';
  const totals = zero();
  const unmatched = [];
  let matched = 0;
  let considered = 0;
  for (const sec of recipe.ingredients || []) {
    for (const line of sec.items || []) {
      const res = lineNutrition(line, db, index, kind);
      if (res.status === 'skip') continue;
      considered++;
      if (res.status === 'unmatched') { unmatched.push(res.name); continue; }
      matched++;
      for (const k of NUTRIENT_KEYS) totals[k] += res.nutrients[k];
    }
  }
  const serves = recipe.serves && recipe.serves > 0 ? recipe.serves : 1;
  const perServing = {};
  for (const k of NUTRIENT_KEYS) perServing[k] = round(totals[k] / serves, k);
  const coverage = considered ? matched / considered : 0;
  const confidence = considered === 0 ? 'none' : coverage >= 0.85 ? 'high' : coverage >= 0.6 ? 'partial' : 'low';
  return {
    perServing,
    serves,
    matched,
    considered,
    coverage: Math.round(coverage * 100) / 100,
    confidence,
    unmatched: [...new Set(unmatched)],
  };
}

// Round each nutrient to a sensible precision for display/storage.
function round(v, key) {
  if (!isFinite(v)) return 0;
  if (key === 'kcal' || key === 'sodium') return Math.round(v);
  return Math.round(v * 10) / 10;
}

// Load + parse the database from disk (build/CLI helper).
export function loadDb(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
