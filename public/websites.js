const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const when = (value) => (value ? new Date(value).toLocaleString() : 'Not checked yet');
const rule = (field) =>
  field.extractor.kind === 'css'
    ? `${field.extractor.selector}${field.extractor.attribute ? ` → ${field.extractor.attribute}` : ' → text'}`
    : `${field.extractor.kind} → ${field.extractor.property ?? field.extractor.key}`;
let current = [],
  lastRendered = '',
  refresh;
const selections = new Map(),
  intervals = new Map();
async function command(body) {
  const response = await fetch('/api/websites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-GhostAPI-Client': 'dashboard' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Website operation failed.');
  await refresh();
  return result;
}
function selected(site) {
  const key = `${site.id}:${site.inspection?.sha256}`;
  if (!selections.has(key))
    selections.set(
      key,
      new Set(
        (site.inspection?.fields ?? []).filter((f) => f.key !== 'description').map((f) => f.key),
      ),
    );
  return selections.get(key);
}
export function renderWebsites(sites, monitoring) {
  current = sites;
  if ($('website-count')) $('website-count').textContent = sites.length;
  $('website-total').textContent = `${sites.length} / 10 websites`;
  $('website-scheduler-note').textContent =
    `${monitoring?.scheduler ?? 'Checks run while the server is awake.'} ${monitoring?.storage ?? ''} Use “Check now” for an immediate check.`;
  const signature = JSON.stringify(sites);
  if (signature === lastRendered) return;
  lastRendered = signature;
  const stats = [
    ['WEBSITES', sites.length],
    ['MONITORING', sites.filter((s) => s.monitoring).length],
    ['NEEDS ATTENTION', sites.filter((s) => ['broken', 'error'].includes(s.status)).length],
    ['VALUE CHANGES', sites.filter((s) => s.status === 'changed').length],
  ];
  $('website-summary').innerHTML = stats
    .map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`)
    .join('');
  const opened = new Set(
    [...$('website-list').querySelectorAll('details[open]')].map((el) => el.id),
  );
  $('website-list').innerHTML = sites.length
    ? sites
        .map((site) => {
          const busy = site.phase !== 'idle',
            status = busy ? site.phase : site.status;
          const candidates = site.inspection?.fields ?? [];
          const review =
            !site.contract && candidates.length
              ? `<form data-contract-form="${site.id}" class="contract-review"><h3>Review the extraction contract</h3><p class="muted">Select the fields that must remain extractable. These values come from the website.</p>${candidates.map((field) => `<label class="candidate-field"><input type="checkbox" value="${esc(field.key)}" ${selected(site).has(field.key) ? 'checked' : ''} /><span><strong>${esc(field.label)}</strong><code>${esc(rule(field))}</code><small>${esc(field.sample)}</small></span></label>`).join('')}<label class="field-label">Check interval<select name="interval" aria-label="Check interval">${[
                  [15, 'Every 15 minutes'],
                  [60, 'Every hour'],
                  [360, 'Every 6 hours'],
                  [1440, 'Daily'],
                ]
                  .map(
                    ([minutes, label]) =>
                      `<option value="${minutes}" ${(intervals.get(site.id) ?? 60) === minutes ? 'selected' : ''}>${label}</option>`,
                  )
                  .join(
                    '',
                  )}</select></label><button class="button primary" ${busy ? 'disabled' : ''}>Approve contract & monitor</button></form>`
              : '';
          const data = site.result
            ? `<div class="website-values"><div class="website-data-label">${['broken', 'error'].includes(site.status) ? 'LAST SUCCESSFUL DATA · CURRENT RESULT WITHHELD' : 'LATEST EXTRACTED DATA'} · ${esc(when(site.result.at))}</div>${Object.entries(
                site.result.data,
              )
                .map(
                  ([key, value]) =>
                    `<div><span>${esc(key)}</span><strong>${esc(value)}</strong></div>`,
                )
                .join('')}</div>`
            : '';
          const repair = site.repair
            ? `<div class="repair-review"><h3>Repair proposal ready</h3><p>Review the replacement rules. Applying this proposal fetches the page again and requires every approved field to pass.</p>${site.repair.changed.map((key) => `<div><strong>${esc(key)}</strong><code>Before: ${esc(rule(site.contract.fields.find((f) => f.key === key)))}</code><code>Proposed: ${esc(rule(site.repair.fields.find((f) => f.key === key)))}</code><span>Observed now: ${esc(site.repair.fields.find((f) => f.key === key)?.sample)}</span></div>`).join('')}<button class="button primary" data-site-action="repair" data-site-id="${site.id}" ${busy ? 'disabled' : ''}>Verify & apply repair</button></div>`
            : '';
          const history = site.history
            .map(
              (entry) =>
                `<li><div><strong>${esc(entry.status)}</strong><time>${esc(when(entry.at))}</time></div><p>${esc(entry.detail)}</p>${(entry.changes ?? []).map((c) => `<p class="change-line">${esc(c.field)}: <del>${esc(c.before)}</del> → <ins>${esc(c.after)}</ins></p>`).join('')}</li>`,
            )
            .join('');
          return `<article class="website-card" data-website="${site.id}"><button class="button secondary" data-visual-site="${site.id}">Open visual builder ↗</button><div class="website-card-heading"><div><h3>${esc(site.name)}</h3><a href="${esc(site.url)}" target="_blank" rel="noreferrer">${esc(site.url)} ↗</a></div><span class="website-status status-${status}">${esc(status)}</span></div>${site.task ? `<p class="website-task">${esc(site.task)}</p>` : ''}${site.error ? `<p class="website-error" role="status">${esc(site.error)}</p>` : ''}${busy ? `<p class="website-progress" role="status">${site.phase === 'inspecting' ? 'Reading the public response and discovering extraction fields…' : 'Fetching fresh source data and checking the approved contract…'}</p>` : ''}${site.discovery ? `<details><summary>Site report · ${site.discovery.pages.length} pages · TinyFish</summary>${site.discovery.pages.map((page) => `<section class="website-evidence"><h3>${esc(page.title)}</h3><a href="${esc(page.url)}" target="_blank" rel="noreferrer">${esc(page.url)}</a><pre class="discovery-content">${esc(page.content)}</pre><button class="button secondary" data-analyze-url="${esc(page.url)}">Analyze this page</button></section>`).join('')}${site.discovery.limitations.map((text) => `<p class="muted">${esc(text)}</p>`).join('')}</details>` : ''}${site.discovery_error ? `<p class="muted">${esc(site.discovery_error)}</p>` : ''}${review}${data}${repair}${site.contract ? `<div class="website-actions"><button class="button secondary" data-site-action="check" data-site-id="${site.id}" ${busy ? 'disabled' : ''}>Check now</button><button class="text-button" data-site-action="${site.monitoring ? 'pause' : 'resume'}" data-site-id="${site.id}" ${busy ? 'disabled' : ''}>${site.monitoring ? 'Pause' : 'Resume'}</button><a class="text-button" href="/api/websites/${site.id}/data" target="_blank" rel="noreferrer">Open JSON API ↗</a></div><p class="website-check-meta">Contract v${site.contract.version} · ${site.monitoring ? `Every ${site.interval_minutes} minutes while awake` : 'Monitoring paused'}${site.next_check ? ` · Next due ${esc(when(site.next_check))}` : ''}</p>` : ''}<details id="inspection-${site.id}" ${opened.has(`inspection-${site.id}`) ? 'open' : ''}><summary>Inspection evidence & contract</summary><div class="website-evidence">${site.inspection ? `<p>Response captured ${esc(when(site.inspection.at))}</p><p class="mono">SHA-256: ${esc(site.inspection.sha256)}</p>${(site.contract?.fields ?? candidates).map((field) => `<p><strong>${esc(field.label)}</strong> <code>${esc(rule(field))}</code></p>`).join('')}${site.inspection.links.length ? `<p>Discovered data links (not automatically followed):</p>${site.inspection.links.map((link) => `<p><a target="_blank" rel="noreferrer" href="${esc(link)}">${esc(link)}</a></p>`).join('')}` : ''}${site.inspection.notes.map((note) => `<p>${esc(note)}</p>`).join('')}` : '<p>Inspection evidence will appear here.</p>'}</div></details><details id="history-${site.id}" ${opened.has(`history-${site.id}`) ? 'open' : ''}><summary>Check history · ${site.history.length} events</summary><ol class="website-history">${history}</ol></details><div class="website-actions"><button class="text-button" data-site-action="archive" data-site-id="${site.id}" ${busy ? 'disabled' : ''}>Archive website</button></div><p class="website-operation-error" id="website-error-${site.id}" role="alert"></p></article>`;
        })
        .join('')
    : `<div class="website-empty"><span>◎</span><h2>Start with one website.</h2><p>Paste a public detail-page URL. GhostAPI will discover fields, show their sources, and help you create your first extraction contract.</p><div><span>01 Inspect</span><span>02 Approve</span><span>03 Monitor</span><span>04 Repair</span></div></div>`;
}
export function initWebsites(refreshFn) {
  refresh = refreshFn;
  $('website-form').onsubmit = async (event) => {
    event.preventDefault();
    $('inspect-website').disabled = true;
    $('website-form-message').textContent = 'Starting inspection…';
    try {
      await command({
        action: 'inspect',
        url: $('website-url').value,
        name: $('website-name')?.value ?? '',
        task: $('website-task')?.value ?? '',
      });
      $('website-form-message').textContent = 'Inspection queued. Review its results on the right.';
    } catch (error) {
      $('website-form-message').textContent = error.message;
    } finally {
      $('inspect-website').disabled = false;
    }
  };
  $('website-list').addEventListener('change', (event) => {
    const form = event.target.closest('[data-contract-form]');
    if (!form) return;
    const site = current.find((s) => s.id === form.dataset.contractForm);
    if (!site) return;
    selections.set(
      `${site.id}:${site.inspection.sha256}`,
      new Set([...form.querySelectorAll('input:checked')].map((input) => input.value)),
    );
    intervals.set(site.id, Number(form.querySelector('select').value));
  });
  $('website-list').addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-contract-form]');
    if (!form) return;
    event.preventDefault();
    const site = current.find((s) => s.id === form.dataset.contractForm);
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      await command({
        action: 'approve',
        id: site.id,
        fields: [...selected(site)],
        interval_minutes: Number(form.querySelector('select').value),
        inspection_hash: site.inspection.sha256,
      });
    } catch (error) {
      $(`website-error-${site.id}`).textContent = error.message;
      button.disabled = false;
    }
  });
  $('website-list').addEventListener('click', async (event) => {
    const analyze = event.target.closest('[data-analyze-url]');
    if (analyze) {
      $('website-url').value = analyze.dataset.analyzeUrl;
      $('website-form').requestSubmit();
      return;
    }
    const button = event.target.closest('[data-site-action]');
    if (!button) return;
    const site = current.find((s) => s.id === button.dataset.siteId);
    button.disabled = true;
    try {
      await command({
        action: button.dataset.siteAction,
        id: site.id,
        version: site.repair?.based_on,
      });
    } catch (error) {
      $(`website-error-${site.id}`).textContent = error.message;
      button.disabled = false;
    }
  });
}
