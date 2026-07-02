import type { SandboxResult, SandboxEvent } from './types';
import { createFoundationStubs } from './foundation-shims';

/**
 * Run a script's decoder logic with sinks neutered, capturing what it
 * WOULD have executed.
 * Uses indirect eval so the value of the final expression (what real
 * osascript prints to stdout) is captured.
 */
export function runInSandbox(source: string): SandboxResult {
  const events: SandboxEvent[] = [];
  const errors: string[] = [];
  const unsupportedCalls: string[] = [];
  const capturedStrings: string[] = [];

  const g = globalThis as any;
  const saved: Record<string, unknown> = {};
  const had: Record<string, boolean> = {};
  const stash = (name: string, value: unknown) => {
    had[name] = name in g;
    saved[name] = g[name];
    g[name] = value;
  };

  const realEval = eval;

  const stubs = createFoundationStubs(events, unsupportedCalls);

  const push = (s: unknown) => {
    if (typeof s === 'string' && s.length > 0) capturedStrings.push(s);
  };

  try {
    stash('$', stubs.$);
    stash('ObjC', stubs.ObjC);
    stash('Application', stubs.Application);
    stash('Library', stubs.Library);
    stash('Ref', stubs.Ref);
    stash('Path', stubs.Path);
    stash('delay', () => {});

    stash('console', {
      log: (...a: unknown[]) => { const s = a.join(' '); events.push({ kind: 'console', detail: s }); push(s); },
      warn: () => {}, error: () => {}, info: () => {}, debug: () => {},
    });

    const netStub = (label: string) => (...a: unknown[]) => {
      const detail = `${label} ${a.map((x) => String(x)).join(' ')}`.trim();
      events.push({ kind: 'network', detail });
      push(detail);
      return { then() {}, catch() {}, finally() {}, ok: false, text: async () => '', json: async () => ({}) };
    };
    stash('fetch', netStub('fetch'));
    stash('importScripts', (...u: string[]) => u.forEach((x) => { events.push({ kind: 'network', detail: `importScripts ${x}` }); push(x); }));
    stash('XMLHttpRequest', function () {
      return {
        open: (m: string, u: string) => { events.push({ kind: 'network', detail: `XHR ${m} ${u}` }); push(u); },
        setRequestHeader: () => {}, send: () => {}, addEventListener: () => {},
      };
    });
    stash('WebSocket', function (u: string) { events.push({ kind: 'network', detail: `WebSocket ${u}` }); push(u); return { send: () => {}, close: () => {} }; });

    stash('eval', (s: unknown) => { const str = String(s); events.push({ kind: 'eval', detail: str }); push(str); return undefined; });

    const result = realEval.call(null, source); // indirect eval -> completion value in global scope
    if (typeof result === 'string') push(result);
    else if (result && typeof (result as any).toString === 'function') {
      const s = (result as any).toString();
      if (typeof s === 'string' && s !== '[object Object]') push(s);
    }
  } catch (e: unknown) {
    errors.push(e instanceof Error ? e.message : String(e));
  } finally {
    for (const name of Object.keys(saved)) {
      if (had[name]) g[name] = saved[name];
      else { try { delete g[name]; } catch { g[name] = undefined; } }
    }
  }

  const seen = new Set<string>();
  const deduped = capturedStrings.filter((s) => (seen.has(s) ? false : (seen.add(s), true)));
  return { capturedStrings: deduped, events, errors, unsupportedCalls };
}
