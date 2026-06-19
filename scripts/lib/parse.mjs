import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import yaml from 'js-yaml';
import { normalizeSections } from './schema.mjs';

// Split a Markdown file into YAML frontmatter (between leading `---` fences) and body.
export function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error('no YAML frontmatter found (expected leading --- fence)');
  const data = yaml.load(match[1]) || {};
  const body = (match[2] || '').trim();
  return { data, body };
}

// Read one recipe .md file into a normalized recipe object.
export function readRecipeFile(path) {
  const raw = readFileSync(path, 'utf8');
  const { data, body } = parseFrontmatter(raw);
  const fileSlug = basename(path).replace(/\.md$/, '');
  return {
    ...data,
    slug: data.slug || fileSlug,
    category: data.category || 'main',
    headnote: body || null,
    ingredients: normalizeSections(data.ingredients),
    steps: normalizeSections(data.steps),
    tips: data.tips || [],
    extras: data.extras || [],
    tags: data.tags || [],
    equipment: data.equipment || [],
    _file: basename(path),
  };
}

// Read every recipe in a directory, sorted by title.
export function readAllRecipes(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  const recipes = files.map((f) => readRecipeFile(join(dir, f)));
  recipes.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  return recipes;
}
