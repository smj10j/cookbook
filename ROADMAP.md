# Roadmap

Design notes for agreed-but-not-yet-built features. Keep entries short and delete them
when shipped (the git history remembers).

## 1C — Interactive eating-plan variant toggle (builds on planSwaps)

**Shipped so far (1B):** `planSwaps` frontmatter → build-computed per-plan "with swaps"
nutrition → the fit table shows "✗ as written ⇄ ~ with the swap" (see CLAUDE.md →
*planSwaps*). The variant is information only; the printed recipe never changes.

**The 1C idea:** let the reader *apply* a plan variant interactively — a small toggle in
the recipe spread ("Classic / 🫘 Kidney-friendly") that re-renders the affected parts.

Design sketch, agreed with Stephen (2026-07-05):

- **Data:** no new authoring format — 1C consumes the same `planSwaps` entries. A recipe
  with swaps for N plans gets up to N variants (plans sharing identical swap sets can
  share a variant).
- **UI:** a toggle chip row above the Ingredients column, only when the recipe has
  planSwaps. Active variant: swapped ingredient lines re-render in place (highlighted,
  e.g. olive underline + ⇄ marker), the nutrition table + fit table switch to the
  variant's numbers, and the flag column recomputes. Verdict chips animate ✗→~ so the
  payoff is visible.
- **Shopping list:** follows the active variant — `shopSectionsForRecipe` gains a variant
  parameter; the overlay notes "kidney-friendly variant" next to the recipe title.
  Persist the chosen variant per slug in localStorage next to `tm-selected`.
- **Share links:** `#/<slug>` stays canonical. A variant hash (`#/<slug>~kidney`) is
  nice-to-have, not required for v1.
- **Filter interplay:** once variants exist, the "Good for" filter could optionally count
  swap-fixable recipes (badge "~ with swap"). Decide then — it blurs the filter's meaning,
  so default is OFF.
- **Tests:** lib-level variant application (pure), ui-level toggle → ingredient line +
  nutrition swap, shopping list follows, localStorage persistence.

**Effort:** roughly one session. **Prerequisite:** a few more authored planSwaps so the
toggle has enough coverage to feel like a feature, not an Easter egg.
