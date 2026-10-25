import { TinyFish, RunStatus } from '@tiny-fish/sdk';
import { renderGoal } from '../domain/policy.js';
import { approvedUrl } from './local.js';
import type { Input, Workflow } from '../domain/types.js';

export function tinyfishReadiness() {
  return {
    sdk: '@tiny-fish/sdk',
    configured: Boolean(process.env.TINYFISH_API_KEY),
    public_origin_configured: Boolean(process.env.PUBLIC_PORTAL_ORIGIN),
    available: false,
    reason:
      'Blocked: managed-browser pre-action origin/write enforcement has not been demonstrated. The installed SDK exposes no verified origin allowlist. No remote agent call will be made.',
  };
}
// A boundary is a code implementation, never a user-supplied "safe=true" flag.
// No boundary is exported by this MVP; therefore remote runs are fail-closed.
export interface ExecutionBoundary {
  runReadOnly(task: () => Promise<unknown>): Promise<unknown>;
}
export async function executeTinyfish(
  workflow: Workflow,
  input: Input,
  timeout: number,
  boundary?: ExecutionBoundary,
) {
  if (!boundary) throw new Error(tinyfishReadiness().reason);
  if (!process.env.TINYFISH_API_KEY) throw new Error('TinyFish API key not configured');
  const client = new TinyFish({ apiKey: process.env.TINYFISH_API_KEY, maxRetries: 0 });
  return boundary.runReadOnly(async () => {
    const result = await client.agent.run(
      {
        url: approvedUrl(workflow.allowed_origin, workflow.start_path, input).toString(),
        goal: renderGoal(workflow, input),
        agent_config: {
          max_duration_seconds: Math.max(1, Math.floor(timeout / 1000)),
          mode: 'strict',
        },
      },
      { signal: AbortSignal.timeout(Math.max(1, timeout)) },
    );
    if (result.status !== RunStatus.COMPLETED || !result.run_id || !result.result)
      throw new Error('TinyFish run did not complete with a result');
    return result;
  });
}
