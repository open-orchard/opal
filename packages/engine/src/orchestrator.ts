import type { EngineResult, EngineError, Layer, SandboxRunner, SandboxResult, Technique, TargetArtifact } from './types';
import { extractSource } from './parser';
import { extractIocs } from './iocs';
import { isLayer, guessTechnique, decodeBase64Layer } from './classifier';
import { looksLikeAppleScript, decodeAppleScript } from './applescript';
import { deriveCapabilities } from './capabilities';

function hashSource(s: string): string {
  // djb2 — small, stable key for the seen-set
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

function staticPeel(s: string): string {
  let cur = s;
  const seen = new Set<string>();
  for (let i = 0; i < 100; i++) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const inner = extractSource(cur);
    if (inner !== cur) { cur = inner; continue; }
    const decoded = decodeBase64Layer(cur);
    if (decoded !== null) { cur = decoded; continue; }
    break;
  }
  return cur;
}

export async function deobfuscate(
  input: string,
  runner: SandboxRunner,
  opts: { maxDepth?: number; timeoutMs?: number } = {},
): Promise<EngineResult> {
  const maxDepth = opts.maxDepth ?? 10;
  const timeoutMs = opts.timeoutMs ?? 2000;

  const layers: Layer[] = [];
  const iocs: EngineResult['iocs'] = [];
  const unsupportedCalls: string[] = [];
  const errors: EngineError[] = [];
  const notes: string[] = [];

  const seen = new Set<string>();
  const queue: Array<{ source: string; depth: number }> = [
    { source: extractSource(input), depth: 0 },
  ];
  let capped: { source: string; depth: number } | null = null;

  const capTexts: string[] = [];
  const targets: TargetArtifact[] = [];
  const targetKeys = new Set<string>();
  const pushTargets = (list: TargetArtifact[]) => {
    for (const t of list) {
      const key = `${t.label}|${t.path}`;
      if (!targetKeys.has(key)) { targetKeys.add(key); targets.push(t); }
    }
  };

  const iocKeys = new Set<string>();
  const pushIocs = (text: string, depth: number, source: string) => {
    for (const ioc of extractIocs(text, depth, source)) {
      const key = `${ioc.type}:${ioc.value}`;
      if (!iocKeys.has(key)) {
        iocKeys.add(key);
        iocs.push(ioc);
      }
    }
  };

  while (queue.length) {
    const { source, depth } = queue.shift()!;
    const h = hashSource(source);
    if (seen.has(h)) continue;
    seen.add(h);

    // Pick how to process this layer. Base64 blobs are DECODED (not executed);
    // AppleScript is decoded statically; everything else runs in the sandbox.
    let result: SandboxResult;
    let technique: Technique;
    try {
      const decodedB64 = decodeBase64Layer(source);
      if (looksLikeAppleScript(source)) {
        const asr = decodeAppleScript(source);
        pushTargets(asr.targets);
        result = asr;
        technique = 'applescript';
      } else if (decodedB64 !== null) {
        result = { capturedStrings: [decodedB64], events: [], errors: [], unsupportedCalls: [] };
        technique = 'base64';
      } else {
        result = await runner.run(source, { timeoutMs });
        technique = guessTechnique(source);
      }
    } catch (e: unknown) {
      errors.push({ message: e instanceof Error ? e.message : String(e), layerDepth: depth });
      continue;
    }

    for (const u of result.unsupportedCalls) if (!unsupportedCalls.includes(u)) unsupportedCalls.push(u);
    for (const msg of result.errors) errors.push({ message: msg, layerDepth: depth });

    layers.push({ depth, source, technique, output: result.capturedStrings, events: result.events });
    for (const out of result.capturedStrings) capTexts.push(out);
    for (const ev of result.events) capTexts.push(ev.detail);

    pushIocs(source, depth, 'source');
    for (const ev of result.events) pushIocs(ev.detail, depth, ev.kind);
    for (const out of result.capturedStrings) {
      pushIocs(out, depth, 'output');
      if (!isLayer(out)) continue;
      const next = extractSource(out); // unwrap an osascript `-e` wrapper; base64 stays a blob (decoded when its layer runs)
      if (depth + 1 <= maxDepth) {
        if (!seen.has(hashSource(next))) queue.push({ source: next, depth: depth + 1 });
      } else if (!capped) {
        capped = { source: next, depth: depth + 1 };
      }
    }
  }

  // Depth cap hit: statically decode the remaining (non-executing) layers so
  // the analyst still sees the final payload, clearly flagged.
  if (capped) {
    const final = staticPeel(capped.source);
    notes.push(
      `Reached the depth cap (${maxDepth}). Remaining layers were decoded statically ` +
        `(no code executed); the final payload is shown as layer ${capped.depth}.`,
    );
    layers.push({ depth: capped.depth, source: final, technique: guessTechnique(final), output: [], events: [] });
    pushIocs(final, capped.depth, 'static-decode');
  }

  for (const t of targets) capTexts.push(`${t.label} ${t.path}`);
  const capabilities = deriveCapabilities(capTexts);
  return {
    layers,
    iocs,
    unsupportedCalls,
    errors,
    notes,
    ...(capabilities.length ? { capabilities } : {}),
    ...(targets.length ? { targets } : {}),
  };
}
