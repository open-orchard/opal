import { describe, it, expect } from 'vitest';
import { extractSource } from '../src/parser';

describe('extractSource', () => {
  it('extracts source from an eval/osascript one-liner', () => {
    const input = `eval "$(osascript -l JavaScript -e 'var k="x";k')"`;
    expect(extractSource(input)).toBe('var k="x";k');
  });

  it('extracts source from double-quoted -e', () => {
    const input = `osascript -l JavaScript -e "var k='x';k"`;
    expect(extractSource(input)).toBe("var k='x';k");
  });

  it('returns raw JS unchanged when there is no wrapper', () => {
    expect(extractSource('  var k=1; k  ')).toBe('var k=1; k');
  });
});
