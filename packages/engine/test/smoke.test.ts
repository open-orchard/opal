import { describe, it, expect } from 'vitest';
import { ENGINE_NAME } from '../src/index';

describe('engine smoke', () => {
  it('exports an engine name', () => {
    expect(ENGINE_NAME).toBe('osascript-deobfuscator-engine');
  });
});
