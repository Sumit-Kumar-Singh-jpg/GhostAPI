import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRuntime } from '../src/server.js';
import { validateAccessOptions } from '../src/security.js';

const password = 'test-fixture-password-not-a-real-secret';
const headers = { 'Content-Type': 'application/json', 'X-GhostAPI-Client': 'dashboard' };
async function setup() {
  return startRuntime({
    dashboardPort: 0,
    portalPort: 0,
    dataDir: await mkdtemp(join(tmpdir(), 'ghostapi-auth-')),
    adminPassword: password,
  });
}
test('Protected API requires login; cookie is HttpOnly and logout revokes it', async (t) => {
  const runtime = await setup();
  t.after(() => runtime.close());
  assert.equal((await fetch(`${runtime.url}/api/state`)).status, 401);
  assert.equal((await fetch(`${runtime.url}/api/export`)).status, 401);
  const login = await fetch(`${runtime.url}/api/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie')!;
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  const cookie = setCookie.split(';')[0]!;
  assert.equal(
    (await fetch(`${runtime.url}/api/state`, { headers: { Cookie: cookie } })).status,
    200,
  );
  const crossOrigin = await fetch(`${runtime.url}/api/reset`, {
    method: 'POST',
    headers: { ...headers, Cookie: cookie, Origin: 'https://untrusted.invalid' },
    body: '{}',
  });
  assert.equal(crossOrigin.status, 403);
  await fetch(`${runtime.url}/api/logout`, {
    method: 'POST',
    headers: { ...headers, Cookie: cookie },
  });
  assert.equal(
    (await fetch(`${runtime.url}/api/state`, { headers: { Cookie: cookie } })).status,
    401,
  );
});
test('Repeated invalid sign-ins are rate limited', async (t) => {
  const runtime = await setup();
  t.after(() => runtime.close());
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await fetch(`${runtime.url}/api/login`, {
          method: 'POST',
          headers,
          body: '{"password":"wrong"}',
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await fetch(`${runtime.url}/api/login`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ password }),
      })
    ).status,
    429,
  );
});
test('Public production cannot start with weak authentication or an insecure origin', () => {
  assert.throws(() =>
    validateAccessOptions({
      production: true,
      password: 'short',
      publicOrigin: 'https://ghostapi.example',
    }),
  );
  assert.throws(() =>
    validateAccessOptions({ production: true, password, publicOrigin: 'http://ghostapi.example' }),
  );
  assert.throws(() =>
    validateAccessOptions({
      production: true,
      password,
      publicOrigin: 'https://ghostapi.example/path',
    }),
  );
  assert.doesNotThrow(() =>
    validateAccessOptions({ production: true, password, publicOrigin: 'https://ghostapi.example' }),
  );
});
