# Roadmap

Design notes for agreed-but-not-yet-built features. Keep entries short and delete them
when shipped (the git history remembers).

The presentation overhaul ("dark bistro menu + lane colours") was agreed as four rounds.
**Round 1 shipped 2026-11-27** (style, compact front page, sticky toolbar, filter sheet,
list/grid, sort, URL state — see CLAUDE.md → *Presentation layer*). Still to come:

- **Round 2 — Shelves.** With no search/filter active, the menu becomes sections:
  *New this season* (photo row) → Mains by protein (Fish & Shellfish · Chicken · Beef ·
  Vegetarian & Vegan, each in its lane colour with a count + "See all" that applies the
  filter) → Sides & Sauces → Desserts. Any search/filter falls back to the flat results.
  No "recently cooked" / favourites (decided: skip).
- **Round 3 — Recipe as a cooking tool** (tuned for iPad + phone; never a laptop):
  sticky in-recipe tabs (Overview · Ingredients · Method · Nutrition), **Cook mode**
  (Screen Wake Lock, bigger type, tap-to-tick ingredients and steps, ingredients pinned
  beside steps on iPad), one-line stats on phones, variant chips labelled in words
  ("Less sugar") instead of emoji, prev/next that don't cover the text.
- **Round 4 — This week + aisle shopping.** Present the cart as *This week* (thumbnails,
  per-recipe servings, remove), and a shopping list merged and grouped by aisle (Produce ·
  Meat & Fish · Dairy · Pantry · Spices · Bar) with a by-recipe toggle; instructions behind ⓘ.
- **Follow-ups:** regenerate the site icon in the new palette (edit
  `branding/icon-brief.md` → `npm run icon`; still brick-red today); a photo-style pilot
  (~6 recipes) before regenerating all photos.
