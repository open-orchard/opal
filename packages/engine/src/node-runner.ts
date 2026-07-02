import type { SandboxRunner } from './types';
import { runInSandbox } from './sandbox-core';
export const nodeRunner: SandboxRunner = {
  async run(source: string) {
    return runInSandbox(source);
  },
};
