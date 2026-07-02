/// <reference lib="webworker" />
import { runInSandbox } from '@opal/engine';

self.onmessage = (e: MessageEvent<{ source: string }>) => {
  const result = runInSandbox(e.data.source);
  (self as unknown as Worker).postMessage(result);
};
