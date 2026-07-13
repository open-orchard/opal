import type { SandboxResult, SandboxEvent, TargetArtifact } from './types';

/**
 * Heuristic: does this source look like AppleScript rather than JXA/JS? Keyed
 * on space-separated AppleScript constructs that never appear in JXA (which
 * uses `app.doShellScript(...)`, camelCase, no `tell application` blocks).
 */
export function looksLikeAppleScript(source: string): boolean {
  const unquoted = source.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '');
  return (
    /\bdo\s+shell\s+script\b/.test(unquoted) ||
    /\btell\s+application\b/.test(unquoted) ||
    /\bon\s+run\b/.test(unquoted) ||
    /\bset\s+the\s+clipboard\s+to\b/.test(unquoted)
  );
}

/** Unescape an AppleScript string literal body (\" and \\ only). */
function unescapeLiteral(body: string): string {
  return body.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

// True if `index` in `source` falls inside an open "..." string literal.
function isInsideStringLiteral(source: string, index: number): boolean {
  let inStr = false;
  for (let i = 0; i < index; i++) {
    const c = source[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
  }
  return inStr;
}

/** Split on top-level `&`, ignoring `&` inside "..." literals or ( ) groups. */
function splitConcat(expr: string): string[] {
  const parts: string[] = [];
  let buf = '';
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (inStr) {
      buf += c;
      if (c === '\\' && i + 1 < expr.length) buf += expr[++i]; // keep escaped char
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; buf += c; }
    else if (c === '(') { depth++; buf += c; }
    else if (c === ')') { depth = Math.max(0, depth - 1); buf += c; }
    else if (c === '&' && depth === 0) { parts.push(buf); buf = ''; }
    else buf += c;
  }
  parts.push(buf);
  return parts;
}

/** Evaluate one AppleScript value term to a display string. */
function evalTerm(term: string, vars: Record<string, string>): string {
  const t = term.trim();
  const paren = t.match(/^\(([\s\S]*)\)$/);
  if (paren) return evalExpr(paren[1], vars);
  const qf = t.match(/^quoted\s+form\s+of\s+([\s\S]+)$/i);
  if (qf) return evalTerm(qf[1], vars); // shell-quoting is cosmetic for our display
  const lit = t.match(/^"((?:[^"\\]|\\.)*)"$/);
  if (lit) return unescapeLiteral(lit[1]);
  const sys = t.match(/^system\s+attribute\s+"([^"]+)"$/i);
  if (sys) return `<${sys[1]}>`;
  const ascii = t.match(/^(?:ASCII character|character id)\s+(\d+)$/i);
  if (ascii) return String.fromCharCode(Number(ascii[1]));
  if (Object.prototype.hasOwnProperty.call(vars, t)) return vars[t];
  return `<${t}>`;
}

/**
 * Evaluate a `&`-joined AppleScript string expression to a display string,
 * resolving string literals, known `set` variables, `quoted form of` and
 * parens
 */
function evalExpr(expr: string, vars: Record<string, string>): string {
  return splitConcat(expr).map((p) => evalTerm(p, vars)).join('');
}

// Strip a trailing `)` left by a `(do shell script …)` wrapper (unbalanced parens). 
function stripWrappingParens(expr: string): string {
  let e = expr.trim();
  const count = (re: RegExp) => (e.match(re) ?? []).length;
  while (e.endsWith(')') && count(/\)/g) > count(/\(/g)) e = e.slice(0, -1).trim();
  return e;
}

// Resolve the common shell-cipher idiom `echo '<text>' | tr 'SET1' 'SET2'`
function resolveShellCipher(cmd: string): string {
  const m = cmd.match(/^echo\s+'([^']*)'\s*\|\s*tr\s+'([^']*)'\s+'([^']*)'\s*$/);
  if (!m) return cmd;
  const [, text, from, to] = m;
  const expand = (set: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < set.length; i++) {
      if (set[i + 1] === '-' && set[i + 2] !== undefined) {
        for (let c = set.charCodeAt(i); c <= set.charCodeAt(i + 2); c++) out.push(String.fromCharCode(c));
        i += 2;
      } else {
        out.push(set[i]);
      }
    }
    return out;
  };
  const fromChars = expand(from);
  const toChars = expand(to);
  if (fromChars.length !== toChars.length || fromChars.length === 0) return cmd;
  const map = new Map(fromChars.map((c, i) => [c, toChars[i]]));
  return text.replace(/./gs, (c) => map.get(c) ?? c);
}

