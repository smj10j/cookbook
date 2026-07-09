// The single source of truth for the recipe format.
// Both build.mjs and validate.mjs import this so the site and the linter never drift.

// Plan ids come from the site's eating-plan definitions so `planSwaps` can never
// name a plan that doesn't exist (docs/lib.js is pure ESM — safe to import here).
import { EATING_PLANS } from '../../docs/lib.js';
const PLAN_IDS = new Set(EATING_PLANS.map((p) => p.id));

// Controlled vocabularies — these drive the site's filter dropdowns.
// Keep them tight; add a value here (and document it in CLAUDE.md) before using it in a recipe.
export const VOCAB = {
  // Primary protein / dietary lane. One per recipe.
  protein: ['beef', 'chicken', 'fish', 'seafood', 'vegetarian', 'vegan', 'pork'],
  // How it's cooked. One or more.
  methods: [
    'grill',
    'stove',
    'oven',
    'broiler',
    'sous-vide',
    'instant-pot',
    'smoker',
    'dehydrator',
    'air-fryer',
    'no-cook',
  ],
  // High-level menu role: main dish, accompaniment, or dessert. Defaults to 'main'.
  category: ['main', 'side', 'dessert'],
  // What kind of dish (the granular descriptor). One per recipe.
  course: ['main', 'salad', 'soup', 'side', 'sauce', 'pasta', 'taco', 'snack', 'dessert'],
  // Spice level. One per recipe (shared by food + drinks — spicy margaritas exist).
  heat: ['none', 'mild', 'medium', 'hot'],
  // Effort. One per recipe (shared).
  difficulty: ['easy', 'medium', 'advanced'],

  // ── DRINKS (kind: drink) ──────────────────────────────────────────────────
  // Primary spirit / lane. One per drink (the drink analogue of `protein`).
  base: ['gin', 'vodka', 'whiskey', 'rum', 'tequila', 'mezcal', 'brandy', 'liqueur', 'non-alcoholic'],
  // Cocktail family / style — the granular dish type for drinks (analogue of `course`).
  family: [
    'daiquiri', 'sour', 'margarita', 'martini', 'gimlet', 'highball', 'tiki', 'swizzle',
    'smash', 'sling', 'old-fashioned', 'fizz', 'mule', 'spritz', 'punch', 'frozen', 'dessert', 'shot',
  ],
  // How a drink is built. One or more (analogue of `methods` for food).
  drinkMethods: ['shaken', 'stirred', 'built', 'blended', 'muddled', 'swizzled', 'dry-shake'],
  // How boozy it drinks — drives a filter and the spec block.
  strength: ['sessionable', 'medium', 'spirit-forward'],
};

// Human-friendly labels + display color hints for tags shown in the UI.
// `accent` = terracotta, `olive` = veg/green, `ink` = neutral, `stone` = muted.
export const PROTEIN_META = {
  beef: { label: 'Beef', color: 'accent' },
  chicken: { label: 'Chicken', color: 'accent' },
  fish: { label: 'Fish', color: 'ink' },
  seafood: { label: 'Shellfish', color: 'ink' },
  vegetarian: { label: 'Vegetarian', color: 'olive' },
  vegan: { label: 'Vegan', color: 'olive' },
  pork: { label: 'Pork', color: 'accent' },
};

// Method labels cover BOTH food and drink methods (it's just a label lookup; the filter
// chips themselves are built per-kind from VOCAB.methods / VOCAB.drinkMethods).
export const METHOD_META = {
  grill: { label: 'Grill' },
  stove: { label: 'Stove' },
  oven: { label: 'Oven' },
  broiler: { label: 'Broiler' },
  'sous-vide': { label: 'Sous Vide' },
  'instant-pot': { label: 'Instant Pot' },
  smoker: { label: 'Smoker' },
  dehydrator: { label: 'Dehydrator' },
  'air-fryer': { label: 'Air Fryer' },
  'no-cook': { label: 'No-Cook' },
  // drink methods
  shaken: { label: 'Shaken' },
  stirred: { label: 'Stirred' },
  built: { label: 'Built' },
  blended: { label: 'Blended' },
  muddled: { label: 'Muddled' },
  swizzled: { label: 'Swizzled' },
  'dry-shake': { label: 'Dry-Shake' },
};

// Drink label maps (analogues of PROTEIN_META).
export const BASE_META = {
  gin: { label: 'Gin', color: 'olive' },
  vodka: { label: 'Vodka', color: 'ink' },
  whiskey: { label: 'Whiskey', color: 'accent' },
  rum: { label: 'Rum', color: 'accent' },
  tequila: { label: 'Tequila', color: 'olive' },
  mezcal: { label: 'Mezcal', color: 'accent' },
  brandy: { label: 'Brandy', color: 'accent' },
  liqueur: { label: 'Liqueur', color: 'ink' },
  'non-alcoholic': { label: 'Non-Alcoholic', color: 'olive' },
};

