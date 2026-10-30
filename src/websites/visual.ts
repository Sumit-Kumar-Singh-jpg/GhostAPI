import { load } from 'cheerio';
import type { Field } from './inspect.js';
import { readPublicPage, publicUrl, type PublicPage } from './public-read.js';
import { captureRequest, type CaptureRequest, type CloneEvidence } from './rea.js';
import type { ReadControl } from './render.js';

export const CAPTURE_VERSION = 6;
export type Visual = {
  capture_version: number;
  captured_requests: CaptureRequest[];
  rea?: CloneEvidence;
  controls?: ReadControl[];
  rendered?: {
    mode: 'browser' | 'static-fallback';
    viewport: { width: number; height: number };
    captured_at: string;
    source_screenshot?: string;
    preview_screenshot?: string;
  };
  quality: {
    status: string;
    styles_loaded: number;
    styles_total: number;
    images_loaded: number;
    images_total: number;
  };
  html: string;
  bindings: {
    key: string;
    label: string;
    sample: string;
    matched: boolean;
    endpoint: string;
    rea_source?: { evidence_id: string; url: string };
  }[];
  notes: string[];
};
export async function buildVisual(
  page: PublicPage,
  fields: Field[],
  id: string,
  assetReader = (url: string) => readPublicPage(url, true),
): Promise<Visual> {
  const $ = load(page.body);
  const captured_requests = [captureRequest(page.url, page.contentType, page.body)];
  const notes = [
    'Static visual reproduction. Scripts, navigation, forms, and embedded frames are disabled.',
    'Endpoints below are generated extraction APIs. Source network APIs have not been observed.',
  ];
  const cache = new Map<string, Promise<string>>();
  const unsupported = $('*')
    .toArray()
    .some(
      (el) =>
        'tagName' in el &&
        ['math', 'foreignobject', 'iframe', 'video', 'audio', 'canvas'].includes(
          el.tagName.toLowerCase(),
        ),
    );
  if (unsupported)
    notes.push(
      'Embedded frames, MathML, SVG foreign content, canvas and media playback are not reproduced.',
    );
  let failed = 0,
    mediaCount = 0,
    totalBytes = 0,
    active = 0;
  const waiting: (() => void)[] = [];
  async function read(url: string) {
    if (active >= 4) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      const asset = await assetReader(url);
      captured_requests.push(captureRequest(asset.url, asset.contentType, asset.body));
      return asset;
    } finally {
      active--;
      waiting.shift()?.();
    }
  }
  const blocked = new Set<string>();
  const resource = (raw: string, base: string, stylesheet = false): Promise<string> => {
    try {
      if (
        !stylesheet &&
        /^data:(?:image\/(?:png|jpeg|gif|webp|avif)|font\/(?:woff2?|ttf|otf));base64,[a-z0-9+/=]+$/i.test(
          raw,
        ) &&
        raw.length < 2 * 1024 * 1024
      )
        return Promise.resolve(raw);
      const url = publicUrl(new URL(raw, base).href).href;
      const cacheKey = `${stylesheet}:${url}`;
      if (cache.has(cacheKey)) return cache.get(cacheKey)!;
      if (!stylesheet && mediaCount >= 64) {
        if (!blocked.has(url)) {
          failed++;
          blocked.add(url);
        }
        return Promise.resolve('');
      }
      if (!stylesheet) mediaCount++;
      const result = read(url)
        .then(async (asset) => {
          if (/^text\/css/i.test(asset.contentType)) return stylesheet ? asset.body : '';
          if (stylesheet) return '';
          totalBytes += asset.body.length;
          if (totalBytes > 16 * 1024 * 1024) {
            failed++;
            return '';
          }
          return `data:${asset.contentType.split(';')[0]};base64,${asset.body}`;
        })
        .catch(() => {
          failed++;
          return '';
        });
      cache.set(cacheKey, result);
      return result;
    } catch {
      failed++;
      return Promise.resolve('');
    }
  };
  async function css(text: string, base: string) {
    if (/@import\s/i.test(text)) {
      failed++;
      if (
        !notes.includes(
          'Imported CSS is omitted; imported fonts or pseudo-element styles may differ.',
        )
      )
        notes.push('Imported CSS is omitted; imported fonts or pseudo-element styles may differ.');
    }
    text = text.replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;/gi, '');
    const matches = [...text.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)];
    const values = await Promise.all(matches.map((match) => resource(match[2]!, base)));
    for (let i = 0; i < matches.length; i++)
      text = text.replace(matches[i]![0], `url("${values[i] || 'about:blank'}")`);
    return text.replace(/<\/style/gi, '');
  }
  $(
    'script, iframe, frame, frameset, object, embed, base, meta, link:not([rel="stylesheet"]), audio, video, source, template, noscript, foreignObject, animate, animateMotion, animateTransform, set, math',
  ).remove();
  $('*')
    .filter(
      (_, el) =>
        'tagName' in el &&
        ['foreignobject', 'animate', 'animatemotion', 'animatetransform', 'set'].includes(
          el.tagName.toLowerCase(),
        ),
    )
    .remove();
  $('*').each((_, el) => {
    for (const name of Object.keys('attribs' in el ? el.attribs : {})) {
      if (
        /^on|^(?:srcdoc|nonce|integrity|action|formaction|target|ping|srcset|poster|background|xlink:href)$/i.test(
          name,
        )
      )
        $(el).removeAttr(name);
    }
  });
  $('a').removeAttr('href');
  $('svg [href],svg[href]').each((_, el) => {
    if (!/^#[a-z0-9_-]+$/i.test($(el).attr('href') ?? '')) $(el).removeAttr('href');
  });
  // Keep form elements for layout selectors. Sandbox and CSP disable submission.
  $('form').removeAttr('action').removeAttr('method').removeAttr('target');
  $('input').removeAttr('value').attr('autocomplete', 'off');
  const allStyles = $('link[rel="stylesheet"]').toArray();
  const styles = allStyles.slice(0, 16);
  let stylesLoaded = 0,
    imagesLoaded = 0;
  // Reserve the layout stylesheet slots before requesting decorative CSS assets.
  const rawStyles = await Promise.all(
    styles.map(async (el) => ({
      el,
      url: new URL($(el).attr('href') ?? '', page.url).href,
      text: await resource($(el).attr('href') ?? '', page.url, true),
    })),
  );
  const images = $('img').toArray();
  await Promise.all(
    images.map(async (el) => {
      const raw = $(el).attr('src') || $(el).attr('data-src') || '';
      const value = await resource(raw, page.url);
      if (value.startsWith('data:image/')) {
        $(el).attr('src', value);
        imagesLoaded++;
      } else $(el).removeAttr('src');
    }),
  );
  for (const { el, url, text } of rawStyles) {
    if (text) {
      const bundled = await css(text, url);
      $(el).replaceWith(`<style data-ghost-bundled>${bundled}</style>`);
      stylesLoaded++;
    }
  }
  $('link').remove();
  for (const el of $('style').not('[data-ghost-bundled]').toArray())
    $(el).text(await css($(el).text(), page.url));
  for (const el of $('[style]').toArray())
    $(el).attr('style', await css($(el).attr('style')!, page.url));
  // Only bundled resources can load. No URL from source markup receives ambient local credentials.
  $('[src]:not(img)').removeAttr('src');
  const bindings = fields.map((field) => {
    let nodes =
      field.extractor.kind === 'css'
        ? $(field.extractor.selector).filter(':not(meta,link,script)')
        : $('__none__');
    if (!nodes.length)
      nodes = $('h1,h2,h3,p,span,div,td,strong').filter(
        (_, el) =>
          !$(el).children().length && $(el).text().replace(/\s+/g, ' ').trim() === field.sample,
      );
    const match = nodes.first();
    if (match.length) match.attr('data-ghost-field', field.key);
    return {
      key: field.key,
      label: field.label,
      sample: field.sample,
      matched: !!match.length,
      endpoint: `/api/websites/${id}/fields/${encodeURIComponent(field.key)}`,
    };
  });
  if (failed)
    notes.push(
      `${failed} assets unavailable or outside the capture limits; appearance may differ.`,
    );
  $('head').prepend(
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
  );
  return {
    capture_version: CAPTURE_VERSION,
    captured_requests,
    quality: {
      status:
        unsupported || failed > 0 || stylesLoaded < allStyles.length || imagesLoaded < images.length
          ? 'incomplete'
          : 'ready',
      styles_loaded: stylesLoaded,
      styles_total: allStyles.length,
      images_loaded: imagesLoaded,
      images_total: images.length,
    },
    html: $.html(),
    bindings,
    notes,
  };
}
