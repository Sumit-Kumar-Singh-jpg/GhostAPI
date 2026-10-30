import { monitorButton } from './monitors.js';
function node(tag, text, className) {
  const item = document.createElement(tag);
  item.textContent = text;
  if (className) item.className = className;
  return item;
}
export function renderShopping(card, request, job, run, cancel) {
  const controls = node('div', '', 'shopping-controls');
  const start = node('button', job ? 'Use recent result' : 'Run check', 'button secondary');
  start.type = 'button';
  start.disabled = job?.status === 'running';
  start.onclick = () => run(request.id, false);
  controls.append(start);
  if (job) {
    const fresh = node('button', 'Run fresh', 'button secondary');
    fresh.type = 'button';
    fresh.disabled = job.status === 'running';
    fresh.onclick = () => run(request.id, true);
    controls.append(fresh);
  }
  if (job?.status === 'running') {
    const stop = node('button', 'Cancel check', 'button secondary');
    stop.type = 'button';
    stop.onclick = () => cancel(job.id);
    controls.append(stop);
  }
  card.append(controls);
  if (job?.status === 'completed')
    controls.append(monitorButton({ kind: 'shopping', request_id: request.id }));
  if (!job) return;
  card.append(
    node(
      'p',
      `${job.status === 'completed' ? 'Source facts collected' : job.status === 'partial' ? 'Partial information' : job.status} · Started ${new Date(job.started_at).toLocaleString()}`,
      'muted',
    ),
  );
  if (job.status === 'cancelled')
    card.append(
      node(
        'p',
        'Cancelled. An already-sent provider request may finish, but its result will not be used.',
        'muted',
      ),
    );
  if (job.error) card.append(node('p', job.error, 'muted'));
  if (!job.result) return;
  for (const comparison of job.result.comparisons)
    card.append(
      node(
        'p',
        `Lowest reported item price among ${comparison.urls.length} listings with GTIN ${comparison.identity}: ${comparison.currency} ${comparison.lowest}. Shipping and taxes are not compared.`,
        'shopping-comparison',
      ),
    );
  for (const listing of job.result.listings) {
    const section = node('section', '', 'shopping-listing');
    const title = node('a', listing.title);
    title.href = listing.url;
    title.target = '_blank';
    title.rel = 'noopener noreferrer';
    section.append(
      title,
      node(
        'p',
        `${new URL(listing.url).hostname} · Checked ${new Date(listing.checked_at).toLocaleString()}`,
        'muted',
      ),
    );
    const table = document.createElement('table');
    table.className = 'shopping-facts';
    const body = document.createElement('tbody');
    for (const fact of listing.facts) {
      const row = document.createElement('tr');
      const value = node('td', fact.value);
      value.append(node('small', `Source: ${fact.evidence}`));
      row.append(node('th', fact.label), value);
      body.append(row);
    }
    table.append(body);
    section.append(table);
    for (const concern of listing.concerns) section.append(node('p', concern, 'muted'));
    const monitor = node('button', 'Set up monitoring', 'button secondary');
    monitor.type = 'button';
    monitor.onclick = () => {
      document.getElementById('website-url').value = listing.url;
      location.hash = 'websites';
      document.getElementById('website-form-message').textContent =
        'Analyze this listing, then approve the fields you want to monitor.';
      document.getElementById('website-url').focus();
    };
    section.append(monitor);
    card.append(section);
  }
  const details = document.createElement('details');
  details.append(node('summary', 'Sources and limits'));
  for (const limitation of job.result.limitations) details.append(node('p', limitation, 'muted'));
  card.append(details);
}
