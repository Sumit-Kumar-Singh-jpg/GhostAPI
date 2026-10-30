import { initInteractions, updateInteractions, selectInteraction } from './interactions.js';
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
let sites = [],
  selected,
  bindings = [],
  field,
  loading = false,
  autoOpened,
  reaEvidence;
export function updateVisual(next) {
  sites = next;
  const newest = sites[0];
  if (newest?.inspection && newest.phase === 'idle' && autoOpened !== newest.id && !loading) {
    autoOpened = newest.id;
    void open(newest.id);
  }
  if (selected && !sites.some((s) => s.id === selected)) {
    selected = undefined;
    $('visual-frame').hidden = true;
    $('visual-placeholder').hidden = false;
    $('visual-bindings').replaceChildren();
    $('visual-detail').hidden = true;
  }
}
async function open(id, rebuild = false) {
  if (loading) return;
  loading = true;
  selected = id;
  field = undefined;
  reaEvidence = undefined;
  $('visual-rea').replaceChildren();
  $('visual-status').textContent = 'BUILDING';
  $('visual-quality').textContent = '';
  $('visual-quality').hidden = true;
  $('visual-comparison').hidden = true;
  $('visual-source-shot').removeAttribute('src');
  $('visual-preview-shot').removeAttribute('src');
  $('visual-placeholder').hidden = false;
  $('visual-placeholder').textContent = 'Capturing page styles, images, and data bindings…';
  $('visual-frame').hidden = true;
  $('visual-detail').hidden = true;
  $('visual-rebuild').disabled = true;
  $('visual-bindings').replaceChildren();
  $('interaction-workspace').hidden = true;
  try {
    const response = await fetch(`/api/websites/${id}/visual${rebuild ? '?rebuild=1' : ''}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    if (!sites.some((s) => s.id === id)) return;
    bindings = result.bindings;
    updateInteractions(id, result.controls ?? []);
    const capture = result.rendered;
    if (capture?.source_screenshot && capture?.preview_screenshot) {
      $('visual-source-shot').src = capture.source_screenshot;
      $('visual-preview-shot').src = capture.preview_screenshot;
      $('visual-comparison').hidden = false;
    }
    reaEvidence = result.rea;
    $('visual-rea').innerHTML =
      `<h3>REA capture evidence</h3>${reaEvidence?.status === 'verified' ? `<p class="rea-verified">Verified · ${reaEvidence.requests.length} HTTP records</p><code>${esc(reaEvidence.evidence_id)}</code><details><summary>Captured request inventory</summary>${reaEvidence.requests.map((request) => `<div class="rea-request"><strong>GET · ${esc(request.kind)}</strong><code>${esc(request.url)}</code><small>${esc(request.mime)}</small></div>`).join('')}</details><details><summary>Artifact identity</summary><code>SHA-256 ${esc(reaEvidence.sha256)}</code></details>` : '<p>Unavailable — this clone has no verified REA evidence.</p>'}${(reaEvidence?.limitations ?? []).map((note) => `<p class="muted">${esc(note)}</p>`).join('')}`;
    $('visual-source').textContent = sites.find((s) => s.id === id)?.url ?? '';
    $('visual-notes').replaceChildren(
      ...result.notes.map((note) => {
        const p = document.createElement('p');
        p.textContent = note;
        return p;
      }),
    );
    $('visual-bindings').innerHTML = bindings
      .map(
        (b) =>
          `<button class="visual-binding" data-field-key="${esc(b.key)}"><strong>${esc(b.label)}</strong><small>${b.matched ? 'Linked to preview' : 'No visible match'} · GET</small></button>`,
      )
      .join('');
    $('visual-frame').src = `/api/websites/${id}/preview?t=${Date.now()}`;
    const quality = result.quality;
    $('visual-status').textContent =
      quality?.status === 'incomplete' ? 'INCOMPLETE PREVIEW' : `${bindings.length} APIs`;
    $('visual-quality').textContent = quality
      ? `${quality.status === 'incomplete' ? 'Incomplete capture — some assets could not be reproduced. ' : ''}${quality.styles_loaded}/${quality.styles_total} stylesheets · ${quality.images_loaded}/${quality.images_total} images. Original JavaScript interactions are disabled.`
      : '';
    $('visual-quality').hidden = !quality;
    if (capture)
      $('visual-quality').textContent =
        `${capture.mode === 'browser' ? 'Rendered browser capture' : 'Raw HTML fallback'} · ${new Date(capture.captured_at).toLocaleString()}. ${$('visual-quality').textContent}`;
  } catch (error) {
    $('visual-placeholder').textContent = error.message;
    $('visual-status').textContent = 'BUILD FAILED';
  } finally {
    loading = false;
    $('visual-rebuild').disabled = false;
  }
}
function select(key) {
  field = bindings.find((b) => b.key === key);
  if (!field) return;
  $('visual-detail').hidden = false;
  $('visual-field-label').textContent = field.label;
  $('visual-endpoint').textContent = `GET ${field.endpoint}`;
  const site = sites.find((s) => s.id === selected);
  $('visual-field-state').textContent = site?.contract
    ? 'Tests return the latest verified observation, including its source and time.'
    : 'Approve the extraction contract on the website card to activate this API.';
  const documentRequest = reaEvidence?.status === 'verified' && field.rea_source;
  if (documentRequest)
    $('visual-field-state').textContent +=
      ` Clone source documented by REA: ${documentRequest.url}. This records the source fetch, not independent validation of this value.`;
  $('visual-response').textContent = JSON.stringify(
    { sample: field.sample, status: 'preview_sample' },
    null,
    2,
  );
  document
    .querySelectorAll('[data-field-key]')
    .forEach((b) => b.classList.toggle('active', b.dataset.fieldKey === key));
  const doc = $('visual-frame').contentDocument;
  doc?.querySelectorAll('[data-ghost-field]').forEach((el) => {
    el.classList.toggle('ghost-selected', el.dataset.ghostField === key);
    if (el.dataset.ghostField === key) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}
export function initVisual() {
  initInteractions();
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-visual-site]');
    if (button) {
      void open(button.dataset.visualSite);
      $('visual-workspace').scrollIntoView({ behavior: 'smooth' });
    }
    const binding = event.target.closest('[data-field-key]');
    if (binding) select(binding.dataset.fieldKey);
  });
  $('visual-rebuild').onclick = () => selected && open(selected, true);
  $('visual-frame').onload = () => {
    const doc = $('visual-frame').contentDocument;
    if (!doc || !selected) return;
    const style = doc.createElement('style');
    style.textContent =
      '[data-ghost-field]{outline:2px dashed #58a635!important;outline-offset:4px;cursor:pointer!important}.ghost-selected{outline:3px solid #489f21!important;background-color:#c4fa8060!important}[data-ghost-control]{outline:2px dashed #449ddd!important;outline-offset:3px;cursor:pointer!important}';
    doc.head.append(style);
    doc.addEventListener('click', (event) => {
      event.preventDefault();
      const control = event.target.closest('[data-ghost-control]');
      if (control) {
        selectInteraction(control.dataset.ghostControl);
        return;
      }
      const target = event.target.closest('[data-ghost-field]');
      if (target) select(target.dataset.ghostField);
    });
    $('visual-placeholder').hidden = true;
    $('visual-frame').hidden = false;
  };
  $('visual-test').onclick = async () => {
    if (!field) return;
    const endpoint = field.endpoint;
    $('visual-test').disabled = true;
    try {
      const response = await fetch(endpoint);
      const result = await response.json();
      if (field?.endpoint === endpoint)
        $('visual-response').textContent = JSON.stringify(
          { http_status: response.status, ...result },
          null,
          2,
        );
    } catch {
      $('visual-response').textContent = 'Could not reach the local API.';
    } finally {
      $('visual-test').disabled = false;
    }
  };
}
