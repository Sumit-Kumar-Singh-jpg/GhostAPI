import 'dotenv/config';
import { createPortal } from './app.js';
import type { Release } from '../domain/types.js';

// Standalone public fixture deployment. No dashboard, release mutation, keys,
// evidence, or stored workflow state is exposed by this process.
const release = process.env.SITE_RELEASE ?? 'r2';
if (!['r1', 'r2'].includes(release)) throw new Error('SITE_RELEASE must be r1 or r2');
const port = Number(process.env.PORTAL_PORT ?? process.env.PORT ?? 3001);
const app = createPortal(() => release as Release, '');
app.listen(port, process.env.PORTAL_HOST ?? '127.0.0.1', () =>
  console.log(
    `Read-only supplier fixture on port ${port}, ${release}. No control-plane routes are exposed.`,
  ),
);
