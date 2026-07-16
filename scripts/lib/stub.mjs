// Generates a tiny shareable landing page per recipe at /r/<slug>/.
// Its whole job is to carry per-recipe Open Graph / Twitter "link preview" tags
// (image + title + description) that iMessage/Slack/etc. read, then bounce the
// visitor into the full single-page app. Crawlers read the <meta> and ignore the JS.

import { PALETTE } from './theme.mjs';

const escAttr = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Absolute URL of the preview image for a recipe (prefer the JPEG; fall back to the
// webp hero, then the site default). `hasJpg` is passed in so this stays pure/testable.
export function ogImageUrl(recipe, site, hasJpg) {
  if (hasJpg) return `${site}/og/${recipe.slug}.jpg`;
  if (recipe.hero) return `${site}/${recipe.hero}`;
  return `${site}/og/_home.jpg`;
}

export function recipeStubHtml(recipe, { site, ogImage }) {
  const t = escAttr(recipe.title);
  const d = escAttr(recipe.tagline || '');
  const slug = recipe.slug;
  const url = `${site}/r/${slug}/`;
  const img = escAttr(ogImage);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${t} — Tonight's Menu</title>
<meta name="description" content="${d}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Tonight's Menu">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="800">
<meta property="og:image:alt" content="${t}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${img}">
<style>
  :root{color-scheme:light}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:${PALETTE.cream};color:${PALETTE.ink};font-family:-apple-system,system-ui,sans-serif;padding:24px}
  .card{max-width:520px;text-align:center}
  .card img{width:100%;border-radius:6px;box-shadow:0 24px 60px -30px rgba(0,0,0,.5);display:block}
  h1{font-family:Georgia,serif;font-weight:500;font-size:26px;margin:22px 0 8px;line-height:1.15}
  p{color:${PALETTE.stone};margin:0 0 18px}
  a{display:inline-block;background:${PALETTE.ink};color:${PALETTE.cream};text-decoration:none;
    padding:11px 20px;border-radius:100px;font-size:15px}
</style>
<script>
  // Open the recipe in the full app. Preview crawlers read the meta above and ignore this.
  (function () { var base = location.pathname.replace(/\\/r\\/.*$/, '/'); location.replace(base + '#/${slug}'); })();
</script>
</head>
<body>
  <main class="card">
    <img src="../../images/${slug}.webp" alt="${t}">
    <h1>${t}</h1>
    <p>${d}</p>
    <a href="../../#/${slug}">Open recipe →</a>
  </main>
</body>
</html>
`;
}

export { escAttr };
