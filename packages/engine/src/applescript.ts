import type { SandboxResult, SandboxEvent } from './types';

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

/**
 * Resolve a `&`-joined AppleScript string expression: resolves the string
 * literals and known `set` variables it can, and renders unresolved tokens
 * (variables, calls) as `<token>` placeholders.
 */
function resolvePartialExpr(expr: string, vars: Record<string, string>): string {
  return expr
    .split('&')
    .map((raw) => {
      const part = raw.trim();
      const lit = part.match(/^"((?:[^"\\]|\\.)*)"$/);
      if (lit) return unescapeLiteral(lit[1]);
      if (Object.prototype.hasOwnProperty.call(vars, part)) return vars[part];
      return `<${part}>`;
    })
    .join('');
}

// Strip a trailing `)` left by a `(do shell script …)` wrapper (unbalanced parens). 
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
  // Strip a single layer of surrounding parens (e.g. `(system attribute "USER")`)
  const parenMatch = rhs.match(/^\(\s*([\s\S]*?)\s*\)$/);
  const inner = parenMatch ? parenMatch[1] : rhs;

  // Rule 1: system attribute "NAME"
  const sysAttr = inner.match(/^system\s+attribute\s+"([^"]+)"$/i);
  if (sysAttr) return `<${sysAttr[1]}>`;

  // Rule 2: do shell script "echo LITERAL"
  const dssRaw = rhs.match(/^\(?\s*do\s+shell\s+script\s+"((?:[^"\\]|\\.)*)"\s*\)?$/i);
  if (dssRaw) {
    const body = unescapeLiteral(dssRaw[1]);
    // `echo LITERAL` → return the literal
    const echoMatch = body.match(/^echo\s+(.*)$/);
    if (echoMatch) return echoMatch[1];
    // Other do shell script form → opaque placeholder
    return `<${varName}>`;
  }
  // Broader: any do shell script expr
  const dssAny = rhs.match(/^\(?\s*do\s+shell\s+script\s+/i);
  if (dssAny) return `<${varName}>`;

  // Rule 3: list/map literal — skip
  if (rhs.trim().startsWith('{')) return null;

  // Rule 4: partial resolution
  return resolvePartialExpr(rhs, vars);
}

/**
 * Basic, static AppleScript decoder (no execution). Resolves `set VAR to …`
 * string assignments and surfaces `do shell script …` commands
 */
export function decodeAppleScript(source: string): SandboxResult {
  const events: SandboxEvent[] = [];
  const capturedStrings: string[] = [];
  const vars: Record<string, string> = {};

  // 1. Collect `set VAR to <string expr>` (one per line).
  for (const m of source.matchAll(/\bset\s+([A-Za-z_]\w*)\s+to\s+(.+?)\s*$/gm)) {
    const v = resolveSetRhs(m[2].trim(), m[1], vars);
    if (v !== null) vars[m[1]] = v;
  }

  // 2. Surface `do shell script <expr>`: drop trailing clauses
  for (const m of source.matchAll(/\bdo\s+shell\s+script\s+(.+?)\s*$/gm)) {
    const withClauseStripped = m[1].replace(/\s+(with|without|as|in)\s+.*$/i, '').trim();
    const expr = stripWrappingParens(withClauseStripped);
    const cmd = resolvePartialExpr(expr, vars);
    events.push({ kind: 'shell', detail: cmd });
    capturedStrings.push(cmd);
  }

  return { capturedStrings, events, errors: [], unsupportedCalls: [] };
}