export const FAMILY_META = {
  daiquiri: { label: 'Daiquiri' }, sour: { label: 'Sour' }, margarita: { label: 'Margarita' },
  martini: { label: 'Martini' }, gimlet: { label: 'Gimlet' }, highball: { label: 'Highball' },
  tiki: { label: 'Tiki' }, swizzle: { label: 'Swizzle' }, smash: { label: 'Smash' },
  sling: { label: 'Sling' }, 'old-fashioned': { label: 'Old Fashioned' }, fizz: { label: 'Fizz' },
  mule: { label: 'Mule' }, spritz: { label: 'Spritz' }, punch: { label: 'Punch' },
  frozen: { label: 'Frozen' }, dessert: { label: 'Dessert' }, shot: { label: 'Shot' },
};

export const STRENGTH_META = {
  sessionable: { label: 'Sessionable' },
  medium: { label: 'Balanced' },
  'spirit-forward': { label: 'Spirit-Forward' },
};

// Protein umbrella groups. Selecting the umbrella (e.g. "Seafood") matches any member
// protein, while each specific protein stays available as its own filter. Fish (finfish
// like salmon/cod) and shellfish/mixed (labeled "Shellfish") are distinct lanes, but a
// reader thinking "seafood" wants both — the umbrella gives them one chip that catches all.
export const PROTEIN_GROUPS = {
  Seafood: ['fish', 'seafood'],
};

// Cuisine umbrella groups. Selecting the umbrella (e.g. "Asian") matches any member
// cuisine, while each specific cuisine stays available as its own filter.
export const CUISINE_GROUPS = {
  Asian: [
    'Asian',
    'Asian-American',
    'Vietnamese',
    'Japanese',
    'Chinese',
    'Thai',
    'Sichuan',
    'Korean',
    'Indian',
    'Filipino',
    'Malaysian',
    'Indonesian',
    'Singaporean',
  ],
};

// Coarse time buckets the UI offers as quick filters (minutes, inclusive lower bound).
export const TIME_BUCKETS = [
  { key: 'under-30', label: 'Under 30 min', max: 30 },
  { key: '30-45', label: '30–45 min', min: 30, max: 45 },
  { key: '45-60', label: '45–60 min', min: 45, max: 60 },
  { key: 'over-60', label: 'Over 60 min', min: 60 },
];

// Required fields shared by both kinds, plus the kind-specific ones.
const SHARED_REQUIRED = ['title', 'slug', 'tagline', 'pitch', 'serves', 'times', 'difficulty', 'heat', 'ingredients', 'steps'];
const FOOD_REQUIRED = ['protein', 'methods', 'cuisine', 'course'];
const DRINK_REQUIRED = ['base', 'family', 'methods', 'glass'];

// Normalize ingredients/steps: each entry is either a plain string (ungrouped)
// or { section, items: [...] }. Returns a consistent [{ section, items }] shape.
export function normalizeSections(value) {
  if (!Array.isArray(value)) return [];
  // Flat list of strings -> single unnamed section.
  if (value.every((v) => typeof v === 'string')) {
    return [{ section: null, items: value }];
  }
  return value.map((entry) => {
    if (typeof entry === 'string') return { section: null, items: [entry] };
    return { section: entry.section ?? null, items: entry.items ?? [] };
  });
}

