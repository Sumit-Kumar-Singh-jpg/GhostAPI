import express from 'express';
import { products } from './catalog.js';
import { parseInput } from '../domain/policy.js';
import type { Input, Release } from '../domain/types.js';

const escape = (x: unknown) =>
  String(x).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const rupees = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n / 100);
export function createPortal(getRelease: () => Release, origin: string, basePath = '') {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    next();
  });
  app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.status(405).json({ error: 'read_only_portal' });
      return;
    }
    next();
  });
  function makeQuote(input: Input) {
    const p = products.find((p) => p.sku === input.sku)!;
    const release = getRelease();
    const common = {
      outcome: p.available ? 'quote' : 'unavailable',
      ...input,
      currency: 'INR',
      site_release: release,
      quote_id: `${release}-${input.sku}-${input.quantity}`,
    };
    if (!p.available) return { ...common, reason_code: 'not_quoted' };
    // Independently implemented supplier arithmetic (not imported from validator).
    const line = BigInt(p.unit) * BigInt(input.quantity);
    const tax = Number(
      (line * BigInt(p.numerator) + BigInt(p.denominator / 2)) / BigInt(p.denominator),
    );
    if (release === 'r1')
      return {
        ...common,
        displayed_price_paise: p.inclusive,
        basis_label_text: `incl. ${p.numerator}% demo tax`,
        delivery_fee_paise: p.delivery,
        reported_total_paise: p.inclusive * input.quantity + p.delivery,
      };
    return {
      ...common,
      displayed_price_paise: p.unit,
      basis_label_text: 'before tax',
      price_basis: 'exclusive_of_demo_tax',
      unit_price_ex_tax_paise: p.unit,
      demo_tax_rate_numerator: p.numerator,
      demo_tax_rate_denominator: p.denominator,
      tax_amount_paise: tax,
      delivery_fee_paise: p.delivery,
      reported_total_paise: p.unit * input.quantity + tax + p.delivery,
    };
  }
  app.get('/health', (_req, res) =>
    res.json({ service: 'supplier-portal', release: getRelease(), mode: 'read_only' }),
  );
  app.get('/quote-data', (req, res) => {
    try {
      const input = parseInput({ sku: req.query.sku, quantity: Number(req.query.quantity) });
      res.json(makeQuote(input));
    } catch {
      res.status(400).json({ error: 'invalid_input' });
    }
  });
  app.get(['/', '/catalog', '/quotes'], (req, res) => {
    const release = getRelease();
    const sku = String(req.query.sku ?? 'MOTOR-01'),
      quantity = Number(req.query.quantity ?? 1);
    let input: Input;
    try {
      input = parseInput({ sku, quantity });
    } catch {
      res.status(400).send('Invalid catalog input');
      return;
    }
    const p = products.find((p) => p.sku === input.sku)!;
    const q = makeQuote(input);
    const params = new URLSearchParams({ sku, quantity: String(quantity) });
    // This is the real DOM data read by the local HTTP replay adapter.
    // r2 intentionally omits tax and total; the approved JSON view supplies them.
    const visible =
      release === 'r1' || q.outcome === 'unavailable'
        ? q
        : {
            outcome: q.outcome,
            sku,
            quantity,
            currency: 'INR',
            site_release: release,
            quote_id: q.quote_id,
            displayed_price_paise: p.unit,
            basis_label_text: 'before tax',
            delivery_fee_paise: p.delivery,
          };
    res
      .type('html')
      .send(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Northstar Supply · Quote desk</title><style>body{margin:0;background:#f5f4ef;color:#222a28;font:16px system-ui}header,main{max-width:1000px;margin:auto;padding:28px}header{display:flex;justify-content:space-between;border-bottom:1px solid #dcded7}main{padding-top:65px}.eyebrow{font:12px monospace;letter-spacing:2px;color:#62756c}h1{font-size:46px;letter-spacing:-2px}form{display:flex;gap:16px;flex-wrap:wrap;padding:24px;background:white;border:1px solid #dedfd9;border-radius:12px}label{display:grid;gap:9px}input,select,button{font:inherit;padding:12px;border:1px solid #ced4ca;border-radius:6px}button{background:#244d3b;color:white;cursor:pointer}.card{margin-top:28px;padding:28px;background:white;border:1px solid #dedfd9;border-radius:12px}.price{font-size:46px;margin:16px 0}.muted{color:#69766e}a{color:#244d3b}footer{max-width:1000px;margin:60px auto;padding:28px;color:#69766e;font-size:13px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px monospace;background:#f4f6f2;padding:18px}</style></head><body><header><strong>↗ NORTHSTAR SUPPLY</strong><span>TEAM-OWNED FIXTURE · ${release.toUpperCase()}</span></header><main><p class="eyebrow">COMPONENTS / QUOTATION DESK</p><h1>Parts for your next idea.</h1><p class="muted">Synthetic prices. Read-only quotation. No checkout or account system.</p><form method="get" action="${basePath}${release === 'r1' ? '/catalog' : '/quotes'}"><label>Component<select name="sku">${products.map((item) => `<option ${item.sku === sku ? 'selected' : ''} value="${item.sku}">${escape(item.name)} · ${item.sku}</option>`).join('')}</select></label><label>Quantity<input type="number" min="1" max="1000" name="quantity" value="${quantity}"></label><button>Read quotation</button></form><section class="card"><span class="eyebrow">${escape(p.category)} / ${sku}</span><h2>${escape(p.name)}</h2>${p.available ? `<div class="price">${rupees(release === 'r1' ? p.inclusive : p.unit)}</div><p>${release === 'r1' ? `incl. ${p.numerator}% demo tax` : 'before tax'} · per unit</p><p>Delivery: ${rupees(p.delivery)}</p>${release === 'r1' ? `<p>Final total: ${rupees(Number('reported_total_paise' in q ? q.reported_total_paise : 0))}</p>` : `<p>Full quote data is available in the <a href="${basePath}/quote-data?${params}">read-only JSON quote view</a>.</p>`}` : '<h2>Currently unavailable</h2><p>No current quotation exists for this catalog item.</p>'}<p class="muted">Release ${release} · Quote ${escape(q.quote_id)}</p></section><pre id="quote-observation" data-format="json">${escape(JSON.stringify(visible))}</pre></main><footer>This portal provides synthetic fixtures for GhostAPI. Tax rates are demonstration values.</footer></body></html>`,
      );
  });
  app.use((_req, res) => res.status(404).json({ error: 'unapproved_route' }));
  return app;
}
