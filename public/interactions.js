import { monitorButton } from './monitors.js';
const $ = (id) => document.getElementById(id);
let selected;
let busy = false;
let generation = 0;
function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
async function reports() {
  const version = ++generation;
  const response = await fetch(`/api/websites/${selected}/interactions`);
  const data = await response.json();
  if (version !== generation) return;
  if (!response.ok) throw new Error(data.error);
  $('interaction-results').replaceChildren();
  for (const report of data.reports) {
    const section = element('section', '', 'source-report');
    section.append(
      element('h3', `${report.control.label} · ${new Date(report.captured_at).toLocaleString()}`),
    );
    if (report.evidence?.evidence_id)
      section.append(element('p', `REA evidence: ${report.evidence.evidence_id}`, 'muted'));
    for (const candidate of report.candidates) {
      const card = element('div', '', 'source-candidate');
      card.append(
        element(
          'strong',
          candidate.status === 'verified'
            ? 'Verified field mapping'
            : candidate.status === 'stale'
              ? 'Needs a fresh capture'
              : 'Unverified candidate',
        ),
      );
      card.append(element('code', `GET ${candidate.url}`));
      card.append(element('p', candidate.reason, 'muted'));
      if (candidate.fields.length)
        card.append(
          element(
            'pre',
            JSON.stringify(
              candidate.fields.map((field) => ({ path: field.path, visible_value: field.value })),
              null,
              2,
            ),
          ),
        );
      const replay = element('button', 'Test source API', 'button secondary');
      replay.type = 'button';
      replay.disabled = candidate.status !== 'verified' || busy;
      replay.onclick = () =>
        act(`/api/websites/${selected}/source-apis/${candidate.id}/replay`, {});
      card.append(replay);
      if (candidate.status === 'verified')
        card.append(
          monitorButton({ kind: 'source_api', website_id: selected, candidate_id: candidate.id }),
        );
      section.append(card);
    }
    for (const note of report.limitations) section.append(element('p', note, 'muted'));
    $('interaction-results').append(section);
  }
}
async function act(path, body) {
  if (busy) return;
  const site = selected;
  busy = true;
  $('interaction-run').disabled = true;
  $('interaction-message').textContent = 'Checking the interaction and its source responses…';
  $('interaction-output').hidden = true;
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-GhostAPI-Client': 'dashboard' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (site !== selected) return;
    if (!response.ok) throw new Error(data.error);
    $('interaction-message').textContent = data.report
      ? 'Capture saved. Only verified mappings can be replayed.'
      : 'Fresh source response matched the captured fields.';
    if (!data.report) {
      $('interaction-output').textContent = JSON.stringify(data, null, 2);
      $('interaction-output').hidden = false;
    }
  } catch (error) {
    if (site === selected) $('interaction-message').textContent = error.message;
  } finally {
    busy = false;
    $('interaction-run').disabled = !$('interaction-control').value;
    if (site === selected)
      await reports().catch((error) => {
        $('interaction-message').textContent = error.message;
      });
  }
}
export function updateInteractions(id, controls = []) {
  selected = id;
  generation++;
  $('interaction-workspace').hidden = false;
  $('interaction-message').textContent = controls.length
    ? 'Select Next or Load more, or click its outline in the preview.'
    : 'No supported pagination controls found. Rebuild the preview to scan again.';
  $('interaction-control').replaceChildren(
    ...controls.map((control) => {
      const option = element('option', control.label);
      option.value = control.id;
      return option;
    }),
  );
  $('interaction-run').disabled = !controls.length || busy;
  $('interaction-output').hidden = true;
  $('interaction-results').replaceChildren();
  void reports().catch((error) => {
    $('interaction-message').textContent = error.message;
  });
}
export function selectInteraction(id) {
  if ([...$('interaction-control').options].some((option) => option.value === id)) {
    $('interaction-control').value = id;
    $('interaction-workspace').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
export function initInteractions() {
  $('interaction-form').onsubmit = (event) => {
    event.preventDefault();
    if (selected && $('interaction-control').value)
      void act(`/api/websites/${selected}/interactions`, {
        control_id: $('interaction-control').value,
      });
  };
}
