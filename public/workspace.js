import { renderShopping } from './shopping.js';
import { renderInternship } from './internships.js';
export function initWorkspace(showLogin) {
  const $ = (id) => document.getElementById(id);
  let active = 'websites';
  let generation = 0;
  let hasRunning = false;
  const drafts = { shopping: '', internships: '' };
  const titles = { shopping: 'Shopping Assistant', internships: 'Internship Checker' };
  function setInput() {
    const internship = active === 'internships';
    const listing = $('research-intent').value === 'check_listing';
    $('research-input-label').textContent = internship
      ? 'Internship link or description'
      : listing
        ? 'Product listing URL'
        : 'Product name or details';
    $('research-input').placeholder = internship
      ? 'Paste a public link or the internship description…'
      : listing
        ? 'https://store.example/product'
        : 'e.g. Sony WH-1000XM5, black';
  }
  async function loadRequests() {
    const current = ++generation;
    try {
      const response = await fetch('/api/requests');
      if (response.status === 401) {
        showLogin();
        return;
      }
      if (!response.ok) throw new Error();
      const data = await response.json();
      let jobs = [];
      if (active === 'shopping' || active === 'internships') {
        const result = await fetch(`/api/${active}`);
        if (!result.ok) throw new Error();
        jobs = (await result.json()).jobs;
      }
      if (current !== generation) return;
      hasRunning = jobs.some((job) => job.status === 'running');
      $('research-list').replaceChildren();
      const items = data.requests.filter((item) => item.tool === active);
      if (!items.length) $('research-list').textContent = 'No requests saved yet.';
      for (const item of items) {
        const card = document.createElement('article');
        card.className = 'panel research-request';
        const title = document.createElement('strong');
        title.textContent = {
          find_product: 'Find a product',
          check_listing: 'Check a listing',
          check_internship: 'Check an internship',
        }[item.intent];
        const input = document.createElement('p');
        input.textContent = item.input;
        const status = document.createElement('p');
        status.className = 'muted';
        const job = jobs.find((job) => job.request_id === item.id);
        status.textContent = `${job ? 'Saved request' : 'Not checked yet'} · Saved ${new Date(item.created_at).toLocaleString()}`;
        card.append(title, input, status);
        if (item.tool === 'shopping') renderShopping(card, item, job, runShopping, cancelShopping);
        if (item.tool === 'internships')
          renderInternship(card, item, job, runShopping, cancelShopping);
        $('research-list').append(card);
      }
    } catch {
      if (current === generation)
        $('research-message').textContent =
          'Could not load saved requests. Try opening this tool again.';
    }
  }
  async function runShopping(id, fresh) {
    try {
      const response = await fetch(`/api/${active}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-GhostAPI-Client': 'dashboard' },
        body: JSON.stringify({ request_id: id, fresh }),
      });
      if (response.status === 401) showLogin();
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      $('research-message').textContent = data.cached
        ? `Using cached result from ${new Date(data.job.finished_at).toLocaleString()}. Use Run fresh to check again.`
        : 'Checking online. Results will appear below.';
      await loadRequests();
    } catch (error) {
      $('research-message').textContent = error.message || 'Could not start check.';
    }
  }
  async function cancelShopping(id) {
    try {
      const response = await fetch(`/api/${active}/${id}/cancel`, {
        method: 'POST',
        headers: { 'X-GhostAPI-Client': 'dashboard' },
      });
      if (!response.ok) throw new Error('Could not cancel the check.');
      await loadRequests();
    } catch (error) {
      $('research-message').textContent = error.message;
    }
  }
  function navigate() {
    if (active !== 'websites') drafts[active] = $('research-input').value;
    const routes = {
      websites: '/website-builder',
      shopping: '/shopping',
      internships: '/internships',
    };
    const legacy = location.hash.slice(1);
    if (routes[legacy]) {
      location.replace(routes[legacy]);
      return;
    }
    const candidate =
      location.pathname === '/shopping'
        ? 'shopping'
        : location.pathname === '/internships'
          ? 'internships'
          : 'websites';
    active = ['shopping', 'internships'].includes(candidate) ? candidate : 'websites';
    document.title = `${titles[active] ?? 'Website Builder'} — GhostAPI`;
    generation++;
    document
      .querySelectorAll('[data-tool]')
      .forEach((button) =>
        button.setAttribute('aria-current', button.dataset.tool === active ? 'page' : 'false'),
      );
    $('websites-tab').hidden = active !== 'websites';
    $('research-tab').hidden = active === 'websites';
    $('research-message').textContent = '';
    if (active === 'websites') return;
    $('research-title').textContent = titles[active];
    $('research-description').textContent =
      active === 'shopping'
        ? 'Find products. Compare listings. Know what to check before buying.'
        : 'Look into an opportunity before you apply.';
    $('shopping-intent').hidden = active !== 'shopping';
    $('shopping-run').hidden = false;
    $('internship-reference').hidden = active !== 'internships';
    $('company-url').disabled = active !== 'internships';
    $('research-help').textContent =
      active === 'shopping'
        ? 'Search up to four public listings or check one product page. Results show source claims and missing information; they do not guarantee authenticity.'
        : 'Review public evidence and warning signs. Paste a listing URL or description; add a company reference website for corroboration. Do not include private IDs or credentials.';
    $('research-input').value = drafts[active];
    setInput();
    void loadRequests();
  }
  window.addEventListener('hashchange', navigate);
  $('research-intent').addEventListener('change', setInput);
  $('research-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submittedTool = active;
    $('research-save').disabled = true;
    $('research-message').textContent = 'Saving…';
    try {
      const response = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-GhostAPI-Client': 'dashboard' },
        body: JSON.stringify({
          tool: active,
          intent: active === 'internships' ? 'check_internship' : $('research-intent').value,
          input: $('research-input').value,
          ...(active === 'internships' ? { company_url: $('company-url').value } : {}),
        }),
      });
      if (response.status === 401) {
        showLogin();
        throw new Error('Sign in, then save your request again.');
      }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save request.');
      if (active === submittedTool) {
        await loadRequests();
        $('research-message').textContent = 'Saved locally. No online check has been run.';
        if (event.submitter?.id === 'shopping-run') await runShopping(result.request.id, false);
      }
    } catch (error) {
      if (active === submittedTool)
        $('research-message').textContent = error.message || 'Connection unavailable. Try again.';
    } finally {
      $('research-save').disabled = false;
    }
  });
  navigate();
  if (location.pathname === '/website-builder') {
    const handoff = sessionStorage.getItem('ghostapi-inspect-url');
    if (handoff) {
      sessionStorage.removeItem('ghostapi-inspect-url');
      $('website-url').value = handoff;
      $('website-form-message').textContent =
        'Analyze this listing, then approve the fields you want to monitor.';
      $('website-url').focus();
    }
  }
  setInterval(() => {
    if (active !== 'websites' && hasRunning) void loadRequests();
  }, 2000);
  return () => {
    if (active !== 'websites') void loadRequests();
  };
}
