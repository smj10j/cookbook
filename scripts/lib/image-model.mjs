// The OpenAI image model used by both AI pipelines (recipe photos + site icon).
// gpt-image-1 was shut down 2026-10-23; gpt-image-1.5 / -mini follow on 2026-12-01.
// OpenAI's named replacements are gpt-image-2.5-sunburst (detailed, slower) and
// gpt-image-2.5-flare (faster). Override per run with IMAGE_MODEL=… if needed.
export const IMAGE_MODEL = process.env.IMAGE_MODEL || 'gpt-image-2.5-sunburst';

// True for any real GPT Image model id — used to tell a genuine generation recorded in
// branding/icon.meta.json from a placeholder bootstrap, without forcing a regeneration
// every time the model id is bumped.
export const isImageModel = (m) => typeof m === 'string' && m.startsWith('gpt-image-');
