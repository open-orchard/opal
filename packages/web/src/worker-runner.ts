import type { SandboxRunner, SandboxResult } from '@opal/engine';

export interface WorkerLike {
  postMessage(msg: { source: string }): void;
  terminate(): void;
  onmessage: ((e: { data: SandboxResult }) => void) | null;
}

/** Default factory builds the real browser Worker from the bundled entry. */
function defaultFactory(): WorkerLike {
  return new Worker(new URL('./sandbox.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

 // Browser SandboxRunner. Runs untrusted decoders in a Web Worker and enforces
 // a hard wall-clock timeout via terminate()
export function createWorkerRunner(factory: () => WorkerLike = defaultFactory): SandboxRunner {
  return {
    run(source, opts) {
      return new Promise<SandboxResult>((resolve) => {
        const worker = factory();
        let done = false;
        const finish = (r: SandboxResult) => { if (!done) { done = true; clearTimeout(timer); worker.terminate(); resolve(r); } };
        const timer = setTimeout(() => {
          finish({ capturedStrings: [], events: [], errors: [`timeout after ${opts.timeoutMs}ms`], unsupportedCalls: [] });
        }, opts.timeoutMs);
        worker.onmessage = (e) => finish(e.data);
        worker.postMessage({ source });
      });
    },
  };
}
