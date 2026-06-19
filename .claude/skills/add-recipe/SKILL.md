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
"money line." Honor the constraints (no pork/lamb/duck/turkey/shellfish; dinner for two;
their equipment + garden). Use the **AskUserQuestion** tool so Stephen can pick in one
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
- **`category`**: `main` or `side`. Defaults to `main` (omit it for mains). Set
  `category: side` for accompaniments — sauces, salsas, dips, chips, casseroles, simple
  rice/bean sides. This drives the site's Main/Side "Course" filter.
- **times**: realistic `prep`/`cook`/`total` in minutes (total may exceed prep+cook
  for marinating/chilling — call that out in the pitch or a tip).
- **Chef's tips**: ALWAYS add 2–4. If the source has none, contribute your own real,
  useful ones. This is a house rule.
- **extras**: variations, pairings, make-ahead, and a "From the garden" note when the
  garden herbs/produce fit.
- Respect the dietary exclusions: no pork, lamb, duck, turkey, or shellfish. If a
  source recipe centers on those, adapt it (swap the protein) and say so in a tip.
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

## 4. Photo (optional, ask the user)

If the user wants a photo and an `OPENAI_API_KEY` is set in `.env`:

```bash
npm run photos -- --only <slug>
```

The build auto-attaches `docs/images/<slug>.webp` (no frontmatter edit needed). The
prompt in `scripts/generate-photos.mjs` is tuned for the sweet spot Stephen wants:
**a real, photographic look AND mouth-watering, Instagram-grade food styling** — fresh
glistening ingredients, beautiful plating and props, gorgeous light — that is still
*attainable* (no plastic/CGI/cartoon perfection). It should make you want to cook it
tonight, while looking like a real photo. Regenerate (optionally `--quality high`) if a
result drifts toward either failure mode — fake/over-glossy, or real-but-plain. Then rebuild.
If you captured a good `og:image` from a source URL, you may instead download that to
`docs/images/<slug>.webp` and set `hero:` by hand. Don't invent a photo if neither is
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
