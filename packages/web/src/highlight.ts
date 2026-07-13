 // Minimal, dependency-free syntax highlighter for the JS/JXA/AppleScript

const KEYWORDS = new Set([
  // JS / JXA
  'var', 'let', 'const', 'function', 'return', 'if', 'else', 'for', 'while',
  'new', 'typeof', 'true', 'false', 'null', 'undefined', 'this', 'in', 'of',
  'try', 'catch', 'finally', 'throw', 'delete', 'instanceof', 'void',
  // AppleScript
  'tell', 'application', 'do', 'shell', 'script', 'set', 'to', 'end', 'then',
  'repeat', 'display', 'dialog', 'alert', 'quoted', 'form', 'run', 'ASCII',
  'character', 'id', 'keystroke', 'JavaScript', 'with', 'without', 'as',
  'system', 'attribute', 'administrator', 'privileges', 'hidden', 'answer',
  'default', 'returned', 'text', 'process', 'exit', 'not', 'contains',
]);

// `//` and `--` only start a comment when they're not part of a URL scheme
const TOKEN_RE =
  /((?<!:)\/\/[^\n]*|--(?:$|[ \t][^\n]*))|(\/\*[\s\S]*?\*\/|\(\*[\s\S]*?\*\))|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)/g;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Tokenize `code` into an HTML string with `<span class="tok-*">`-wrapped tokens. */
export function highlightCode(code: string): string {
  let out = '';
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(code))) {
    out += escapeHtml(code.slice(last, m.index));
    const [full, comment, blockComment, str, num, word] = m;
    if (comment || blockComment) out += `<span class="tok-comment">${escapeHtml(full)}</span>`;
    else if (str) out += `<span class="tok-string">${escapeHtml(full)}</span>`;
    else if (num) out += `<span class="tok-number">${escapeHtml(full)}</span>`;
    else if (word) out += KEYWORDS.has(word) ? `<span class="tok-keyword">${escapeHtml(full)}</span>` : escapeHtml(full);
    last = TOKEN_RE.lastIndex;
  }
  out += escapeHtml(code.slice(last));
  return out;
}
