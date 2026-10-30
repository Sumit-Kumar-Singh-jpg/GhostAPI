import { monitorButton } from './monitors.js';
function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function renderInternship(card, request, job, run, cancel) {
  if (request.company_url)
    card.append(element('p', `Company reference: ${request.company_url}`, 'muted'));
  const controls = element('div', '', 'shopping-controls');
  const start = element('button', job ? 'Use recent result' : 'Run check', 'button secondary');
  start.type = 'button';
  start.disabled = job?.status === 'running';
  start.onclick = () => run(request.id, false);
  controls.append(start);
  if (job) {
    const fresh = element('button', 'Run fresh', 'button secondary');
    fresh.type = 'button';
    fresh.disabled = job.status === 'running';
    fresh.onclick = () => run(request.id, true);
    controls.append(fresh);
  }
  if (job?.status === 'running') {
    const stop = element('button', 'Cancel check', 'button secondary');
    stop.type = 'button';
    stop.onclick = () => cancel(job.id);
    controls.append(stop);
  }
  card.append(controls);
  if (job?.status === 'completed')
    controls.append(monitorButton({ kind: 'internships', request_id: request.id }));
  if (!job) return;
  card.append(
    element('p', `${job.status} · ${new Date(job.started_at).toLocaleString()}`, 'muted'),
  );
  if (job.error) card.append(element('p', job.error));
  if (job.status === 'cancelled')
    card.append(element('p', 'Cancelled. Late provider responses will not be used.', 'muted'));
  if (!job.result) return;
  const result = job.result;
  card.append(element('h3', result.assessment, 'internship-assessment'));
  card.append(
    element(
      'p',
      `Checked ${new Date(result.checked_at).toLocaleString()} · Evidence review, not a safe/fraud verdict.`,
      'muted',
    ),
  );
  for (const finding of result.findings) {
    const section = element('section', '', `internship-finding finding-${finding.kind}`);
    section.append(element('strong', finding.title), element('p', finding.explanation));
    if (finding.excerpt) section.append(element('blockquote', finding.excerpt));
    if (finding.source.startsWith('https://')) {
      const link = element('a', 'View supporting source');
      link.href = finding.source;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      section.append(link);
    } else section.append(element('small', finding.source));
    card.append(section);
  }
  const sources = element('details', '');
  sources.append(element('summary', 'Sources and limits'));
  for (const source of result.sources) {
    const p = element('p', '');
    const link = element('a', source.title);
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    p.append(link);
    sources.append(p);
  }
  for (const note of result.limitations) sources.append(element('p', note, 'muted'));
  card.append(sources);
}