// Validate one parsed recipe object. Returns an array of error strings (empty = valid).
export function validateRecipe(r, filename = '?') {
  const errs = [];
  const fail = (m) => errs.push(`${filename}: ${m}`);
  const kind = r.kind || 'food';
  if (!['food', 'drink'].includes(kind)) fail(`kind "${r.kind}" must be "food" or "drink"`);

  const required = [...SHARED_REQUIRED, ...(kind === 'drink' ? DRINK_REQUIRED : FOOD_REQUIRED)];
  for (const key of required) {
    if (r[key] === undefined || r[key] === null || r[key] === '') {
      fail(`missing required field "${key}"`);
    }
  }
  if (errs.length) return errs; // don't cascade on a half-formed recipe

  if (typeof r.slug !== 'string' || !/^[a-z0-9-]+$/.test(r.slug)) {
    fail(`slug "${r.slug}" must be lowercase kebab-case`);
  }

  if (kind === 'drink') {
    if (!VOCAB.base.includes(r.base)) fail(`base "${r.base}" not in vocab (${VOCAB.base.join(', ')})`);
    if (!VOCAB.family.includes(r.family)) fail(`family "${r.family}" not in vocab (${VOCAB.family.join(', ')})`);
    if (typeof r.glass !== 'string' || !r.glass.trim()) fail('glass must be a non-empty string');
    if (r.strength != null && !VOCAB.strength.includes(r.strength)) {
      fail(`strength "${r.strength}" not in vocab (${VOCAB.strength.join(', ')})`);
    }
    if (!Array.isArray(r.methods) || r.methods.length === 0) {
      fail('methods must be a non-empty list');
    } else {
      for (const m of r.methods) if (!VOCAB.drinkMethods.includes(m)) fail(`drink method "${m}" not in vocab (${VOCAB.drinkMethods.join(', ')})`);
    }
  } else {
    if (!VOCAB.protein.includes(r.protein)) fail(`protein "${r.protein}" not in vocab (${VOCAB.protein.join(', ')})`);
    if (!VOCAB.course.includes(r.course)) fail(`course "${r.course}" not in vocab (${VOCAB.course.join(', ')})`);
    if (r.category && !VOCAB.category.includes(r.category)) fail(`category "${r.category}" not in vocab (${VOCAB.category.join(', ')})`);
    if (!Array.isArray(r.methods) || r.methods.length === 0) {
      fail('methods must be a non-empty list');
    } else {
      for (const m of r.methods) if (!VOCAB.methods.includes(m)) fail(`method "${m}" not in vocab`);
    }
  }

  if (!VOCAB.heat.includes(r.heat)) {
    fail(`heat "${r.heat}" not in vocab (${VOCAB.heat.join(', ')})`);
  }
  if (!VOCAB.difficulty.includes(r.difficulty)) {
    fail(`difficulty "${r.difficulty}" not in vocab (${VOCAB.difficulty.join(', ')})`);
  }
  for (const t of (kind === 'drink' ? ['prep', 'total'] : ['prep', 'cook', 'total'])) {
    if (typeof r.times?.[t] !== 'number') fail(`times.${t} must be a number (minutes)`);
  }
  if (typeof r.serves !== 'number' || r.serves < 1) fail('serves must be a positive number');
  if (normalizeSections(r.ingredients).every((s) => s.items.length === 0)) {
    fail('ingredients is empty');
  }
  if (normalizeSections(r.steps).every((s) => s.items.length === 0)) {
    fail('steps is empty');
  }

  // Every ingredient/step item and tip must be a non-empty STRING. A YAML object here
  // almost always means an unquoted "key: value" line (the colon makes YAML build a map)
  // — that ships broken data and crashes the shopping list. Catch it at build time.
  const badItem = (it) => typeof it !== 'string' || !it.trim();
  for (const field of ['ingredients', 'steps']) {
    for (const sec of normalizeSections(r[field])) {
      for (const it of sec.items) {
        if (badItem(it)) {
          fail(`${field} has a non-string item (${JSON.stringify(it)}). A colon likely turned a line into a YAML map — wrap the whole line in double quotes.`);
        }
      }
    }
  }
  if (Array.isArray(r.tips)) {
    for (const t of r.tips) {
      if (badItem(t)) fail(`a tip is a non-string value (${JSON.stringify(t)}). Wrap any "key: value" tip in double quotes.`);
    }
  }
  if (Array.isArray(r.extras)) {
    for (const x of r.extras) {
      if (!x || typeof x.label !== 'string' || typeof x.note !== 'string') {
        fail(`an extra must be { label: string, note: string } (got ${JSON.stringify(x)}).`);
      }
    }
  }

  // photo: optional one-line styling hint for the AI photo pipeline (how the finished
  // dish is plated/cut) — never rendered on the site, only fed to generate-photos.mjs.
  if (r.photo !== undefined && (typeof r.photo !== 'string' || !r.photo.trim())) {
    fail('photo must be a non-empty string (a plating hint for the photo pipeline)');
  }

  // planSwaps: optional, structured ingredient swaps that flip an eating-plan verdict.
  // Each entry: { for: [plan ids], replace: "<existing ingredient line>", with: "<line>",
  // note?: "…" }. `replace` must EXACTLY match a current ingredient line so the swap
  // can't silently drift when the recipe is edited.
  if (r.planSwaps !== undefined) {
    if (!Array.isArray(r.planSwaps)) {
      fail('planSwaps must be a list');
    } else {
      const lines = new Set(
        normalizeSections(r.ingredients).flatMap((s) => s.items)
          .filter((it) => typeof it === 'string').map((it) => it.trim()),
      );
      for (const s of r.planSwaps) {
        if (!s || !Array.isArray(s.for) || s.for.length === 0) {
          fail(`a planSwaps entry needs a non-empty "for" list of plan ids (got ${JSON.stringify(s)})`);
          continue;
        }
        for (const id of s.for) {
          if (!PLAN_IDS.has(id)) fail(`planSwaps "for" names unknown plan "${id}" (valid: ${[...PLAN_IDS].join(', ')})`);
        }
        if (typeof s.replace !== 'string' || !s.replace.trim()) fail('planSwaps "replace" must be a non-empty string');
        else if (!lines.has(s.replace.trim())) fail(`planSwaps "replace" line not found among ingredients: "${s.replace}"`);
        if (typeof s.with !== 'string' || !s.with.trim()) fail('planSwaps "with" must be a non-empty string');
        if (s.note !== undefined && typeof s.note !== 'string') fail('planSwaps "note" must be a string');
      }
    }
  }
  return errs;
}

// Apply a set of planSwaps entries to normalized ingredient sections, returning a new
// sections array with each `replace` line substituted by its `with` line. Used by the
// build to compute the "with swaps" nutrition variant per plan.
export function applyPlanSwaps(sections, swaps) {
  const bySource = new Map(swaps.map((s) => [s.replace.trim(), s.with]));
  return sections.map((sec) => ({
    section: sec.section,
    items: sec.items.map((it) => bySource.get(String(it).trim()) ?? it),
  }));
}
