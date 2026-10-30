import { mkdir, writeFile } from 'node:fs/promises';
import { captureRenderedPage, screenshotPreview } from '../src/websites/render.js';
import { buildVisual } from '../src/websites/visual.js';
import { inspectPage } from '../src/websites/inspect.js';

// Public-site smoke test; no TinyFish sessions or paid provider calls.
const source = await captureRenderedPage('https://example.com/');
const visual = await buildVisual(
  source.page,
  inspectPage(source.page).fields,
  'smoke',
  async (url) => {
    const asset = source.assets.get(url);
    if (!asset) throw new Error('Asset unavailable');
    return asset;
  },
);
const preview = await screenshotPreview(visual.html);
await mkdir('artifacts', { recursive: true });
await writeFile(
  'artifacts/phase2-source.png',
  Buffer.from(source.screenshot.split(',')[1]!, 'base64'),
);
await writeFile('artifacts/phase2-preview.png', Buffer.from(preview.split(',')[1]!, 'base64'));
console.log(
  JSON.stringify({
    source: source.page.url,
    reads: source.requests.length,
    quality: visual.quality,
    warnings: source.warnings,
    screenshots_identical: source.screenshot === preview,
  }),
);
