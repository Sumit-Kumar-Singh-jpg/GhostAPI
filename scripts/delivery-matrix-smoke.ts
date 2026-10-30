import 'dotenv/config';
import { DeliveryJobs } from '../src/delivery-jobs.js';
import { mkdir, writeFile } from 'node:fs/promises';
const jobs = new DeliveryJobs('./data/delivery-matrix-smoke');
await jobs.load();
const matrix = await jobs.startMatrix({
  url: 'https://www.amazon.in/dp/B0HP21TZYH',
  pincodes: ['560064', '110001', '400001'],
});
console.log(JSON.stringify({ matrix_id: matrix.matrix_id, job_ids: matrix.job_ids }));
let previous = '';
while (true) {
  const rows = jobs.list().filter((job) => job.matrix_id === matrix.matrix_id);
  const summary = rows.map((job) => ({
    pin: job.input.pincode,
    status: job.status,
    run_id: job.run_id,
    verdict: job.result?.verdict,
  }));
  const signature = JSON.stringify(summary);
  if (signature !== previous) {
    console.log(signature);
    previous = signature;
  }
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/delivery-matrix-smoke.json',
    JSON.stringify(
      rows.map(({ live_url, ...job }) => ({ ...job, live_view_available: !!live_url })),
      null,
      2,
    ),
  );
  if (rows.every((job) => !['queued', 'running'].includes(job.status))) break;
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
await jobs.close();