// Resolve the RHS of a `set VAR to <rhs>` statement symbolically.
function resolveSetRhs(
  rhs: string,
  varName: string,
  vars: Record<string, string>,
): string | null {
  // Rule 1: do shell script "echo LITERAL" (optionally wrapped in parens)
  const dssRaw = rhs.match(/^\(?\s*do\s+shell\s+script\s+"((?:[^"\\]|\\.)*)"\s*\)?$/i);
  if (dssRaw) {
    const body = unescapeLiteral(dssRaw[1]);
    // `echo LITERAL` → return the literal
    const echoMatch = body.match(/^echo\s+(.*)$/);
    if (echoMatch) return echoMatch[1];
    // Other do shell script form → opaque placeholder
    return `<${varName}>`;
  }
  // Broader: any do shell script expr (not just double-quoted literal)
  const dssAny = rhs.match(/^\(?\s*do\s+shell\s+script\s+/i);
  if (dssAny) return `<${varName}>`;

  // 2: list/map literal — skip
  if (rhs.trim().startsWith('{')) return null;

  // Rule 3: partial resolution. A fully-unresolved RHS echoes back as
  // `<{whole rhs text}>` (evalTerm's generic fallback) — collapse that to
  // `<varName>` so later references to this var don't inline a large
  // unresolved sub-expression (e.g. a `display dialog` prompt) every time.
  // Deliberately-shaped placeholders like `<USER>` (from `system attribute`,
  // resolved inside evalExpr itself) don't match this and pass through.
  const resolved = evalExpr(rhs, vars);
  return resolved === `<${rhs.trim()}>` ? `<${varName}>` : resolved;
}

