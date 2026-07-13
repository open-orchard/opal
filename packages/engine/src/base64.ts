// Base64 helpers shared by the classifier and the Foundation shims.

function base64ToBytes(s: string): Uint8Array | null {
  const clean = s.replace(/\s+/g, '');
  try {
    if (typeof globalThis.atob === 'function') {
      const bin = globalThis.atob(clean);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }
    return new Uint8Array(Buffer.from(clean, 'base64'));
  } catch {
    return null;
  }
}

/** Decode a base64 string to UTF-8 text. Returns null if it cannot be decoded. */
export function base64ToText(s: string): string | null {
  const bytes = base64ToBytes(s);
  if (!bytes) return null;
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

function isGzipMagic(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

// Gunzip via the standard Compression Streams API
async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as any]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}


 // Decode a base64 string to UTF-8 text, transparently gunzipping first if the
 // decoded bytes carry the gzip magic header (`1f 8b`)
 
export async function base64ToTextGunzipped(s: string): Promise<string | null> {
  const bytes = base64ToBytes(s);
  if (!bytes) return null;
  try {
    const plain = isGzipMagic(bytes) ? await gunzip(bytes) : bytes;
    return new TextDecoder('utf-8', { fatal: false }).decode(plain);
  } catch {
    return null;
  }
}


 // If `s` is a raw byte string carrying the gzip magic header (as real `atob`
 // returns it — one JS char per byte, 0-255), gunzip and UTF-8-decode it
export async function gunzipCapturedString(s: string): Promise<string> {
  if (s.length < 3 || s.charCodeAt(0) !== 0x1f || s.charCodeAt(1) !== 0x8b) return s;
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0xff) return s; // not a raw-byte string; leave untouched
    bytes[i] = c;
  }
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(await gunzip(bytes));
  } catch {
    return s;
  }
}


 // True if the string is mostly printable text.
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
