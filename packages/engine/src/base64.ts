// Base64 helpers shared by the classifier and the Foundation shims.

// Decode a base64 string to UTF-8 text. Returns null if it cannot be decoded.
export function base64ToText(s: string): string | null {
  const clean = s.replace(/\s+/g, '');
  try {
    let bytes: Uint8Array;
    if (typeof globalThis.atob === 'function') {
      const bin = globalThis.atob(clean);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      bytes = new Uint8Array(Buffer.from(clean, 'base64'));
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

export function mostlyPrintable(s: string): boolean {
  let total = 0;
  let printable = 0;
  for (const ch of s) {
    total++;
    const c = ch.codePointAt(0)!;
    if (c === 9 || c === 10 || c === 13) {
      printable++;
    } else if (c >= 32 && c !== 0x7f && !(c >= 0x80 && c <= 0x9f) && c !== 0xfffd) {
      printable++;
    }
  }
  return total > 0 && printable / total > 0.85;
}
