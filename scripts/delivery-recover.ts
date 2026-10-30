import 'dotenv/config';
import { TinyFish } from '@tiny-fish/sdk';
import { deliveryVerdict, type DeliveryObservation } from '../src/delivery.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const records = JSON.parse(await readFile('data/delivery-smoke/delivery.json', 'utf8'));
const id = records.find((record: { run_id?: string }) => record.run_id)?.run_id;
if (!id) throw new Error('No run to recover.');
const run = await new TinyFish({ maxRetries: 0 }).runs.get(id);
const observation = run.result as DeliveryObservation | null;
const evaluated = observation
  ? deliveryVerdict(
      records.find((record: { run_id?: string }) => record.run_id === id).input,
      observation,
    )
  : undefined;
await mkdir('artifacts', { recursive: true });
await writeFile(
  'artifacts/delivery-recovered.json',
  JSON.stringify(
    {
      run_id: run.run_id,
      status: run.status,
      result: run.result,
      evaluated,
      live_view_available: !!run.streaming_url,
      steps: run.num_of_steps,
      finished_at: run.finished_at,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ run_id: run.run_id, status: run.status, result: run.result }));
