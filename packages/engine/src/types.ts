export type Technique = 'xor' | 'base64' | 'charcode' | 'arithmetic' | 'reverse' | 'applescript' | 'plain' | 'unknown';

export interface SandboxEvent {
  kind:
    | 'jxa-call'
    | 'network'
    | 'shell'
    | 'eval'
    | 'console'
    | 'dialog'
    | 'browser-injection'
    | 'gui-scripting'
    | 'login-item'
    | 'terminal-app'
    | 'clipboard-write'
    | 'mail-compose';
  detail: string;
}

export interface SandboxResult {
  capturedStrings: string[];
  events: SandboxEvent[];
  errors: string[];
  unsupportedCalls: string[];
}

export interface SandboxRunner {
  run(source: string, opts: { timeoutMs: number }): Promise<SandboxResult>;
}

export interface Layer {
  depth: number;
  source: string;
  technique: Technique;
  output: string[];
  events: SandboxEvent[];
}

export type IOCType = 'url' | 'domain' | 'ip' | 'path' | 'command' | 'user-agent' | 'base64';

export interface IOC {
  type: IOCType;
  value: string;
  layerDepth: number;
  source: string;
  decoded?: string;
}

export interface EngineError {
  message: string;
  layerDepth: number;
}

// A behavioral capabilities heuristically derived from extracted code.
export interface Capability {
  tag: string;
  evidence: string;
}

// A target artifact enumerated from an AppleScript list-of-pairs map (e.g. a wallet/browser-data map).
export interface TargetArtifact {
  label: string;
  path: string;
}

export interface EngineResult {
  layers: Layer[];
  iocs: IOC[];
  unsupportedCalls: string[];
  errors: EngineError[];
  /** Advisory messages (e.g. depth-cap reached, static decode applied). */
  notes?: string[];
  /** Behavioral capabilities (TTPs) derived from extracted code. */
  capabilities?: Capability[];
  /** Target artifacts enumerated from list-maps (paths to be stolen). */
  targets?: TargetArtifact[];
}
