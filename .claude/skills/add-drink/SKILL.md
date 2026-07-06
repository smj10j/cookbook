---
name: add-drink
description: >-
  Add a cocktail or drink to the Tonight's Menu cookbook from a URL, pasted text, or a
  from-scratch idea. Use whenever the user wants to add, ingest, import, or create a
  drink/cocktail for this repo — e.g. "add this cocktail <url>", "make a mezcal drink",
  "add a margarita". Normalizes to the house drink format, names it well, adds bar tips,
  builds, and (optionally) generates a photo. For FOOD, use the add-recipe skill instead.
---

# Add a drink to Tonight's Menu

You are adding one or more cocktails to this cookbook. The output is a new
`drinks/<slug>.md` file in the house drink format, plus a rebuilt site.

## 0. Read the format first

Before writing anything, read:
- `CLAUDE.md` — the format spec, the **Drinks (cocktails)** section, controlled vocab,
  voice, and the Stephen & Lauren context.
- `drinks/classic-daiquiri.md` — the golden reference drink. Match its shape exactly.

## 1. Two pre-flight checks (do these BEFORE building)

1. **Duplicate / near-duplicate.** Scan `drinks/` (and `recipes/`) for an existing drink
   that's the same or a close variation. If you find one, **stop and ask** (AskUserQuestion)
   whether to **abort**, **merge** the two interactively with your help, or **add it anyway**
   as a distinct variation. Don't silently create a near-twin.
2. **New filter/vocab value?** If the drink doesn't fit the existing `base` / `family` /
   `methods` / `strength` vocab, consider whether it needs a new value (per *Growing the
   vocabulary* in CLAUDE.md). Add it to `VOCAB` + label maps in `scripts/lib/schema.mjs` and
   document it in CLAUDE.md first — conservatively, and flag it to Stephen rather than
   ballooning the filters.

## 2. Choose the path — and OFFER 3 OPTIONS when the request is open-ended

- **A specific URL** → ingest it (WebFetch; pull the full recipe: name, ingredients with
  measures, method, glass, garnish, any notes; grab the `og:image` as a candidate photo).
  Skip the options step.
- **A specific drink or pasted recipe** ("add a French martini", or pasted text) → build it
  directly. Skip the options step.
- **Open-ended** ("add a cocktail", "something with mezcal", "a fun shot") → **DON'T build
  yet.** Pitch **three distinct options** (vary the base spirit, family/style, and flavor) —
  each a tempting title + a one–two sentence pitch with a single *italic* money line — and let
  Stephen pick via AskUserQuestion. Then build only the chosen one.

## 3. Normalize to the house drink format

Create `drinks/<slug>.md` with frontmatter exactly like the golden daiquiri:

- **Name it well** — the real cocktail name, appetizing, not a chat title.
- **slug** = lowercase-kebab-case = filename; unique (check `drinks/`).
- **kind: drink** (required).
- **pitch**: 3–5 sentences, Bon Appétit / bartender voice, exactly one *italic* money line.
- **Controlled vocab only** for `base`, `family`, `methods`, `strength` (see CLAUDE.md /
  `schema.mjs`). `glass` is free text Title Case. `tags` are free text — include 1–3 flavor
  tags from `citrusy, tropical, creamy, fruity, herbal, smoky, spicy, dessert, refreshing,
  boozy` so the drink shows up under the Drinks "Flavor" filter.
- **serves: 1** by default (one drink). If the source/dish is naturally a batch (a punch, a
  pitcher), recommend a size and let Stephen choose, then scale to it.
- **times**: `{ prep, total }` in minutes (no `cook`) — usually ~5.
- **Quantities in `oz`**; include an `Ice` line and a garnish line in `ingredients`.
- **Chef/bar tips**: ALWAYS 2–4. Real, useful ones (dry-shake for egg white, double-strain,
  chill the glass, ratio tweaks for Stephen's drier vs Lauren's sweeter palate).
- **extras**: variations, a "From the garden" note (mint/basil/jalapeño/serrano/habanero)
  when it fits, batch-for-two, swaps.
- Shellfish/dietary rules don't apply to drinks, but honor the household: Lauren likes sweet,
  Stephen likes more bitter / spirit-forward — offer balance tweaks.
- **source**: `{ name, url }` — credit a site if it came from one; otherwise
  `{ name: "Adapted from Stephen's ChatGPT bar notes", url: null }`.
