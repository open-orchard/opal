import type { IOC, IOCType } from './types';
import { decodeBase64LayerSync } from './classifier';

const PATTERNS: Array<{ type: IOCType; re: RegExp }> = [
  { type: 'url', re: /\bhttps?:\/\/[^\s'"`)\\]+/gi },
  { type: 'ip', re: /\b\d{1,3}(?:\.\d{1,3}){3}\b/g },
  // Absolute macOS paths under common roots (incl. /Library, where stealers
  // target keychains, cookies, Notes, app data), plus ~ home paths. (Paths
  // containing spaces, e.g. "Group Containers", truncate at the space — a v1
  // limitation, since allowing spaces would merge space-separated path args.)
  { type: 'path', re: /(?:\/tmp|\/var|\/private|\/Users\/[^/\s'"`]+|\/Library|\/Applications|\/System|\/opt|\/usr|\/Volumes|~)(?:\/[^\s'"`)\\]*)+/g },
  { type: 'user-agent', re: /Mozilla\/\d[^'"`]*/g },
  // Require whitespace after the keyword so shell commands match but JS calls
  // like `x.open(` / `.curl(` do not (the `(` fails the lookahead).
  // `id` is intentionally omitted: it collides with ubiquitous JS (`var id = …`)
  // and real shell `"id"` is quote-terminated (fails the \s lookahead) anyway.
  { type: 'command', re: /\b(?:base64|bash|caffeinate|chmod|crontab|codesign|cp|csrutil|curl|ditto|dscl|find|funzip|gzip|gunzip|grep|hdiutil|hostname|ioreg|kill|killall|launchctl|mktemp|mv|networksetup|node|nohup|open|osacompile|osanative|osascript|pbcopy|pbpaste|perl|pkill|plutil|python|python3|rm|ruby|say|screencapture|security|softwareupdate|spctl|sqlite3|sw_vers|system_profiler|tar|unzip|wget|whoami|xattr|zip)(?=\s)[^\n'"]*/g },
  { type: 'base64', re: /[A-Za-z0-9+/]{40,}={0,2}/g },
];

export function extractIocs(text: string, layerDepth: number, source: string): IOC[] {
  const out: IOC[] = [];
  const seen = new Set<string>();
  for (const { type, re } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const value = m[0].trim();
      let decoded: string | undefined;
      if (type === 'base64') {
        const d = decodeBase64LayerSync(value);
        if (d === null) continue;
        decoded = d;
      }
      const key = `${type}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(decoded === undefined ? { type, value, layerDepth, source } : { type, value, layerDepth, source, decoded });
    }
  }
  return out;
}

export function defang(value: string): string {
  return value.replace(/^http/i, (m) => (m[0] === 'H' ? 'Hxxp' : 'hxxp')).replace(/\./g, '[.]');
}
