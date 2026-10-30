import 'dotenv/config';
import { TinyFish } from '@tiny-fish/sdk';
import { DeliveryJobs } from '../src/delivery-jobs.js';
import { mkdir, writeFile } from 'node:fs/promises';

// One search, one bounded live delivery run. Never print provider payloads or viewing URLs.
const client = new TinyFish({ maxRetries: 0, timeout: 20000 });
const search = await client.search.query({
  query: 'site:amazon.in/dp laptop 16GB',
  purpose: 'Find one public Indian laptop product listing for a bounded delivery integration test.',
});
const url = search.results
  .map((item) => item.url)
  .find((value) =>
    /^https:\/\/(www\.)?amazon\.in\/.*(?:dp|gp\/product)\/[A-Z0-9]{10}/i.test(value),
  );
if (!url) throw new Error('No supported product URL found. No automation started.');
const jobs = new DeliveryJobs('./data/delivery-smoke');
await jobs.load();
const started = await jobs.start({ url, pincode: '560064' });
let sawViewer = false;
while (true) {
  const job = jobs.list().find((item) => item.id === started.id)!;
  sawViewer ||= !!job.live_url;
  if (job.status !== 'running') {
    const report = { ...job, live_url: undefined, live_view_received: sawViewer };
    await mkdir('artifacts', { recursive: true });
    await writeFile('artifacts/delivery-smoke.json', JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify({
        status: job.status,
        verdict: job.result?.verdict,
        source: url,
        run_id: job.run_id,
        live_view_received: sawViewer,
        error: job.error,
      }),
    );
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
await jobs.close();
