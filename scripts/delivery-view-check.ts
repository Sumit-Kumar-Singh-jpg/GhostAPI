import 'dotenv/config';
import { TinyFish } from '@tiny-fish/sdk';
const run = await new TinyFish({ maxRetries: 0 }).runs.get('7de780f0-2b9f-44ac-96d6-cf2b354a13ff');
if (!run.streaming_url) throw new Error('No viewing URL returned.');
const response = await fetch(run.streaming_url);
console.log(
  JSON.stringify({
    host: new URL(run.streaming_url).hostname,
    status: response.status,
    frame_options: response.headers.get('x-frame-options'),
    csp: response.headers.get('content-security-policy'),
  }),
);