- Set `created`/`updated` to today.
- **YAML safety**: wrap any ingredient/step/tip/tagline containing a colon-space (`": "`) in
  double quotes, or rephrase with an em-dash — otherwise YAML mis-parses it as a map.
- Leave `hero:` out for now (the photo step adds it).

## 4. Build & validate

```bash
npm run build
```

Runs `npm run validate` and `npm test`, then regenerates `docs/recipes.json` — it won't
complete if validation or any test fails. Fix the reported fields and rebuild until clean.
If your change touches site logic (not just drink data), add/update tests in `test/` first.

## 4.5 Nutrition — teach the database any new ingredients

Every card (drinks included) shows an estimated per-serving **Nutrition** panel, computed
at build time from `data/nutrition.json`. You don't add a `nutrition:` field — but if the
drink uses a spirit, liqueur, juice, or syrup the DB has never seen, add it or it's dropped
from the estimate. The build prints a `⚠ Nutrition:` warning for anything missing.

1. After building: `npm run nutrition -- <slug>` (this drink's numbers + unmatched items).
2. Look up each unmatched ingredient online (USDA, or the bottle's label for a branded
   liqueur) with **WebSearch / WebFetch**.
3. Add an entry to `data/nutrition.json` per the ingredient's **smallest divisible unit** —
   for drink liquids that's a **fluid ounce** (`"unit": "oz"`, `g` ≈ 28–34). Follow the
   schema + conventions in `CLAUDE.md` (→ *Nutrition*); add ASCII `aliases` for accented
   names (Kahlúa→kahlua, etc.). Spirits/liqueurs read higher than `4·carb+9·fat` because
   alcohol adds ~7 kcal/g — use known per-ounce calorie values (≈64 kcal/oz for an 80-proof
   spirit, higher for liqueurs).
4. Rebuild and re-run `npm run nutrition` until the drink is **high** confidence. Commit
   `data/nutrition.json` with the rest.

## 4.6 Eating-plan fit — review the verdicts (they ship with the card)

Drink cards also render the **Eating-plan fit** table (see `CLAUDE.md` → *Eating-plan
fit*), computed from the same per-serving estimate — nothing to author, but review it:

1. Run `npm run plans -- <slug>` once the DB is complete (the table only renders at
   **high** confidence).
2. Know the drink rules: **alcoholic drinks cap at "~ Okay"** (no plan rates alcohol
   optimal; only a `base: non-alcoholic` drink can score "✓ Great fit"), and **sugar
   drives most flags** — a syrup-heavy tiki drink going red for DASH/AHA/Low-Sugar is
   honest, not a bug. A wall of red on a *simple* sour usually means a mis-scaled
   nutrition entry (per-cup values stored per oz) — fix the data, not the verdict.
3. Mention a notable verdict in your summary when it's useful ("sessionable and
   plan-friendly as cocktails go" / "a dessert drink — flags every sugar cap").
4. **Author `planSwaps` for every fixable ✗ verdict — standard step.** Run
   `npm run plans -- --near-miss`; for hits on your new drink, encode the "skinny"
   variant as `planSwaps` entries (a lighter liqueur pour, half the syrup, less juice —
   classic bar practice; an allulose simple syrup is a fair tip since it's the one
   alt-sweetener that behaves like sugar in a shaker). Chips are additive in the reader,
   so separate concerns (lighter pour vs less syrup) can be separate entries. Follow
   `CLAUDE.md` → *planSwaps*: `replace` verbatim, `with` parseable, ⇄ confirmed via
   `npm run plans -- <slug>` — **a swap that doesn't lift its verdict fails `npm test`**.
   Remember boozy drinks cap at "~ Okay" regardless; a swap can still lift ✗ → ~.

## 5. Photo (standard step — every card gets one)

A photo is **part of adding a drink**, not optional. Same pipeline as food
(`npm run photos -- --only <slug>`, then `npm run og`, then rebuild) — the prompt builder
detects `kind: drink` and styles the cocktail in its glassware. Prefer a real source photo of
the actual drink if it fits the book's calm, editorial look; otherwise generate one. The bar
is **consistency** — a coherent set beats one off-brand shot.

## 6. Show & commit

- Summarize what you added (title, base/family, key fields) and offer a preview at `#/<slug>`.
- Commit `drinks/<slug>.md` and `docs/recipes.json` (and any new image) together. Only
  commit/push when the user asks. Push triggers the GitHub Pages deploy.

## Adding several at once

Loop the steps per drink, then build once at the end. Watch for duplicates of drinks already
in `drinks/` — combine rather than double up.
