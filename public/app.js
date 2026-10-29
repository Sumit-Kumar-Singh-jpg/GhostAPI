import { initWebsites, renderWebsites } from './websites.js';
const $ = (id) => document.getElementById(id);
function showLogin() {
  if (!$('login-dialog').open) $('login-dialog').showModal();
}
async function sessionStatus() {
  const s = await (await fetch('/api/session')).json();
  $('logout-button').hidden = !s.protected;
  if (!s.authenticated) showLogin();
  return s.authenticated;
}
let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const r = await fetch('/api/state');
    if (r.status === 401) {
      showLogin();
      return;
    }
    if (!r.ok) throw new Error();
    const s = await r.json();
    renderWebsites(s.websites ?? [], s.website_monitoring);
  } catch {
    $('website-form-message').textContent = 'Connection unavailable. Please try again shortly.';
  } finally {
    refreshing = false;
  }
}
$('login-form').onsubmit = async (event) => {
  event.preventDefault();
  $('login-error').textContent = '';
  const password = $('admin-password').value;
  $('admin-password').value = '';
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-GhostAPI-Client': 'dashboard' },
    body: JSON.stringify({ password }),
  });
  const result = await response.json();
  if (!response.ok) {
    $('login-error').textContent = result.error;
    return;
  }
  $('login-dialog').close();
  await sessionStatus();
  await refresh();
};
$('logout-button').onclick = async () => {
  await fetch('/api/logout', { method: 'POST', headers: { 'X-GhostAPI-Client': 'dashboard' } });
  showLogin();
};

initWebsites(refresh);
if (await sessionStatus()) await refresh();
setInterval(refresh, 2500);
