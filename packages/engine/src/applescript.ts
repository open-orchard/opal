import type { SandboxResult, SandboxEvent, TargetArtifact } from './types';

/**
 * Heuristic: does this source look like AppleScript rather than JXA/JS? Keyed
 * on space-separated AppleScript constructs that never appear in JXA (which
 * uses `app.doShellScript(...)`, camelCase, no `tell application` blocks).
 */
export function looksLikeAppleScript(source: string): boolean {
  return (
    /\bdo\s+shell\s+script\b/.test(source) ||
    /\btell\s+application\b/.test(source) ||
    /\bon\s+run\b/.test(source)
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

/** Strip a trailing `)` left by a `(do shell script …)` wrapper (unbalanced parens). */
function stripWrappingParens(expr: string): string {
  let e = expr.trim();
  const count = (re: RegExp) => (e.match(re) ?? []).length;
  while (e.endsWith(')') && count(/\)/g) > count(/\(/g)) e = e.slice(0, -1).trim();
  return e;
}

// Resolve the RHS of a `set VAR to <rhs>` statement symbolically.
function resolveSetRhs(
  rhs: string,
  varName: string,
  vars: Record<string, string>,
): string | null {
  // 1: do shell script "echo LITERAL" (optionally wrapped in parens)
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

  // Rule 3: partial resolution
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
    const expr = stripWrappingParens(withClauseStripped);
    const cmd = evalExpr(expr, vars);
    events.push({ kind: 'shell', detail: cmd });
    capturedStrings.push(cmd);
  }

  // 3. display dialog / display alert → credential-phishing surface
  for (const m of source.matchAll(/\bdisplay\s+(?:dialog|alert)\s+("(?:[^"\\]|\\.)*"|[A-Za-z_]\w*)([^\n]*)/gi)) {
    if (isInsideStringLiteral(source, m.index)) continue;
    const prompt = evalTerm(m[1], vars);
    const harvests = /\bwith\s+hidden\s+answer\b/i.test(m[2]);
    events.push({ kind: 'dialog', detail: harvests ? `${prompt} [captures password]` : prompt });
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
