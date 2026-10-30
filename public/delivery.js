import { cities } from './delivery-cities.js';
import { initDeliveryWorkflows, workflowDraftButton } from './delivery-workflows.js';
import { monitorButton } from './monitors.js';
import { deliveryViewer } from './delivery-viewer.js';
const section = document.createElement('section');
section.className = 'panel research-intake';
section.innerHTML = `<h2>Check delivery to your PIN</h2><p>Amazon India product pages · experimental support. Results are agent-reported observations.</p><form id="delivery-form" class="website-form"><label for="delivery-url">Product URL</label><input id="delivery-url" type="url" required placeholder="https://www.amazon.in/dp/…"><label for="delivery-pin">Delivery PIN</label><input id="delivery-pin" inputmode="numeric" pattern="[1-9][0-9]{5}" maxlength="6" required><label for="delivery-variant">Variant (optional)</label><input id="delivery-variant" maxlength="200" placeholder="For example, 16 GB RAM / 512 GB SSD"><button class="button primary">Check delivery</button><p id="delivery-message" role="status"></p></form><div id="delivery-results" aria-live="polite"></div>`;
document.querySelector('#research-tab .research-layout').before(section);
section.style.marginBottom = '28px';
const coverage = document.createElement('p');
coverage.className = 'muted';
coverage.textContent = `Automatically checks your PIN plus ${Object.keys(cities).length} unique city PINs from your list (up to 60 provider runs). Two checks run at a time; results may take several minutes. Daily limit: 120 delivery runs. Each PIN represents one delivery area.`;
document.getElementById('delivery-variant').after(coverage);
const results = document.getElementById('delivery-results');
const message = document.getElementById('delivery-message');
const viewerHost = document.createElement('div');
results.before(viewerHost);
const updateViewer = deliveryViewer(viewerHost);
initDeliveryWorkflows(section);
function node(tag, text) {
  const el = document.createElement(tag);
  el.textContent = text;
  return el;
}
async function post(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-GhostAPI-Client': 'dashboard' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
document.getElementById('delivery-form').onsubmit = async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    message.textContent = 'Starting delivery check…';
    const pins = [
      ...new Set([document.getElementById('delivery-pin').value.trim(), ...Object.keys(cities)]),
    ];
    if (pins.some((pin) => !/^[1-9]\d{5}$/.test(pin)))
      throw new Error('Enter a valid six-digit PIN.');
    await post(pins.length > 1 ? '/api/delivery-matrices' : '/api/check-delivery', {
      url: document.getElementById('delivery-url').value,
      ...(pins.length > 1 ? { pincodes: pins } : { pincode: pins[0] }),
      ...(document.getElementById('delivery-variant').value.trim()
        ? { variant: document.getElementById('delivery-variant').value.trim() }
        : {}),
    });
    message.textContent = 'Check started. Progress appears below.';
    await refresh();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
let signature;
async function refresh() {
  section.hidden = location.pathname === '/internships';
  if (document.hidden || document.getElementById('research-tab').hidden) return;
  try {
    const response = await fetch('/api/delivery-jobs');
    if (!response.ok) return;
    const data = await response.json();
    updateViewer(data.jobs);
    const next = JSON.stringify(data);
    if (signature === next) return;
    signature = next;
    results.replaceChildren();
    const displayedMatrices = [
      ...new Set(data.jobs.filter((job) => job.matrix_id).map((job) => job.matrix_id)),
    ].slice(0, 5);
    for (const matrixId of displayedMatrices) {
      const group = data.jobs.filter((job) => job.matrix_id === matrixId);
      const panel = node('section', '');
      panel.className = 'panel research-request';
      panel.style.minWidth = '0';
      panel.append(node('h3', 'PIN availability comparison'), node('p', group[0].input.url));
      const pending = group.some((job) => ['running', 'queued'].includes(job.status));
      const confirmed = group.filter(
        (job) => job.status === 'completed' && job.result?.verdict === 'DELIVERABLE',
      ).length;
      const rejected = group.filter(
        (job) => job.status === 'completed' && job.result?.verdict === 'NOT_DELIVERABLE',
      ).length;
      const variants = new Set(
        group
          .map((job) => job.result?.observation.observed_variant?.trim().toLowerCase())
          .filter(Boolean),
      );
      const positive =
        !pending && confirmed === group.length && group.length >= 2 && variants.size === 1;
      const negative =
        !pending && rejected === group.length && group.length >= 2 && variants.size === 1;
      const verdict = node('div', '');
      verdict.className = `delivery-verdict ${positive ? 'positive' : negative ? 'negative' : 'uncertain'}`;
      const symbol = node('span', positive ? '✓' : negative ? '✕' : '…');
      symbol.className = 'delivery-verdict-symbol';
      symbol.setAttribute('aria-hidden', 'true');
      verdict.append(
        symbol,
        node(
          'h3',
          pending
            ? 'Checking delivery across cities'
            : positive
              ? 'Delivery confirmed across selected cities'
              : negative
                ? 'Delivery unavailable across selected cities'
                : 'Mixed or inconclusive delivery evidence',
        ),
        node(
          'p',
          `${confirmed}/${group.length} delivery checks confirmed. Delivery availability does not establish product authenticity or seller legitimacy.`,
        ),
      );
      panel.append(verdict);
      const scroll = node('div', '');
      scroll.style.overflowX = 'auto';
      scroll.style.maxWidth = '100%';
      const table = node('table', '');
      table.style.width = '100%';
      table.style.minWidth = '680px';
      table.append(
        node(
          'caption',
          'Each row is a separate observation. Compare the observed variant before comparing availability.',
        ),
      );
      const head = node('tr', '');
      for (const title of [
        'PIN',
        'Result / status',
        'Observed variant',
        'Checked',
        'Evidence / live view',
      ])
        head.append(node('th', title));
      table.append(head);
      for (const job of group) {
        const row = node('tr', '');
        for (const value of [
          `${cities[job.input.pincode] ? cities[job.input.pincode] + ' · ' : ''}${job.input.pincode}`,
          job.result?.verdict ?? job.status,
          job.result?.observation.observed_variant ?? 'Unconfirmed',
          job.result?.checked_at ? new Date(job.result.checked_at).toLocaleString() : 'Pending',
        ])
          row.append(node('td', value));
        const actions = node('td', '');
        const evidence = node('a', 'View evidence');
        evidence.href = `#delivery-job-${job.id}`;
        evidence.onclick = (event) => {
          event.preventDefault();
          document.getElementById(`delivery-job-${job.id}`)?.scrollIntoView({ behavior: 'smooth' });
        };
        actions.append(evidence);
        if (job.live_url) {
          const live = node('button', 'Watch here');
          live.type = 'button';
          live.className = 'button secondary';
          live.onclick = () => updateViewer.select(job.id);
          actions.append(live);
        }
        row.append(actions);
        table.append(row);
      }
      scroll.append(table);
      panel.append(scroll);
      results.append(panel);
    }
    for (const job of data.jobs.filter(
      (job, index) => index < 10 || displayedMatrices.includes(job.matrix_id),
    )) {
      const card = node('article', '');
      card.className = 'research-request panel';
      card.id = `delivery-job-${job.id}`;
      card.append(
        node('h3', `PIN ${job.input.pincode} · ${job.status}`),
        node('p', job.input.url),
        node('p', new Date(job.started_at).toLocaleString()),
      );
      if (job.live_url) {
        const link = node('button', 'Watch in this page');
        link.type = 'button';
        link.className = 'button secondary';
        link.onclick = () => updateViewer.select(job.id);
        card.append(
          link,
          node('p', 'Temporary provider view. Opening it does not change this check.'),
        );
      } else if (job.status === 'running')
        card.append(
          node('p', 'Waiting for live-view availability. Actual progress appears below.'),
        );
      if (job.run_id) card.append(node('p', `TinyFish run: ${job.run_id}`));
      const progress = node('details', '');
      progress.append(node('summary', 'Execution progress'));
      for (const text of job.progress) progress.append(node('p', text));
      card.append(progress);
      if (job.result) {
        if (job.status === 'completed' && job.result.verdict !== 'UNKNOWN')
          card.append(workflowDraftButton(job));
        if (job.status === 'completed' && job.result.verdict !== 'UNKNOWN' && job.contract)
          card.append(
            monitorButton({
              kind: 'delivery',
              workflow_id: job.contract.id,
              pincode: job.input.pincode,
              ...(job.input.variant ? { variant: job.input.variant } : {}),
            }),
          );
        if (job.contract)
          card.append(
            node('p', `Published API version ${job.contract.version} · ${job.contract.id}`),
          );
        if (job.result.reason) card.append(node('p', job.result.reason));
        if (job.result.workflow_version)
          card.append(node('p', `Workflow: ${job.result.workflow_version}`));
        card.append(
          node('strong', job.result.verdict),
          node(
            'p',
            `Observed PIN: ${job.result.observation.observed_pin ?? 'Unconfirmed'} · Variant: ${job.result.observation.observed_variant ?? 'Unconfirmed'}`,
          ),
          node('blockquote', job.result.observation.excerpt ?? 'No delivery evidence returned.'),
          node('p', `Checked: ${job.result.checked_at}`),
        );
        if (job.result.contradiction === true)
          card.append(
            node(
              'p',
              'Listing stock and delivery availability conflict. This is not proof of fraud.',
            ),
          );
      }
      if (job.error) card.append(node('p', job.error));
      if (job.status === 'running' || job.status === 'queued') {
        const cancel = node('button', 'Cancel');
        cancel.className = 'button secondary';
        cancel.onclick = async () => {
          try {
            await post(`/api/delivery-jobs/${job.id}/cancel`, {});
            await refresh();
          } catch (error) {
            message.textContent = error.message;
          }
        };
        card.append(cancel);
      }
      results.append(card);
    }
  } catch {
    message.textContent = 'Unable to refresh delivery checks.';
  }
}
setInterval(() => void refresh(), 2500);
void refresh();
