import type { Capability } from './types';

interface Rule {
  tag: string;
  re: RegExp;
}

const RULES: Rule[] = [
  { tag: 'exfiltration',          re: /curl[^\n]*(-F|-d|--data|-X\s*POST|--upload)|\bnc \b/i },
  { tag: 'mail-exfiltration',     re: /\bmake\s+new\s+outgoing\s+message\b/i },
  { tag: 'download',              re: /curl[^\n]*-O\b|curl\s+-o\b|\bwget\b/i },
  { tag: 'curl-pipe-shell',       re: /\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(ba|z)?sh\b/i },
  { tag: 'reverse-shell',         re: /\/dev\/tcp\/|\bnc\s+-e\b|\bssh\s+-R\b|\bngrok\b/i },
  { tag: 'dmg-mount',             re: /\bhdiutil\s+(attach|mount)\b/i },
  { tag: 'archive\/staging',      re: /\bditto\s+-c|\bzip\b|\btar\s+-c|\bgzip\b/i },
  { tag: 'recon',                 re: /system_profiler|sw_vers|ioreg|networksetup|\bwhoami\b|\bhostname\b/i },
  { tag: 'anti-analysis',         re: /\bVMware\b|\bQEMU\b|\bVirtualBox\b|\bParallels\b|\bhypervisor\b/i },
  { tag: 'phishing',              re: /\[captures password\]|\bwith hidden answer\b/i },
  { tag: 'clickfix',              re: /\bset the clipboard to\b[^\n]*\|\s*(sudo\s+)?(ba|z)?sh\b/i },
  { tag: 'credential-access',     re: /login\.keychain|security\s+(find|dump)|\bkeychain\b/i },
  { tag: 'browser-data',          re: /\bChrome\b|\bBrave\b|\bEdge\b|\bFirefox\b|Cookies\.binarycookies|Login Data/ },
  { tag: 'crypto-wallet',         re: /\bwallet\b|\bElectrum\b|\bExodus\b|\bLedger\b|\bCoinomi\b|\bMonero\b|\bTrezor\b|\bAtomic\b/i },
  { tag: 'notes\/messages',       re: /NoteStore\.sqlite|telegram|tdata/i },
  { tag: 'imessage',              re: /chat\.db\b|~\/Library\/Messages\//i },
  { tag: 'clipboard',             re: /\bpbpaste\b|NSPasteboard/i },
  { tag: 'screenshot',            re: /\bscreencapture\b/i },
  { tag: 'av-capture',            re: /avfoundation|AVCaptureSession|AVCaptureDevice|\bQTKit\b/i },
  { tag: 'persistence',           re: /LaunchAgents|LaunchDaemons|launchctl\s+load|crontab/i },
  { tag: 'login-item-persistence', re: /make\s+(new\s+)?login item\b/i },
  { tag: 'profile-install',       re: /\bprofiles\s+install\b|\.mobileconfig\b/i },
  { tag: 'privilege-escalation',  re: /with administrator privileges|\bsudo\b/i },
  { tag: 'defense-evasion',       re: /spctl\s+--master-disable|csrutil\s+(status|disable)|codesign\s+--remove-signature|xattr\s+-d\s+com\.apple\.quarantine/i },
  { tag: 'tcc-manipulation',      re: /TCC\.db\b/i },
  { tag: 'security-tool-kill',    re: /\b(killall|pkill)\b[^\n]{0,40}(Little Snitch|CrowdStrike|Falcon|BlockBlock|KnockKnock|LuLu|ReiKey|Objective-See)/i },
  { tag: 'xcode-injection',       re: /\.xcodeproj\b|\bproject\.pbxproj\b/i },
  { tag: 'nstask-execution',      re: /\bNSTask\b|\bNSAppleScript\b/i },
  { tag: 'terminal-app-automation', re: /\bTerminal\s+do\s+script\b/i },
  { tag: 'gui-automation',        re: /\bkeystroke\s+\S/i },
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