// Basic, static AppleScript decoder, no execution
export function decodeAppleScript(source: string): SandboxResult & { targets: TargetArtifact[] } {
  const events: SandboxEvent[] = [];
  const capturedStrings: string[] = [];
  const vars: Record<string, string> = {};

  // 1. Collect `set VAR to <string expr>` (one per line).
  for (const m of source.matchAll(/\bset\s+([A-Za-z_]\w*)\s+to\s+(.+?)\s*$/gm)) {
    if (isInsideStringLiteral(source, m.index)) continue;
    const v = resolveSetRhs(m[2].trim(), m[1], vars);
    if (v !== null) vars[m[1]] = v;
  }

  // 2. Surface `do shell script <expr>`: drop trailing clauses
  for (const m of source.matchAll(/\bdo\s+shell\s+script\s+(.+?)\s*$/gm)) {
    if (isInsideStringLiteral(source, m.index)) continue;
    const withClauseStripped = m[1].replace(/\s+(with|without|as|in)\s+.*$/i, '').trim();
    const credMatch = withClauseStripped.match(
      /^([\s\S]+?)\s+user\s+name\s+([\s\S]+?)\s+password\s+([\s\S]+?)$/i,
    );
    const commandExpr = credMatch ? credMatch[1] : withClauseStripped;
    const expr = stripWrappingParens(commandExpr);
    const cmd = resolveShellCipher(evalExpr(expr, vars));
    const detail = credMatch
      ? `${cmd} [credentials supplied: user name ${evalExpr(credMatch[2], vars)} password ${evalExpr(credMatch[3], vars)}]`
      : cmd;
    events.push({ kind: 'shell', detail });
    capturedStrings.push(cmd);
  }

  // 3. display dialog / display alert → credential-phishing surface
  for (const m of source.matchAll(/\bdisplay\s+(?:dialog|alert)\s+("(?:[^"\\]|\\.)*"|[A-Za-z_]\w*)([^\n]*)/gi)) {
    if (isInsideStringLiteral(source, m.index)) continue;
    const prompt = evalTerm(m[1], vars);
    const harvests = /\bwith\s+hidden\s+answer\b/i.test(m[2]);
    events.push({ kind: 'dialog', detail: harvests ? `${prompt} [captures password]` : prompt });
  }

  // 3.1. do JavaScript "..." in ... → browser-injection surface
  for (const m of source.matchAll(/\bdo\s+JavaScript\s+("(?:[^"\\]|\\.)*"|[A-Za-z_]\w*)/gi)) {
    if (isInsideStringLiteral(source, m.index)) continue;
    const js = evalTerm(m[1], vars);
    events.push({ kind: 'browser-injection', detail: js });
    capturedStrings.push(js);
  }

  // 3.2. keystroke "..." (System Events GUI scripting) → credential-automation
  // surface
  for (const m of source.matchAll(/\bkeystroke\s+("(?:[^"\\]|\\.)*"|[A-Za-z_]\w*)/gi)) {
    if (isInsideStringLiteral(source, m.index)) continue;
    const typed = evalTerm(m[1], vars);
    events.push({ kind: 'gui-scripting', detail: `keystroke ${typed}` });
  }

  // 3.3. make (new) login item ... (System Events login-item persistence) →
  // the payload's auto-relaunch-at-login mechanism
  for (const m of source.matchAll(/\bmake\s+(?:new\s+)?login item\b[^\n]*/gi)) {
    if (isInsideStringLiteral(source, m.index)) continue;
    events.push({ kind: 'login-item', detail: m[0].trim() });
  }

  // 3.4. do script "..." (Terminal.app/iTerm) → the macOS ClickFix execution
  for (const m of source.matchAll(/\bdo\s+script\s+("(?:[^"\\]|\\.)*"|[A-Za-z_]\w*)/gi)) {
    if (isInsideStringLiteral(source, m.index)) continue;
    const cmd = evalTerm(m[1], vars);
    events.push({ kind: 'terminal-app', detail: `Terminal do script ${cmd}` });
    capturedStrings.push(cmd);
  }

  // 3.5. set the clipboard to <expr> → ClickFix-style clipboard injection
  for (const m of source.matchAll(/\bset\s+the\s+clipboard\s+to\s+([^\n]+)/gi)) {
    if (isInsideStringLiteral(source, m.index)) continue;
    const payload = evalExpr(m[1].trim(), vars);
    events.push({ kind: 'clipboard-write', detail: `set the clipboard to ${payload}` });
    capturedStrings.push(payload);
  }

  // 3.6. make new outgoing message with properties {...} (Mail.app automation)
  // → an alternate exfiltration channel to the curl-based sinks
  for (const m of source.matchAll(/\bmake\s+new\s+outgoing\s+message\s+with\s+properties\s*\{[^}]*\}/gi)) {
    if (isInsideStringLiteral(source, m.index)) continue;
    events.push({ kind: 'mail-compose', detail: m[0].replace(/\s+/g, ' ').trim() });
  }

  // 4. run script <expr> → recover the source and let the orchestrator recurse on it
  for (const m of source.matchAll(/\brun\s+script\s+([^\n]+)/gi)) {
    if (isInsideStringLiteral(source, m.index)) continue;
    const recovered = evalExpr(stripWrappingParens(m[1].trim()), vars);
    if (recovered && !recovered.includes('<')) capturedStrings.push(recovered);
  }

  // 5. Target-artifact enumeration: a `{{"label", expr}}` list-of-pairs map
  const targets: TargetArtifact[] = [];
  for (const blockMatch of source.matchAll(/\{\{[\s\S]*?\}\}/g)) {
    const block = blockMatch[0];
    for (const pairMatch of block.matchAll(/\{\s*"([^"]+)"\s*,\s*([^}]+?)\}/g)) {
      targets.push({ label: pairMatch[1], path: evalExpr(pairMatch[2].trim(), vars) });
    }
  }

  return { capturedStrings, events, errors: [], unsupportedCalls: [], targets };
}
