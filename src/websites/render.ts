import { chromium, type Browser } from 'playwright-core';
import { publicUrl, readPublicPage, type PublicPage } from './public-read.js';
import { captureRequest, type CaptureRequest } from './rea.js';

export const CAPTURE_VIEWPORT = { width: 1280, height: 800 };
export type ReadControl = { id: string; label: string; href: string | null };
export type InteractionObservation = {
  before: string[];
  after: string[];
  responses: { url: string; body: string; mime: string }[];
};
export type RenderedPage = {
  page: PublicPage;
  assets: Map<string, PublicPage>;
  requests: CaptureRequest[];
  screenshot: string;
  warnings: string[];
  controls?: ReadControl[];
  interaction?: InteractionObservation;
};
const isText = (mime: string) => /text\/|javascript|application\/(?:ld\+)?json/i.test(mime);

export async function launchCaptureBrowser(): Promise<Browser> {
  const args = ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--disable-quic'];
  try {
    return await chromium.launch({ channel: 'chrome', headless: true, args });
  } catch {
    return chromium.launch({ headless: true, args });
  }
}

// All external requests are fulfilled through the DNS-pinned public transport.
// No browser cookies, credentials, writes, service workers or sockets reach the source.
export async function captureRenderedPage(
  url: string,
  reader: (url: string) => Promise<PublicPage> = (url) => readPublicPage(url, 'render'),
  control?: ReadControl,
): Promise<RenderedPage> {
  const origin = publicUrl(url).origin;
  const browser = await launchCaptureBrowser();
  const assets = new Map<string, PublicPage>();
  const requests: CaptureRequest[] = [];
  const warnings = new Set<string>();
  let interacting = false;
  const actionRequests = new Set<object>();
  const responseTasks: Promise<void>[] = [];
  const interaction: InteractionObservation = { before: [], after: [], responses: [] };
  const deadline = Date.now() + 45000;
  const timeout = setTimeout(() => void browser.close(), 46000);
  let count = 0,
    bytes = 0;
  try {
    const context = await browser.newContext({
      viewport: CAPTURE_VIEWPORT,
      deviceScaleFactor: 1,
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    const page = await context.newPage();
    page.on('response', (response) => {
      if (
        !actionRequests.has(response.request()) ||
        !/json/i.test(response.headers()['content-type'] ?? '')
      )
        return;
      responseTasks.push(
        (async () => {
          try {
            const body = await response.text();
            if (body.length <= 2 * 1024 * 1024 && interaction.responses.length < 20)
              interaction.responses.push({
                url: response.url(),
                body,
                mime: response.headers()['content-type']!,
              });
          } catch {
            /* Failed responses are not candidate evidence. */
          }
        })(),
      );
    });
    context.on('page', (popup) => {
      if (popup !== page) void popup.close();
    });
    await context.routeWebSocket('**/*', (socket) => {
      warnings.add('Live socket content was blocked.');
      socket.close();
    });
    await context.route('**/*', async (route) => {
      try {
        const request = route.request();
        const target = publicUrl(request.url());
        if (
          request.method() !== 'GET' ||
          /(?:^|\/)(?:logout|signout|delete|remove|checkout|purchase|subscribe|unsubscribe)(?:\/|$)/i.test(
            target.pathname,
          ) ||
          request.frame() !== page.mainFrame() ||
          (request.isNavigationRequest() && target.origin !== origin) ||
          ++count > 180 ||
          bytes > 32 * 1024 * 1024 ||
          Date.now() > deadline
        )
          throw new Error('Capture boundary');
        if (interacting && ['xhr', 'fetch'].includes(request.resourceType()))
          actionRequests.add(request);
        const result = (!interacting && assets.get(target.href)) || (await reader(target.href));
        publicUrl(result.url);
        if (Date.now() > deadline) throw new Error('Deadline');
        const buffer = Buffer.from(result.body, isText(result.contentType) ? 'utf8' : 'base64');
        bytes += buffer.length;
        if (bytes > 32 * 1024 * 1024) throw new Error('Byte budget');
        if (!assets.has(target.href))
          requests.push(captureRequest(result.url, result.contentType, result.body));
        assets.set(target.href, result);
        assets.set(result.url, result);
        if (result.url !== target.href) {
          await route.fulfill({ status: 302, headers: { location: result.url } });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType:
            isText(result.contentType) && !/charset=/i.test(result.contentType)
              ? `${result.contentType}; charset=utf-8`
              : result.contentType,
          body: buffer,
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
      } catch {
        warnings.add('Some requests were unavailable or blocked by the read-only capture limits.');
        await route.abort().catch(() => {});
      }
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(1200);
    const foundControls = await page.evaluate(() => {
      document
        .querySelectorAll('[data-ghost-control]')
        .forEach((el) => el.removeAttribute('data-ghost-control'));
      const result: { id: string; label: string; href: string | null }[] = [];
      for (const el of document.querySelectorAll('button,a,[role="button"]')) {
        const label = (el.getAttribute('aria-label') || el.textContent || '')
          .trim()
          .replace(/\s+/g, ' ');
        if (
          !/^(?:next(?: page)?|load more|show more|older(?: posts)?|›|»|→)$/i.test(label) &&
          el.getAttribute('rel') !== 'next'
        )
          continue;
        if (
          !(el instanceof HTMLElement) ||
          !el.getClientRects().length ||
          el.hasAttribute('disabled') ||
          result.length >= 8
        )
          continue;
        const id = `page-${result.length}`;
        el.setAttribute('data-ghost-control', id);
        result.push({
          id,
          label: label.slice(0, 80) || 'Next page',
          href: el instanceof HTMLAnchorElement ? el.href : null,
        });
      }
      return result;
    });
    const controls = foundControls.filter((item) => {
      if (!item.href) return true;
      try {
        return publicUrl(item.href).origin === origin;
      } catch {
        return false;
      }
    });
    const visibleTexts = () =>
      page.evaluate(() =>
        Array.from(document.body.querySelectorAll('*'))
          .filter(
            (el) =>
              el instanceof HTMLElement &&
              !['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName) &&
              !el.children.length &&
              el.getClientRects().length &&
              getComputedStyle(el).visibility !== 'hidden',
          )
          .slice(0, 3000)
          .map((el) => (el.textContent || '').trim().replace(/\s+/g, ' '))
          .filter(Boolean),
      );
    if (control) {
      const found = controls.find(
        (item) =>
          item.id === control.id && item.label === control.label && item.href === control.href,
      );
      if (!found)
        throw new Error('The selected page control changed. Rebuild the preview before retrying.');
      interaction.before = await visibleTexts();
      interacting = true;
      await page.locator(`[data-ghost-control="${found.id}"]`).click({ timeout: 5000 });
      await page.waitForTimeout(2000);
      await Promise.all(responseTasks);
      interaction.after = await visibleTexts();
      interacting = false;
    }
    await page.addStyleTag({
      content:
        '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}',
    });
    for (let i = 0; i < 6 && Date.now() < deadline - 6000; i++) {
      const atBottom = await page.evaluate(() => {
        window.scrollBy(0, innerHeight * 0.8);
        return scrollY + innerHeight >= document.documentElement.scrollHeight;
      });
      await page.waitForTimeout(300);
      if (atBottom) break;
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() =>
      Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 2000))]),
    );
    await page.waitForTimeout(300);
    const screenshot = `data:image/png;base64,${(await page.screenshot({ timeout: 5000 })).toString('base64')}`;
    const snapshot = await page.evaluate(() => {
      const clone = document.documentElement.cloneNode(true) as HTMLElement;
      const original = [
        document.documentElement,
        ...document.documentElement.querySelectorAll('*'),
      ];
      const copies = [clone, ...clone.querySelectorAll('*')];
      let shadow = false,
        canvas = false;
      if (original.length > 8000) throw new Error('Page exceeds the 8,000-element capture limit.');
      original.forEach((element, i) => {
        const copy = copies[i]!;
        if (element.shadowRoot) shadow = true;
        if (element.tagName === 'CANVAS') canvas = true;
        if (element instanceof HTMLImageElement && element.currentSrc)
          copy.setAttribute('src', element.currentSrc);
        if (element instanceof HTMLElement || element instanceof SVGElement) {
          const computed = getComputedStyle(element);
          copy.setAttribute(
            'style',
            Array.from(computed)
              .filter((key) =>
                /^(display|position|top|right|bottom|left|z-index|float|clear|width|height|min-width|min-height|max-width|max-height|box-sizing|overflow.*|visibility|opacity|color|background.*|border.*|padding.*|margin.*|font.*|text.*|line-height|letter-spacing|word.*|white-space.*|vertical-align|list-style.*|flex.*|grid.*|align.*|justify.*|gap|row-gap|column-gap|object.*|transform.*|box-shadow|filter|clip-path|content|appearance|aspect-ratio|fill|stroke.*)$/i.test(
                  key,
                ),
              )
              .map((key) => `${key}:${computed.getPropertyValue(key)};`)
              .join(''),
          );
        }
        if (element instanceof HTMLStyleElement && element.sheet) {
          try {
            copy.textContent = Array.from(element.sheet.cssRules)
              .map((rule) => rule.cssText)
              .join('\n');
          } catch {
            /* Reported through asset limits. */
          }
        }
      });
      return {
        html: '<!doctype html>' + clone.outerHTML,
        shadow,
        canvas,
        tall: document.documentElement.scrollHeight > 800 * 6,
      };
    });
    if (snapshot.html.length > 16 * 1024 * 1024)
      throw new Error('Rendered DOM exceeds the 16 MB limit.');
    if (snapshot.shadow) warnings.add('Shadow DOM components are not reproduced yet.');
    if (snapshot.canvas) warnings.add('Canvas content is not reproduced yet.');
    if (snapshot.tall)
      warnings.add('Long pages may contain content beyond the bounded scroll capture.');
    warnings.add(
      'Captured at 1280 × 800. Video, embedded frames and interactive behavior are not reproduced.',
    );
    return {
      page: { url: page.url(), body: snapshot.html, contentType: 'text/html' },
      assets,
      requests,
      screenshot,
      warnings: [...warnings],
      controls,
      ...(control ? { interaction } : {}),
    };
  } finally {
    clearTimeout(timeout);
    await browser.close();
  }
}

export async function screenshotPreview(html: string): Promise<string> {
  const browser = await launchCaptureBrowser();
  try {
    const context = await browser.newContext({
      viewport: CAPTURE_VIEWPORT,
      deviceScaleFactor: 1,
      javaScriptEnabled: false,
      serviceWorkers: 'block',
    });
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 8000 });
    return `data:image/png;base64,${(await page.screenshot({ timeout: 5000 })).toString('base64')}`;
  } finally {
    await browser.close();
  }
}
