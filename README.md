# 🍽️ Tonight's Menu

An interactive flipbook of the dinners Stephen & Lauren keep coming back to —
pitched like a food magazine, filterable like a pantry, and published free on
GitHub Pages so it works on any phone or laptop.

**Live site:** https://smj10j.github.io/cookbook/  *(after the first deploy — see below)*

![Tonight's Menu](docs/images/_preview.webp)

---

## What's here

- **Two sections behind tabs at the top — Food and Drinks.** Food filters by course
  (main/side/dessert), protein, dish type, time, method, heat, and cuisine (the **Asian**
  filter rolls up Vietnamese, Japanese, Chinese, Thai, Sichuan, etc.). Drinks filter by
  base spirit, style, strength, flavor, and heat. Both have full-text search.
- Click any card to open the full recipe **spread** and flip left/right through the
  results with arrow keys, swipes, or the on-screen arrows.
- A **shopping-list builder**: tap the **+** on any card (food or drink), hit the floating
  🛒 cart in the top-right, set how many servings you want (quantities scale automatically),
  and copy the list to your clipboard — identical ingredients across recipes are merged into
  one line (garlic by the bulb, citrus by the fruit, bitters by the bottle). Pantry staples
  start unchecked; a ⚑ marks things you probably have but might want to double-check.
- Every recipe follows one **standard format**, so timings, ingredients, method,
  chef's tips, and extras are always in the same place.
- **Shareable links with rich previews:** open a recipe and tap the **share** button to copy
  (or, on a phone, send) a link like `…/cookbook/r/blackened-steak-salad/`. In iMessage, Slack,
  etc. it unfurls with the dish's photo and title (Open Graph preview), then opens straight
  into the recipe. (The in-app `#/slug` hash links still work, but only the `r/<slug>/`
  links show a preview — crawlers can't see a URL hash.)

## Adding a recipe (the easy way)

This repo is built to be driven by **Claude Code**. Just ask, in plain English:

> "Add this recipe: https://www.seriouseats.com/some-recipe"
>
> "Add a recipe for the chicken thing we had — paste: …"
>
> "Make a recipe for sheet-pan gnocchi with a chef tip or two."
>
> "Add a mezcal margarita" *(drinks work the same way)*

Claude uses the **add-recipe skill** (`.claude/skills/add-recipe/`) — or the **add-drink
skill** (`.claude/skills/add-drink/`) for cocktails — to:
1. Fetch & clean the source (if it's a URL), or take your text/idea.
2. Reshape it into our standard format, **give it a proper name**, and add chef's tips.
3. Drop it in `recipes/` (or `drinks/`), rebuild, and (optionally) generate a photo.

Both skills first check for a near-duplicate (and ask before adding one) and whether a new
filter is warranted (e.g. a new `dessert` course) before building.

You review, then it's live on the next push.

**If you're vague** ("add a recipe" or "something with salmon") Claude will first pitch
**three options** and let you pick before building — so you get a say in the direction.
Give a URL or a specific dish and it skips straight to building.

## Adding a recipe (by hand)

1. Copy `recipes/blackened-steak-salad.md` (the reference recipe) to
   `recipes/your-dish.md`.
2. Edit the fields. The format is documented in **[CLAUDE.md](CLAUDE.md)**; the
   controlled vocabularies (protein, methods, course, heat) live in
   `scripts/lib/schema.mjs`.
3. Run `npm run build` — it validates and regenerates the site data.
4. Commit `recipes/your-dish.md` **and** `docs/recipes.json`.

## Recipe photos (AI-generated)

Photos are optional — recipes without one show an elegant typographic card. To
generate AI food photography for every recipe that's missing one:

1. Put an OpenAI key in a `.env` file (it is git-ignored, never committed):
   ```
   OPENAI_API_KEY=sk-...
   ```
2. Run `npm run photos`. It generates an image per recipe, saves it to
   `docs/images/<slug>.webp`, and adds the `hero:` field to the recipe file.
3. `npm run build` and commit the new images + updated recipes.

See `scripts/generate-photos.mjs` for options (`--only <slug>`, `--force`).

## Site icon (AI-generated favicon + home-screen app icon)

The favicon and the icon used when someone adds the site to their phone's home screen come
from one AI-generated master image, described in **`branding/icon-brief.md`** (plain
English — edit it to change the design). To regenerate:

1. Put an OpenAI key in `.env` (see above) — same key the photo pipeline uses.
2. Run `npm run icon`. It only calls the image API if `icon-brief.md` changed since the
   last run (tracked in `branding/icon.meta.json`); use `npm run icon -- --force` to
   regenerate anyway. Needs ImageMagick installed to derive the favicon/app-icon sizes.
3. Commit the regenerated files under `docs/icons/`, `docs/favicon.ico`,
   `docs/site.webmanifest`, and `branding/icon.meta.json`.

CI does this automatically too — an `icon` job (mirroring the photos job above) fires only
when `icon-brief.md` changes and opens a PR with the new icon for review.

## Local development

```bash
npm install          # one-time: installs js-yaml + jsdom (for tests)
npm test             # run the full test suite (logic + jsdom UI tests)
npm run preview      # builds (validate + test first), then serves at http://localhost:8000
# or:
npm run build        # validate + test, then regenerate docs/recipes.json
npm run validate     # lint every recipe against the schema
```

`npm run build` won't produce output if validation or tests fail — testing is baked in.

The site itself is plain HTML/CSS/JS — no framework, no build step for the page.
The only "build" turns `recipes/*.md` into `docs/recipes.json`.

## How it's deployed

A GitHub Action (`.github/workflows/deploy.yml`) builds and deploys the site to GitHub
Pages on every push to `main` — but **only after validation and the full test suite
pass**. A failing test blocks the deploy. The workflow also scans for accidentally-
committed API keys and refuses to deploy if it finds one.

## Repo layout

```
recipes/      ← the food recipes (edit these)
drinks/       ← the cocktails (kind: drink)
docs/         ← the published site (Pages serves this)
scripts/      ← build, validate, and photo tooling
CLAUDE.md     ← the format spec + house style (for Claude and for you)
```
