import type { SandboxEvent } from './types';
import { base64ToText } from './base64';

 // Build a recording JXA Foundation environment.
export function createFoundationStubs(events: SandboxEvent[], unsupported: string[]) {
  const note = (path: string) => {
    events.push({ kind: 'jxa-call', detail: path });
    if (!unsupported.includes(path)) unsupported.push(path);
  };

  // A node carries an optional decoded string value through the chain.
  const makeProxy = (path: string, value?: string): any => {
    const target: any = function () {};
    target.__value = value;
    return new Proxy(target, {
      get(t: any, prop: string | symbol) {
        if (typeof prop === 'symbol') return undefined;
        // Internal value access must return the raw stored value, not another
        // proxy — the base64 recipe and ObjC.unwrap both read `.__value`.
        if (prop === '__value') return t.__value;
        if (prop === 'js' || prop === 'UTF8String') return t.__value;
        if (prop === 'toString') return () => (t.__value ?? `[${path}]`);
        return makeProxy(path ? `${path}.${String(prop)}` : String(prop), t.__value);
      },
      apply(t: any, _thisArg, args: any[]) {
        const method = path.split('.').pop() ?? '';
        if (method.startsWith('initWithBase64') && typeof args[0] === 'string') {
          const decoded = base64ToText(args[0]) ?? ''; // malformed base64 -> empty
          return makeProxy(`${path}<data>`, decoded);
        }
        if (method.startsWith('initWithData') && args[0] && (args[0] as any).__value !== undefined) {
          return makeProxy(`${path}<string>`, (args[0] as any).__value);
        }
        if (method === 'URLWithString' && typeof args[0] === 'string') {
          return makeProxy(`${path}<url>`, args[0]);
        }
        if (/^(?:dataTaskWith|uploadTaskWith|downloadTaskWith)/.test(method)) {
          const arg0 = args[0];
          const url = arg0 && (arg0 as any).__value !== undefined ? (arg0 as any).__value : String(arg0 ?? '');
          events.push({ kind: 'network', detail: `NSURLSession ${method} ${url}`.trim() });
          return makeProxy(`${path}<task>`, undefined);
        }
        note(`${path}()`);
        return makeProxy(path, t.__value);
      },
    });
  };

  const $ = makeProxy('$');

  const ObjC = {
    import: (m: string) => events.push({ kind: 'jxa-call', detail: `ObjC.import(${m})` }),
    unwrap: (x: any) => (x && x.__value !== undefined ? x.__value : (note('ObjC.unwrap'), undefined)),
    wrap: (x: any) => x,
  };

  const Application = (name?: string): any => {
    const appPath = `Application(${name ?? ''})`;
    return new Proxy({}, {
      get(_t, prop: string | symbol) {
        if (typeof prop === 'symbol') return undefined;
        return (...a: any[]) => {
          if (prop === 'doShellScript') {
            events.push({ kind: 'shell', detail: String(a[0]) });
            return String(a[0]);
          }
          const detail = `${appPath}.${String(prop)}(${a.map((x) => JSON.stringify(x)).join(',')})`;
          note(detail);
          return undefined;
        };
      },
    });
  };

  const Library = (name?: string) => Application(name);
  const Ref = () => ({});
  const Path = (p: string) => ({ toString: () => p });

  return { $, ObjC, Application, Library, Ref, Path };
}
