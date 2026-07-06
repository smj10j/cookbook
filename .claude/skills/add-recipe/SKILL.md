---
name: add-recipe
description: >-
  Add a recipe to the Tonight's Menu cookbook from a URL, pasted text, or a
  from-scratch idea. Use whenever the user wants to add, ingest, import, or create
  a recipe for this repo — e.g. "add this recipe <url>", "ingest this recipe",
  "make a recipe for X". Fetches and cleans the source, normalizes it to the house
  format, names it well, adds chef's tips, builds, and (optionally) generates a photo.
---

# Add a recipe to Tonight's Menu

You are adding one or more recipes to this cookbook. The output is a new
`recipes/<slug>.md` file that matches the house format, plus a rebuilt site.

## 0. Read the format first

Before writing anything, read:
- `CLAUDE.md` — the format spec, controlled vocabularies, voice, and the
  Stephen & Lauren context (equipment, garden, dietary exclusions).
- `recipes/blackened-steak-salad.md` — the golden reference recipe. Match its shape.

> **Adding a drink/cocktail instead?** Use the **add-drink** skill
> (`.claude/skills/add-drink/SKILL.md`) — drinks have their own format and live in `drinks/`.

## 0.5 Two pre-flight checks (do these BEFORE building)

1. **Duplicate / near-duplicate.** Scan `recipes/` (and `drinks/`) for an existing recipe
   that's the same dish or a close variation. If you find one, **stop and ask** (AskUserQuestion)
   whether to **abort**, **merge** the two interactively with your help, or **add it anyway**
   as a distinct variation. Don't silently create a near-twin.
2. **New filter/vocab value?** If the recipe doesn't fit the existing vocab, consider whether
   it needs a new value — e.g. a **dessert** is neither a main nor a side, so it takes
   `category: dessert` + `course: dessert`. Add any genuinely-needed value to `VOCAB` + label
   maps in `scripts/lib/schema.mjs` and document it in CLAUDE.md first — conservatively, and
   flag it to Stephen rather than ballooning the filters.

## 1. Choose the path — and OFFER 3 OPTIONS when the request is open-ended

Decide which case you're in:

- **A specific URL** → ingest it (see below). Skip the options step.
- **A specific dish or pasted recipe** ("add our chicken piccata", or pasted text) →
  build it directly. Skip the options step.
- **Open-ended** ("add a recipe", "make something with salmon", "I want a taco night")
  → **DO NOT start building yet.** First pitch **three distinct options** and let
  Stephen choose. Only after he picks one do you build the full recipe.

### Presenting 3 options (open-ended case)

Offer three genuinely different takes — vary the protein, technique, cuisine, or
format so it's a real choice, not three flavors of the same dish. For each option give:
a tempting **title** and a one-to-two sentence editorial pitch with a single *italic*
"money line." Honor the constraints (no pork/lamb/duck/turkey; dinner for two; their
equipment + garden). Shellfish is allowed — Lauren eats it, Stephen doesn't — so it's
fine to offer, just flag a fish/veg swap for Stephen. Use the **AskUserQuestion** tool so Stephen can pick in one
tap (or just number them 1–3 in chat). Wait for his choice, then continue to step 2 to
build only the chosen recipe.

### Ingesting a URL

Fetch it with the WebFetch tool. Ask it to return the full recipe: title, yield,
total/active time, the complete ingredient list (with quantities), the full
step-by-step instructions, and any author notes/tips. Recipe sites bury this in ads and
"life story" preamble — pull only the recipe. Also try to capture the page's `og:image`
URL; if there's a good one, note it as a candidate photo.

## 2. Normalize to the house format

Create `recipes/<slug>.md` with YAML frontmatter exactly like the golden example.
Key obligations (full spec in `CLAUDE.md`):

- **Name it well.** Give the actual dish a descriptive, appetizing title — never a
  vague conversation title.
- **slug** = lowercase-kebab-case = the filename. Make it unique (check `recipes/`).
- **pitch**: a 3–5 sentence editorial pitch (Bon Appétit voice) with exactly one
  *italic* money line. Lead with technique or the visual moment.
- **Controlled vocab only** for `protein`, `methods`, `course`, `heat`, `difficulty`,
  `category` (see `scripts/lib/schema.mjs`). `cuisine` and `tags` are free text.
- **`category`**: `main`, `side`, or `dessert`. Defaults to `main` (omit it for mains). Use
  `category: side` for accompaniments (sauces, salsas, dips, chips, casseroles, simple sides)
  and `category: dessert` (+ `course: dessert`) for sweets & baked goods. This drives the
  site's Course filter (Main / Side / Dessert).
