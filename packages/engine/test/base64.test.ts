import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { base64ToTextGunzipped } from '../src/base64';

describe('base64ToTextGunzipped', () => {
  it('gunzips a gzip-compressed base64 blob before decoding', async () => {
    const inner = '"echo \'gzip-stage1-ok\'"';
    const gz = gzipSync(Buffer.from(inner));
    const b64 = gz.toString('base64');
    expect(await base64ToTextGunzipped(b64)).toBe(inner);
  });

  it('decodes a plain (non-gzip) base64 blob same as before', async () => {
    const b64 = Buffer.from('plain text').toString('base64');
    expect(await base64ToTextGunzipped(b64)).toBe('plain text');
  });

  it('returns null for garbage input', async () => {
    expect(await base64ToTextGunzipped('not-base64!!!')).toBeNull();
  });
});
