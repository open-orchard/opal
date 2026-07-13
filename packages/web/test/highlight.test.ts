import { describe, it, expect } from 'vitest';
import { highlightCode } from '../src/highlight';

describe('highlightCode', () => {
  it('wraps a string literal', () => {
    expect(highlightCode('var x = "hi"')).toContain('<span class="tok-string">"hi"</span>');
  });

  it('wraps a keyword', () => {
    expect(highlightCode('var x = 1')).toContain('<span class="tok-keyword">var</span>');
  });

  it('wraps a number', () => {
    expect(highlightCode('x = 42')).toContain('<span class="tok-number">42</span>');
  });

  it('wraps a comment', () => {
    expect(highlightCode('// note\nx')).toContain('<span class="tok-comment">// note</span>');
  });

  it('recognizes AppleScript keywords', () => {
    expect(highlightCode('do shell script "echo hi"')).toContain('<span class="tok-keyword">do</span>');
  });

  it('HTML-escapes adversarial content instead of injecting it', () => {
    const result = highlightCode('"<img src=x onerror=alert(1)>"');
    expect(result).not.toContain('<img');
    expect(result).toContain('&lt;img');
  });

  it('leaves an unrecognized identifier unwrapped', () => {
    expect(highlightCode('myVariable')).toBe('myVariable');
  });

  it('does not treat a URL scheme // as a line comment', () => {
    const result = highlightCode('curl http://198.51.100.7/zxc/app');
    expect(result).not.toContain('tok-comment');
  });

  it('does not treat a CLI double-dash flag as an AppleScript comment', () => {
    const result = highlightCode('ditto -c -k --sequesterRsrc /tmp/x http://198.51.100.7/out');
    expect(result).not.toContain('tok-comment');
  });

  it('still recognizes a real AppleScript comment', () => {
    expect(highlightCode('set x to 5 -- a comment')).toContain('<span class="tok-comment">-- a comment</span>');
  });
});