- **times**: realistic `prep`/`cook`/`total` in minutes (total may exceed prep+cook
  for marinating/chilling — call that out in the pitch or a tip).
- **serves**: default to **2** (dinner for two) and rescale a source recipe's ingredient
  quantities to serve 2 for a normal plated dish. BUT keep a larger natural yield for true
  batch recipes — a casserole, a pot of soup made for leftovers, a dozen deviled eggs, a jar
  of salsa, a snack mix. When the source specifies something other than 2, or the dish is
  naturally a bigger batch, **don't silently pick**: recommend the serving size you think
  fits (e.g. "this soup is great to batch — keep it at 8?") and let Stephen choose with
  **AskUserQuestion**, then scale the quantities to his choice.
- **Chef's tips**: ALWAYS add 2–4. If the source has none, contribute your own real,
  useful ones. This is a house rule.
- **extras**: variations, pairings, make-ahead, and a "From the garden" note when the
  garden herbs/produce fit.
- Respect the dietary exclusions: no pork, lamb, duck, or turkey. If a source recipe
  centers on those, adapt it (swap the protein) and say so in a tip. **Shellfish is
  fine** — keep it (Lauren eats it); when a dish is built around shellfish, add a tip
  with a fish/vegetable swap so Stephen can eat it too.
- **source**: `{ name, url }` — credit the original site with its URL if it came from
  one; otherwise `{ name: "Adapted from Stephen's ChatGPT recipe notes", url: null }`
  or a sensible attribution.
- Set `created`/`updated` to today's date.
- **YAML safety**: wrap any ingredient/step/tip/tagline containing a colon-space
  (`": "`) in double quotes, or rephrase — otherwise YAML mis-parses it as a map.
- Leave `hero:` out for now (the photo step adds it).

## 3. Build & validate

```bash
npm run build
```

This runs `npm run validate` and `npm test`, then regenerates `docs/recipes.json` — the
build won't complete if validation or any test fails. If it reports errors (e.g. an
ingredient that became a YAML map because of an unquoted colon), fix the named fields and
rebuild until clean. If your change touches site logic (not just recipe data), add or
update tests in `test/` per `CLAUDE.md` before committing.

## 3.5 Nutrition — teach the database any new ingredients

