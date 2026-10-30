export function deliveryViewer(parent) {
  const panel = document.createElement('section');
  panel.className = 'panel delivery-viewer';
  const title = document.createElement('h3');
  title.textContent = 'Watch TinyFish work';
  const label = document.createElement('label');
  label.htmlFor = 'delivery-live-select';
  label.textContent = 'Active delivery check';
  const select = document.createElement('select');
  select.id = 'delivery-live-select';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const stage = document.createElement('div');
  stage.className = 'delivery-live-stage';
  const help = document.createElement('p');
  help.className = 'muted';
  help.textContent =
    'Temporary provider view. If it stays blank or expires, open the live browser separately. Your check continues independently.';
  const fallback = document.createElement('a');
  fallback.textContent = 'Open live browser separately ↗';
  fallback.target = '_blank';
  fallback.rel = 'noopener noreferrer';
  fallback.referrerPolicy = 'no-referrer';
  fallback.hidden = true;
  panel.append(title, label, select, status, stage, help, fallback);
  parent.append(panel);
  let jobs = [],
    selected,
    url,
    wasLive = false;
  const embeddable = (value) => {
    try {
      const u = new URL(value);
      return (
        u.protocol === 'https:' &&
        !u.username &&
        !u.password &&
        (u.hostname.endsWith('.tetra-data.production.tinyfish.io') ||
          u.hostname === 'tetra-streaming.tinyfish.io') &&
        !u.port
      );
    } catch {
      return false;
    }
  };
  function draw() {
    const job = jobs.find((job) => job.id === selected);
    const next = job?.status === 'running' ? job.live_url : undefined;
    fallback.hidden = !next;
    if (next) fallback.href = next;
    else fallback.removeAttribute('href');
    status.textContent = job
      ? `PIN ${job.input.pincode} · ${job.status} · ${job.progress.at(-1) ?? (next ? 'Provider view available' : 'Waiting for provider browser…')}`
      : wasLive
        ? 'Live session ended. Results and evidence remain below.'
        : 'Start a delivery check to watch its browser here.';
    if (next === url) return;
    url = next;
    stage.replaceChildren();
    if (!next) return;
    if (!embeddable(next)) {
      status.textContent += ' · This provider URL supports the external fallback only.';
      return;
    }
    wasLive = true;
    const frame = document.createElement('iframe');
    frame.id = 'delivery-live-frame';
    frame.title = `TinyFish live browser for PIN ${job.input.pincode}`;
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.referrerPolicy = 'no-referrer';
    frame.allow = 'fullscreen';
    frame.src = next;
    frame.onerror = () => {
      status.textContent =
        'Live viewer unavailable. Your delivery check continues; use the external link.';
    };
    stage.append(frame);
  }
  select.onchange = () => {
    selected = select.value;
    draw();
  };
  const update = (nextJobs) => {
    jobs = nextJobs;
    const active = jobs.filter((job) => ['queued', 'running'].includes(job.status));
    if (!active.some((job) => job.id === selected))
      selected = active.find((job) => job.live_url)?.id ?? active[0]?.id;
    const signature = active.map((job) => `${job.id}:${job.status}`).join('|');
    if (select.dataset.signature !== signature) {
      select.dataset.signature = signature;
      select.replaceChildren();
      for (const job of active) {
        const option = document.createElement('option');
        option.value = job.id;
        option.textContent = `PIN ${job.input.pincode} · ${job.status}`;
        select.append(option);
      }
    }
    select.hidden = !active.length;
    label.hidden = !active.length;
    if (selected) select.value = selected;
    draw();
  };
  update.select = (id) => {
    selected = id;
    select.value = id;
    draw();
    panel.scrollIntoView({ behavior: 'smooth' });
  };
  return update;
}
