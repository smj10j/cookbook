---
name: verify
description: >-
  How to run and visually verify this static site (Tonight's Menu) after a
  change — serve docs/, drive it with the locally cached headless Chromium,
  and screenshot the affected part of a recipe spread.
---

# Verifying Tonight's Menu changes in a real browser

The jsdom suite (`npm test`) drives the real `app.js`, but CSS/layout changes
need real pixels. Recipe pages are hash-routed (`#/<slug>`), and the reader's
content scrolls inside `#spread .spread-scroll` (not the window).

1. Build + serve: `npm run build`, then `python3 -m http.server 8123 --directory docs`
   (run in background).
2. Playwright's browser cache usually exists at `~/Library/Caches/ms-playwright/`
   — no download needed. Use `playwright-core` (install in a temp dir, NOT this
   repo) with `executablePath` pointed at
   `chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell`.
3. Drive: `page.goto('http://localhost:8123/#/<slug>')`, wait for the selector
   you changed, scroll the inner scroller
   (`page.$eval('#spread .spread-scroll', el => { el.scrollTop = el.scrollHeight; })`),
   then `element.screenshot()` and Read the PNG.
4. Probe a food main AND a drink (`#/classic-daiquiri`), plus a 390px-wide
   viewport — check `document.documentElement.scrollWidth <= clientWidth` for
   horizontal overflow, and that the menu grid still renders (`.card` count,
   zero page errors).