Each card shows an estimated per-serving **Nutrition** panel, computed at build time from
`data/nutrition.json` (an ingredient DB keyed by each item's *smallest divisible unit*).
You do **not** add a `nutrition:` field to the recipe — but if your recipe uses an
ingredient the DB has never seen, you must add it, or that ingredient is silently dropped
from the estimate. The build prints a `⚠ Nutrition:` warning listing anything missing.

1. After building, run the coverage report:
   ```bash
   npm run nutrition -- <slug>     # this recipe's numbers + any unmatched ingredients
   npm run nutrition               # (or the whole-cookbook list)
   ```
2. For each **unmatched** ingredient, look up its nutrition online (USDA FoodData Central
   is the gold standard; a manufacturer label works for branded items). Use **WebSearch /
   WebFetch**.
3. Add an entry to `data/nutrition.json` storing the values for the ingredient's **smallest
   divisible unit** (a single shrimp, a teaspoon of a spice, a fluid ounce of a liqueur),
   following the schema and unit conventions in `CLAUDE.md` (→ *Nutrition*). Give it
   sensible `aliases` (including an ASCII alias for any accented name), a `density` if it's
   ever measured by volume, and an `each` (grams/piece) if recipes count it by piece.
   Sanity-check that `kcal ≈ 4·protein + 4·carb + 9·fat` (alcohol reads higher).
4. Rebuild (`npm run build`) and re-run `npm run nutrition` until the recipe is **high**
   confidence with no unmatched ingredients (a stray garnish like a whole pie pumpkin that
   would double-count is fine to leave out). Commit `data/nutrition.json` alongside the rest.

### 3.6 Eating-plan fit — review the verdicts (they ship with the card)

Every card also renders an **Eating-plan fit** table (DASH, MIND, Mediterranean, TLC,
AHA Heart-Healthy, Diabetes Plate, Kidney-Friendly, Low-Carb, Low Added Sugar,
Calorie-Smart) plus per-nutrient plan flags — computed from the same per-serving estimate
(see `CLAUDE.md` → *Eating-plan fit*). You author nothing, but you must **review it**:

1. After the nutrition DB is complete, run:
   ```bash
   npm run plans -- <slug>
   ```
   High confidence is required — the fit table is hidden for thin estimates, so step 3.5
   is what turns it on.
2. **Sanity-check the verdicts against the dish.** A surprising wall of red usually means
   a data bug, not an unhealthy dish — a mis-scaled DB entry (per-cup values stored per
   tsp), a brine or marinade counted as fully consumed, or a "serves" mismatch. Fix the
   data, not the verdict.
3. **Mention notable fits/misfits in your summary to Stephen** — e.g. "DASH/heart-friendly
   as written" or "blows every sodium cap; the low-sodium soy swap fixes most of it".
4. **Author `planSwaps` for every fixable ✗ verdict — this is a standard step, not an
   extra.** Start from `npm run plans -- --near-miss`, then go further: **the
   substitution palette in `CLAUDE.md` → planSwaps** (coconut aminos for soy, Greek
   yogurt for cream/crema, zoodles/cauliflower rice for pasta/couscous, olive oil for
   butter, chicken breast for fatty red meat, CKD-size fillet portions…) closes gaps
   the near-miss heuristic calls out of range — aggressive swaps, including protein
   swap-outs, are welcome as long as the variant is still recognizably the dish. The
   fit table then shows "✗ ⇄ ~ with the swap" and the reader gets the **variant
   toggle** (chips are additive; two swaps of the same line become separate,
   mutually-exclusive chips). Follow `CLAUDE.md` → *planSwaps* exactly: `replace` must
   match an ingredient line verbatim, `with` must carry a parseable quantity (the
   parser ignores parenthetical sizes), and confirm the ⇄ line appears in
   `npm run plans -- <slug>` after rebuilding — **a declared swap that doesn't lift its
   verdict fails `npm test`** (the no-dead-swaps gate). Skip only what's genuinely
   unfixable (a steak's sat fat, a vegetable's own sugars) — never fake a green row.

## 4. Photo (standard step — every card gets one)

A photo is **part of adding a recipe**, not an afterthought — generate one so the card never
ships as a bare placeholder, unless there's genuinely no usable image. **Prefer a real photo
from the source over an AI one** — when you ingest a URL, capture its `og:image` (or the main
dish photo) as a candidate.

**Decision rule — source image first:**

1. If the source has a beautiful, high-resolution photo of the *actual dish* that
   already fits the book's look and feel (clean, appetizing, well-lit, croppable to a
   roughly square card), use it: download it to `docs/images/<slug>.webp`,
   resizing/recompressing to match the other cards (~1200px, webp), and set
   `hero: images/<slug>.webp`. The `source` field already credits the site.
2. If the source photo is *close* — good food but wrong crop, size, or aspect — resize,
   recrop, or recompress it to fit, as long as the result still looks at home next to
   the existing cards.
3. Only if there's no usable source image, or it would clash with the book's style
   (busy background, heavy filter, watermark, low-res, off-brand styling), fall back to
   generating one with AI.

**The bar is consistency.** Never let the book become a smorgasbord of randomly styled
images — a coherent set of AI photos beats one gorgeous but stylistically off-brand
source photo. When in doubt about whether a source image fits, generate instead.

To generate with AI (the `OPENAI_API_KEY` is already configured in `.env` on Stephen's
machine — just run the pipeline; **don't pre-flight for the key or pause to ask**, the
script errors clearly if it is ever truly missing):

```bash
npm run photos -- --only <slug>
```

The build auto-attaches `docs/images/<slug>.webp` (no frontmatter edit needed). The
prompt in `scripts/generate-photos.mjs` is tuned for the sweet spot Stephen wants:
**a real, photographic look AND mouth-watering, Instagram-grade food styling** — fresh
glistening ingredients, beautiful plating and props, gorgeous light — that is still
*attainable* (no plastic/CGI/cartoon perfection). It should make you want to cook it
tonight, while looking like a real photo. Regenerate (optionally `--quality high`) if a
result drifts toward either failure mode — fake/over-glossy, or real-but-plain.

Either way, once `docs/images/<slug>.webp` exists, run `npm run og` to make its JPEG
link-preview image (used by the `/r/<slug>/` share page so iMessage/Slack unfurl with
the dish photo), then rebuild. Don't invent a photo if neither a source nor AI image is
available — the placeholder card looks intentional.

## 5. Show & commit

- Summarize what you added (title, key fields) and, if a server is handy, offer a
  preview at `#/<slug>`.
- Commit `recipes/<slug>.md` and `docs/recipes.json` (and any new image) together.
  Only commit/push when the user asks. Push triggers the GitHub Pages deploy.

## Adding several at once

Loop the steps per recipe. If the user pastes a batch or points at multiple URLs,
process each into its own file, then build once at the end. Watch for duplicates of
recipes already in `recipes/` — combine rather than double up.
