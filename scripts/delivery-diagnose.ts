import 'dotenv/config';
import { TinyFish } from '@tiny-fish/sdk';
const client = new TinyFish({ maxRetries: 0, timeout: 20000 });
try {
  const result = await client.agent.stream(
    {
      url: 'https://www.amazon.in/dp/B0HP21TZYH',
      goal: 'Check delivery availability for PIN 560064 on this laptop listing. Only enter PIN; do not sign in, add to cart or buy. If blocked report unknown.',
    },
    { signal: AbortSignal.timeout(180000) },
  );
  for await (const event of result) {
    console.log(
      JSON.stringify({ type: event.type, ...('run_id' in event ? { run_id: event.run_id } : {}) }),
    );
  }
} catch (error) {
  if (error instanceof Error) {
    const clean = error.message
      .replace(/sk-[\w-]+/g, '[redacted]')
      .replace(/https?:\/\/\S+/g, '[url withheld]');
    console.log(
      JSON.stringify({
        name: error.name,
        message: clean.slice(0, 1500),
        ...('statusCode' in error ? { status: error.statusCode } : {}),
        ...('code' in error ? { code: error.code } : {}),
      }),
    );
  }
}
