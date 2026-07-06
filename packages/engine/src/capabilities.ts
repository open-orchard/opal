import type { Capability } from './types';

interface Rule {
  tag: string;
  re: RegExp;
}

const RULES: Rule[] = [
  { tag: 'exfiltration',          re: /curl[^\n]*(-F|-d|--data|-X\s*POST|--upload)|\bnc \b/i },
  { tag: 'download',              re: /curl[^\n]*-O\b|curl\s+-o\b|\bwget\b/i },
  { tag: 'archive\/staging',      re: /\bditto\s+-c|\bzip\b|\btar\s+-c|\bgzip\b/i },
  { tag: 'recon',                 re: /system_profiler|sw_vers|ioreg|networksetup|\bwhoami\b|\bhostname\b/i },
  { tag: 'anti-analysis',         re: /\bVMware\b|\bQEMU\b|\bVirtualBox\b|\bParallels\b|\bhypervisor\b/i },
  { tag: 'phishing',              re: /\[captures password\]|\bwith hidden answer\b/i },
  { tag: 'credential-access',     re: /login\.keychain|security\s+(find|dump)|\bkeychain\b/i },
  { tag: 'browser-data',          re: /\bChrome\b|\bBrave\b|\bEdge\b|\bFirefox\b|Cookies\.binarycookies|Login Data/ },
  { tag: 'crypto-wallet',         re: /\bwallet\b|\bElectrum\b|\bExodus\b|\bLedger\b|\bCoinomi\b|\bMonero\b|\bTrezor\b|\bAtomic\b/i },
  { tag: 'notes\/messages',       re: /NoteStore\.sqlite|telegram|tdata/i },
  { tag: 'clipboard',             re: /\bpbpaste\b/i },
  { tag: 'screenshot',            re: /\bscreencapture\b/i },
  { tag: 'persistence',           re: /LaunchAgents|LaunchDaemons|launchctl\s+load|crontab/i },
  { tag: 'privilege-escalation',  re: /with administrator privileges|\bsudo\b/i },
  { tag: 'cleanup',               re: /\brm\s+-rf?\b|\bsrm\b/i },
];

/**
 * Scan the combined `texts` for behavioral capability indicators.
 * Returns one `Capability` per matched tag (deduped, in rule order).
 */
export function deriveCapabilities(texts: string[]): Capability[] {
  const joined = texts.join('\n');
  const result: Capability[] = [];

  for (const { tag, re } of RULES) {
    const m = re.exec(joined);
    if (!m) continue;
    // Collapse whitespace and trim to 80 chars
    const raw = m[0].replace(/\s+/g, ' ').trim();
    const evidence = raw.length <= 80 ? raw : raw.slice(0, 77) + '...';
    result.push({ tag, evidence });
  }

  return result;
}
