import 'dotenv/config';
import { TinyFish } from '@tiny-fish/sdk';
try {
  const response = await new TinyFish({ maxRetries: 0 }).runs.list({ limit: 5 });
  console.log(
    JSON.stringify(
      response.data.map((run) => ({
        run_id: run.run_id,
        status: run.status,
        created_at: run.created_at,
      })),
    ),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      name: error instanceof Error ? error.name : 'unknown',
      status:
        typeof error === 'object' && error && 'statusCode' in error ? error.statusCode : undefined,
    }),
  );
}
