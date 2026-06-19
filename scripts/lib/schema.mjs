// The single source of truth for the recipe format.
// Both build.mjs and validate.mjs import this so the site and the linter never drift.

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
  // High-level menu role: a main dish vs. an accompaniment. Defaults to 'main'.
  category: ['main', 'side'],
  // What kind of dish (the granular descriptor). One per recipe.
  course: ['main', 'salad', 'soup', 'side', 'sauce', 'pasta', 'taco', 'snack'],
  // Spice level. One per recipe.
  heat: ['none', 'mild', 'medium', 'hot'],
  // Effort. One per recipe.
  difficulty: ['easy', 'medium', 'advanced'],
};

// Human-friendly labels + display color hints for tags shown in the UI.
// `accent` = terracotta, `olive` = veg/green, `ink` = neutral, `stone` = muted.
export const PROTEIN_META = {
  beef: { label: 'Beef', color: 'accent' },
  chicken: { label: 'Chicken', color: 'accent' },
  fish: { label: 'Fish', color: 'ink' },
  seafood: { label: 'Seafood', color: 'ink' },
  vegetarian: { label: 'Vegetarian', color: 'olive' },
  vegan: { label: 'Vegan', color: 'olive' },
  pork: { label: 'Pork', color: 'accent' },
};

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
  ],
};

// Coarse time buckets the UI offers as quick filters (minutes, inclusive lower bound).
export const TIME_BUCKETS = [
  { key: 'under-30', label: 'Under 30 min', max: 30 },
  { key: '30-45', label: '30–45 min', min: 30, max: 45 },
  { key: '45-60', label: '45–60 min', min: 45, max: 60 },
  { key: 'over-60', label: 'Over 60 min', min: 60 },
];

const REQUIRED = [
  'title',
  'slug',
  'tagline',
  'pitch',
  'serves',
  'times',
  'difficulty',
  'protein',
  'methods',
  'cuisine',
  'course',
  'heat',
  'ingredients',
  'steps',
];

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

  for (const key of REQUIRED) {
    if (r[key] === undefined || r[key] === null || r[key] === '') {
      fail(`missing required field "${key}"`);
    }
  }
  if (errs.length) return errs; // don't cascade on a half-formed recipe

  if (typeof r.slug !== 'string' || !/^[a-z0-9-]+$/.test(r.slug)) {
    fail(`slug "${r.slug}" must be lowercase kebab-case`);
  }
  if (!VOCAB.protein.includes(r.protein)) {
    fail(`protein "${r.protein}" not in vocab (${VOCAB.protein.join(', ')})`);
  }
  if (!VOCAB.course.includes(r.course)) {
    fail(`course "${r.course}" not in vocab (${VOCAB.course.join(', ')})`);
  }
  if (r.category && !VOCAB.category.includes(r.category)) {
    fail(`category "${r.category}" not in vocab (${VOCAB.category.join(', ')})`);
  }
  if (!VOCAB.heat.includes(r.heat)) {
    fail(`heat "${r.heat}" not in vocab (${VOCAB.heat.join(', ')})`);
  }
  if (!VOCAB.difficulty.includes(r.difficulty)) {
    fail(`difficulty "${r.difficulty}" not in vocab (${VOCAB.difficulty.join(', ')})`);
  }
  if (!Array.isArray(r.methods) || r.methods.length === 0) {
    fail('methods must be a non-empty list');
  } else {
    for (const m of r.methods) {
      if (!VOCAB.methods.includes(m)) fail(`method "${m}" not in vocab`);
    }
  }
  for (const t of ['prep', 'cook', 'total']) {
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
  return errs;
}
