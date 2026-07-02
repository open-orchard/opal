import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deobfuscate, nodeRunner } from '../src/index';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../samples/xor-curl-open.json', import.meta.url)), 'utf8'),
);

describe('e2e: xor-curl-open fixture', () => {
  it('decodes the XOR stager to the curl|open command', async () => {
    const res = await deobfuscate(fixture.input, nodeRunner);
    const allOutput = res.layers.flatMap((l) => l.output).join('\n');
    expect(allOutput).toContain(fixture.expectedCommandContains);
    expect(allOutput).toContain('open');
  });

  it('extracts the C2 URL as an IOC', async () => {
    const res = await deobfuscate(fixture.input, nodeRunner);
    expect(res.iocs.some((i) => i.type === 'url' && i.value === fixture.expectedUrl)).toBe(true);
  });

  it('never produces an execution error for this sample', async () => {
    const res = await deobfuscate(fixture.input, nodeRunner);
    expect(res.errors).toEqual([]);
  });
});
