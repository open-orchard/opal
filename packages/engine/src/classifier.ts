import type { Technique } from './types';
import { base64ToText, base64ToTextGunzipped, mostlyPrintable } from './base64';
import { looksLikeAppleScript } from './applescript';

const BASE64_ONLY = /^[A-Za-z0-9+/\s]+={0,2}$/;

export async function isLayer(s: string): Promise<boolean> {
  const t = s.trim();
  if (!t) return false;
  if (/\bosascript\b/.test(t) || /\beval\b/.test(t) || /do shell script/i.test(t)) return true;
  return (await decodeBase64Layer(t)) !== null;
}

 // If `s` is a base64 blob that decodes (optionally gunzipping first, #39) to
 // mostly-printable text, return the decoded text; otherwise null. 
export async function decodeBase64Layer(s: string): Promise<string | null> {
  const t = s.trim();
  if (t.length < 40 || !BASE64_ONLY.test(t)) return null;
  const decoded = await base64ToTextGunzipped(t);
  if (decoded && mostlyPrintable(decoded)) return decoded;
  return null;
}

export function decodeBase64LayerSync(s: string): string | null {
  const t = s.trim();
  if (t.length < 40 || !BASE64_ONLY.test(t)) return null;
  const decoded = base64ToText(t);
  if (decoded && mostlyPrintable(decoded)) return decoded;
  return null;
}

export function guessTechnique(source: string): Technique {
  if (looksLikeAppleScript(source)) return 'applescript';
  if (/fromCharCode/.test(source) && /\^/.test(source)) return 'xor';
  if (/fromCharCode/.test(source) && /\[[^\]\n]*\]\s*-\s*[A-Za-z0-9_]/.test(source)) return 'arithmetic';
  if (/fromCharCode/.test(source)) return 'charcode';
  if (/\batob\b|base64|Base64/.test(source)) return 'base64';
  if (/\.reverse\s*\(\)/.test(source)) return 'reverse';
  if (source.trim().length) return 'plain';
  return 'unknown';
}
