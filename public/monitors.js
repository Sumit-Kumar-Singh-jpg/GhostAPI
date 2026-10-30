const $ = (id) => document.getElementById(id);
let previous;
function element(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}
async function command(body) {
  $('monitor-message').textContent = 'Updating scheduled check…';
  try {
    const response = await fetch('/api/monitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-GhostAPI-Client': 'dashboard' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    renderMonitors(data.monitors);
    $('monitor-message').textContent =
      body.action === 'create'
        ? 'Daily checks enabled while this server is awake.'
        : 'Scheduled check updated.';
  } catch (error) {
    $('monitor-message').textContent = error.message;
  }
}
export function monitorButton(target) {
  const button = element('button', 'Monitor daily');
  button.className = 'button secondary';
  button.type = 'button';
  button.onclick = async () => {
    button.disabled = true;
    $('scheduled-checks').open = true;
    $('scheduled-checks').scrollIntoView({ behavior: 'smooth' });
    try {
      await command({ action: 'create', target });
    } finally {
      button.disabled = false;
    }
  };
  return button;
}
export function renderMonitors(items) {
  const signature = JSON.stringify(items);
  if (previous === signature) return;
  previous = signature;
  $('monitor-list').replaceChildren();
  if (!items.length)
    $('monitor-list').textContent =
      'No scheduled checks. Enable Monitor daily on a completed result or a verified source API.';
  for (const item of items) {
    const card = element('article', '');
    card.className = 'monitor-card';
    card.append(
      element('h3', item.label),
      element(
        'p',
        `${item.enabled ? 'Enabled' : 'Paused'} · ${item.phase === 'checking' ? 'Checking' : item.status} · ${item.enabled ? 'Next: ' + new Date(item.next_at).toLocaleString() : 'No scheduled runs'}`,
      ),
    );
    const controls = element('div', '');
    controls.className = 'shopping-controls';
    for (const [action, label] of [
      ['check', 'Check now'],
      [item.enabled ? 'pause' : 'resume', item.enabled ? 'Pause' : 'Resume'],
      ['remove', 'Remove'],
    ]) {
      const button = element('button', label);
      button.type = 'button';
      button.className = 'button secondary';
      button.disabled = item.phase === 'checking';
      button.onclick = async () => {
        button.disabled = true;
        await command({ action, id: item.id });
        button.disabled = false;
      };
      controls.append(button);
    }
    card.append(controls);
    const history = element('details', '');
    history.append(element('summary', `History (${item.history.length})`));
    for (const event of item.history) {
      history.append(element('p', `${new Date(event.at).toLocaleString()} · ${event.message}`));
      for (const change of event.changes)
        history.append(
          element(
            'p',
            `${change.field}: ${change.before ?? '(missing)'} → ${change.after ?? '(missing)'}`,
          ),
        );
    }
    if (item.history[0]?.status === 'error') card.append(element('p', item.history[0].message));
    card.append(history);
    $('monitor-list').append(card);
  }
}
