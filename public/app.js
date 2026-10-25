const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const money = (paise) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(paise / 100);
const stamp = (date) =>
  new Date(date).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
let snapshot,
  pending = false,
  toastTimer;

function toast(message, error = false) {
  const node = $('toast');
  node.textContent = message;
  node.className = `toast${error ? ' error' : ''}`;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.hidden = true), error ? 9000 : 4500);
}
async function refresh() {
  try {
    const response = await fetch('/api/state');
    if (!response.ok) throw new Error('Dashboard disconnected');
    snapshot = await response.json();
    render();
  } catch (error) {
    $('integration-status').textContent =
      'Dashboard connection unavailable. Refresh when the server is back.';
  }
}
async function action(path, body = {}, message = 'Operation completed') {
  if (pending) return;
  pending = true;
  render();
  try {
    const response = await fetch(`/api/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-GhostAPI-Client': 'dashboard' },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Operation failed');
    toast(message);
    return result.result;
  } catch (error) {
    toast(error.message, true);
  } finally {
    pending = false;
    await refresh();
  }
}
function showDetails(title, value) {
  $('detail-title').textContent = title;
  $('detail-content').textContent = JSON.stringify(value, null, 2);
  $('detail-dialog').showModal();
}
function render() {
  if (!snapshot) return;
  const { state: s, capabilities } = snapshot,
    busy = pending || snapshot.busy;
  const latest = s.candidates.at(-1);
  const valid = s.runs.filter((r) => r.result && r.checks.every((c) => c.pass)).length;
  const healthColor =
    s.health === 'Healthy'
      ? 'green'
      : ['NotEnrolled', 'Inspecting'].includes(s.health)
        ? 'gray'
        : s.health === 'Blocked'
          ? 'red'
          : 'orange';
  $('health-value').textContent = s.health === 'NotEnrolled' ? 'Not enrolled' : s.health;
  $('health-value').style.color =
    s.health === 'Healthy'
      ? 'var(--green)'
      : s.health === 'NotEnrolled'
        ? 'var(--text)'
        : 'var(--orange)';
  $('health-caption').textContent =
    s.health === 'Healthy'
      ? 'Current-release result validated'
      : s.health === 'NotEnrolled'
        ? 'Ready for a baseline'
        : 'Verified publication withheld';
  $('version-value').innerHTML = `wf${s.active_version} <span>/ ${esc(s.release)}</span>`;
  $('checks-value').innerHTML = `${valid} <span>/ ${s.runs.length}</span>`;
  $('cost-value').textContent = `$${(s.cycle?.reserved_usd ?? 0).toFixed(2)}`;
  $('cost-caption').textContent = s.cycle
    ? `Reserved / $${s.cycle.limit_usd.toFixed(2)} cycle cap`
    : 'Local HTTP replay is unmetered';
  $('workflow-status').innerHTML =
    `<span class="dot ${healthColor}"></span> ${esc(s.health === 'NotEnrolled' ? 'Not enrolled' : s.health)}`;
  $('portal-link').href = `${snapshot.portal_origin}/${s.release === 'r1' ? 'catalog' : 'quotes'}`;
  $('cycle-status').textContent = s.cycle
    ? `${s.cycle.runs} / 15 local runs · ${Math.max(0, Math.ceil((s.cycle.deadline - Date.now()) / 1000))}s remaining`
    : 'No active evidence cycle';
  document.querySelectorAll('[data-release]').forEach((button) => {
    button.classList.toggle('active', button.dataset.release === s.release);
    button.disabled = busy;
  });
  const stages = {
    baseline: s.runs.some((r) => r.workflow_version === 1 && r.release === 'r1' && r.result),
    detect: s.runs.some((r) => r.release === 'r2' && !r.result),
    inspect: s.evidence.some((e) => e.release === s.release),
    repair: Boolean(latest),
    verify:
      latest?.state === 'Promoted' &&
      latest.workflow.workflow_version === s.active_version &&
      s.health === 'Healthy',
  };
  document
    .querySelectorAll('[data-stage]')
    .forEach((el) => el.classList.toggle('done', Boolean(stages[el.dataset.stage])));
  const timeline = $('timeline');
  $('event-count').textContent = s.events.length;
  if (s.events.length)
    timeline.innerHTML = s.events
      .toReversed()
      .map(
        (e) =>
          `<article class="event ${esc(e.kind)}"><div class="event-icon">${{ info: '◇', success: '✓', warning: '!', error: '×' }[e.kind]}</div><div><h3 class="event-title">${esc(e.title)}</h3><p class="event-detail">${esc(e.detail)}</p>${e.ref ? `<button class="event-reference" data-ref="${esc(e.ref)}">↳ ${esc(e.ref.slice(0, 28))}</button>` : ''}</div><time class="event-time">${stamp(e.at)}</time></article>`,
      )
      .join('');
  else
    timeline.innerHTML =
      '<div class="empty-state"><div class="empty-icon">⌁</div><h3>Your workflow story starts here.</h3><p>Run the local demo to watch a quote contract break,<br>get diagnosed, and recover through verified replay.</p><span class="empty-hint">One portal. One deliberate change. Full provenance.</span></div>';
  const diff = $('repair-diff');
  if (latest) {
    $('planner-label').textContent =
      `${latest.planner.toUpperCase()} · ${latest.state.toUpperCase()}`;
    const previous = s.workflows.find((w) => w.workflow_version === latest.patch.from_version);
    const lines = [
      [
        'context',
        `  wf${latest.patch.from_version} → wf${latest.workflow.workflow_version}  ·  configuration only`,
      ],
      ['remove', `− start_path: ${previous?.start_path}`],
      ['add', `+ start_path: ${latest.patch.changes.start_path}`],
      ['remove', `− schema: ${previous?.observed_schema_id}`],
      ['add', `+ schema: ${latest.patch.changes.observed_schema_id}`],
      ['add', '+ fields: price_basis, ex_tax_price, rate, tax'],
      ['add', '+ clauses: approved JSON view, basis, tax components'],
      ['context', '  mandatory_validation_policy: QUOTE_SAFETY_V1 (unchanged)'],
    ];
    diff.className = 'diff-body';
    diff.innerHTML = lines
      .map(([kind, line]) => `<div class="diff-line ${kind}">${esc(line)}</div>`)
      .join('');
  } else {
    $('planner-label').textContent = 'NO CANDIDATE';
    diff.className = 'diff-empty';
    diff.textContent = 'Configuration changes will appear here after inspection.';
  }
  if (s.published && s.health === 'Healthy') {
    const q = s.published;
    $('quote-badge').textContent = q.outcome === 'quote' ? 'VERIFIED' : 'UNAVAILABLE';
    $('quote-badge').className = 'pill success';
    $('quote-result').innerHTML =
      q.outcome === 'unavailable'
        ? `<div class="quote-sku">${esc(q.sku)} · QTY ${q.quantity}</div><h2>No current quote</h2><p class="muted">Explicitly unavailable. No price or tax invented.</p>`
        : `<div class="quote-sku">${esc(q.sku)} <span> / QTY ${q.quantity}</span></div><div class="quote-price">${money(q.verified_total_paise)}</div><div class="quote-caption">Verified final total · ${esc(q.currency)}</div><div class="quote-breakdown"><span>Observed unit price</span><span>${money(q.displayed_price_paise)}</span></div>${q.tax_amount_paise !== undefined ? `<div class="quote-breakdown"><span>Demo tax</span><span>${money(q.tax_amount_paise)}</span></div>` : ''}<div class="quote-breakdown"><span>Delivery</span><span>${money(q.delivery_fee_paise)}</span></div><div class="quote-breakdown total"><span>Exact-match check</span><span>✓ zero tolerance</span></div><div class="quote-provenance">wf${q.workflow_version} / ${esc(q.site_release)} · LOCAL HTTP<br>${esc(q.quote_id)}<br>Verified ${stamp(q.verification_time)}</div>`;
  } else {
    $('quote-badge').textContent = s.runs.length ? 'WITHHELD' : 'AWAITING RUN';
    $('quote-badge').className = `pill ${s.runs.length ? 'warning' : 'subdued'}`;
    $('quote-result').innerHTML =
      '<div class="quote-placeholder">₹<span>—</span></div><p class="muted">A result is published only after its applicable checks pass.</p>';
  }
  $('runs-list').innerHTML = s.runs.length
    ? `<table class="table"><thead><tr><th>RUN / MODE</th><th>INPUT</th><th>VERSION</th><th>STATUS</th><th>VALIDATION</th><th></th></tr></thead><tbody>${s.runs
        .toReversed()
        .map(
          (r) =>
            `<tr><td class="mono">${esc(r.id.slice(0, 17))}<br><span class="muted">local-http</span></td><td>${esc(r.input.sku)} × ${r.input.quantity}</td><td>wf${r.workflow_version} / ${esc(r.release)}</td><td>${esc(r.status)}</td><td><span class="pill ${r.result ? 'success' : 'warning'}">${r.result ? 'VALIDATED' : 'WITHHELD'}</span></td><td><button class="button secondary" data-run="${esc(r.id)}">Details ↗</button></td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<div class="diff-empty">No execution attempts yet.</div>';
  $('evidence-list').innerHTML = s.evidence.length
    ? `<div class="card-list">${s.evidence
        .toReversed()
        .map(
          (e) =>
            `<article class="evidence-card"><h3>${e.kind === 'rea-har' ? 'REA · supplied capture inspection' : e.kind === 'operator-har' ? 'Operator HAR · local parsing' : 'Local HTTP · response capture'} <span class="pill subdued">${esc(e.release)}</span></h3><p>${esc(e.id)}<br>SHA-256 ${esc(e.sha256)}<br>${esc(e.input.sku)} × ${e.input.quantity} · ${esc(e.origin)}</p><div class="evidence-fields">${e.fields.map((f) => `<code>${esc(f)}</code>`).join('')}</div><p>${e.limitations.map(esc).join('<br>')}</p><button class="button secondary" data-evidence="${esc(e.id)}">Provenance ↗</button></article>`,
        )
        .join('')}</div>`
    : '<div class="diff-empty">Inspect a live local quote or import a fresh same-origin HAR to collect evidence.</div>';
  $('versions-list').innerHTML = `<div class="card-list">${s.workflows
    .toReversed()
    .map((w) => {
      const candidate = s.candidates.find(
        (c) => c.workflow.workflow_version === w.workflow_version,
      );
      return `<article class="evidence-card version-card"><div><h3>wf${w.workflow_version} ${w.workflow_version === s.active_version ? '<span class="pill success">ACTIVE POINTER</span>' : ''}</h3><p>${esc(candidate ? `${candidate.planner} · ${candidate.state}` : 'Saved baseline')}<br>Immutable policy: ${esc(w.mandatory_validation_policy_id)}</p><pre>${esc(JSON.stringify({ start_path: w.start_path, observed_schema_id: w.observed_schema_id, goal_clause_ids: w.goal_clause_ids }, null, 2))}</pre></div><button class="button secondary" data-version="${w.workflow_version}">Full configuration ↗</button></article>`;
    })
    .join('')}</div>`;
  document.querySelectorAll('button.button').forEach((el) => (el.disabled = busy));
  $('baseline-button').disabled = busy || s.release !== 'r1';
  $('inspect-button').disabled = busy || !s.cycle || s.cycle.status !== 'active';
  $('propose-button').disabled = busy || !s.evidence.some((e) => e.release === s.release);
  $('verify-button').disabled = busy || latest?.state !== 'Draft';
  $('promote-button').disabled =
    busy ||
    latest?.state !== 'Verifying' ||
    latest.tests.length !== 3 ||
    !latest.tests.every((r) => r.result);
  $('rollback-button').disabled = busy || s.activation_history.length < 2;
  $('run-demo').innerHTML = busy ? '<span>◌</span> Working…' : '<span>▶</span> Run local demo';
  $('use-llm').disabled = busy || !capabilities.planner.configured;
  $('use-llm').title = capabilities.planner.configured
    ? 'Configured LLM planner; calls reserve configured cost bound'
    : 'Configure OPENAI_API_KEY, OPENAI_MODEL and PLANNER_MAX_COST_USD server-side';
  const actualRea = s.evidence.some((e) => e.kind === 'rea-har');
  $('integration-status').textContent =
    `TinyFish remote: blocked pending pre-action enforcement${capabilities.tinyfish.configured ? ' (key configured)' : ''}. REA: ${actualRea ? 'supplied HAR inspection succeeded' : 'no successful inspection yet'}. LLM: ${capabilities.planner.configured ? 'configured' : 'not configured; rules fallback'}. Ablation: not run.`;
}

$('run-demo').onclick = () =>
  action(
    'demo',
    { use_llm: $('use-llm').checked },
    'Local demo completed. Inspect the timeline for actual gate results.',
  );
$('baseline-button').onclick = () => action('baseline', {}, 'Baseline replay recorded.');
$('quote-button').onclick = () =>
  action(
    'quote',
    { sku: $('sku').value, quantity: Number($('quantity').value) },
    'Quotation replay recorded.',
  );
$('inspect-button').onclick = () =>
  action('inspect', {}, 'Inspection complete. Source and tool limits are recorded.');
$('propose-button').onclick = () =>
  action('propose', { use_llm: $('use-llm').checked }, 'Candidate configuration saved.');
$('verify-button').onclick = () =>
  action('verify', { id: snapshot.state.candidates.at(-1)?.id }, 'Shadow test outcomes recorded.');
$('promote-button').onclick = () =>
  action(
    'promote',
    { id: snapshot.state.candidates.at(-1)?.id },
    'Final replay and publication decision recorded.',
  );
$('bad-patch-button').onclick = () =>
  action('reject-bad-patch', {}, 'Unsafe patch rejected; active pointer unchanged.');
$('rollback-button').onclick = () =>
  action('rollback', {}, 'Rollback replay complete. Check current-release compatibility.');
$('reset-button').onclick = () =>
  action('reset', {}, 'Sandbox reset. Previous state archived locally.');
document
  .querySelectorAll('[data-release]')
  .forEach(
    (button) =>
      (button.onclick = () =>
        action(
          'release',
          { release: button.dataset.release },
          `Portal switched to ${button.dataset.release}. Verified publication cleared.`,
        )),
  );
$('har-file').onchange = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 2.8 * 1024 * 1024)
      throw new Error('Select a HAR smaller than 2.8 MB. Export only the relevant quote request.');
    await action(
      'inspect',
      { har: JSON.parse(await file.text()) },
      'Operator HAR imported and inspected.',
    );
  } catch (error) {
    toast(error.message, true);
  } finally {
    event.target.value = '';
  }
};
document.querySelectorAll('[data-tab]').forEach(
  (button) =>
    (button.onclick = () => {
      document.querySelectorAll('[data-tab]').forEach((el) => {
        el.classList.toggle('selected', el === button);
        el.setAttribute('aria-current', el === button ? 'page' : 'false');
      });
      document
        .querySelectorAll('.tab-panel')
        .forEach((el) => (el.hidden = el.id !== `${button.dataset.tab}-tab`));
      const names = {
        overview: 'Overview',
        runs: 'Run history',
        evidence: 'Evidence',
        versions: 'Workflow versions',
      };
      $('breadcrumb-name').textContent = names[button.dataset.tab];
    }),
);
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-run],[data-evidence],[data-version],[data-ref]');
  if (!button || !snapshot) return;
  const s = snapshot.state,
    id = button.dataset.run ?? button.dataset.evidence ?? button.dataset.ref;
  const item = button.dataset.version
    ? s.workflows.find((w) => w.workflow_version === Number(button.dataset.version))
    : (s.runs.find((r) => r.id === id) ??
      s.evidence.find((e) => e.id === id) ??
      s.candidates.find((c) => c.id === id) ??
      s.cycle);
  showDetails('Execution & provenance', item ?? { reference: id });
});
$('close-dialog').onclick = () => $('detail-dialog').close();
$('detail-dialog').addEventListener('click', (event) => {
  if (event.target === $('detail-dialog')) $('detail-dialog').close();
});
await refresh();
setInterval(refresh, 1200);
