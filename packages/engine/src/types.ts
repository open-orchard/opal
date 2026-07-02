export type Technique = 'xor' | 'base64' | 'charcode' | 'reverse' | 'applescript' | 'plain' | 'unknown';

export interface SandboxEvent {
  kind: 'jxa-call' | 'network' | 'shell' | 'eval' | 'console';
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

export interface EngineResult {
  layers: Layer[];
  iocs: IOC[];
  unsupportedCalls: string[];
  errors: EngineError[];
  notes?: string[];
}
