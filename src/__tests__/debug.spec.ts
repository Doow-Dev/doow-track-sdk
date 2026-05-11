import { describe, it, expect, vi } from 'vitest';
import { createDebugLogger } from '../debug.js';

describe('createDebugLogger', () => {
  it('returns no-op logger when disabled', () => {
    const logger = createDebugLogger(false);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logger.log('test');
    logger.warn('test');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('returns active logger when enabled (in debug build)', () => {
    const logger = createDebugLogger(true);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logger.log('hello');
    // In test build __DOOW_DEBUG__ is true, so logger should be active
    // Implementation uses template literal: `[doow/track] ${msg}` — single string arg
    expect(warnSpy).toHaveBeenCalledWith('[doow/track] hello');
    warnSpy.mockRestore();
  });

  it('logger.warn prefixes with warn tag', () => {
    const logger = createDebugLogger(true);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logger.warn('something wrong');
    expect(warnSpy).toHaveBeenCalledWith('[doow/track:warn] something wrong');
    warnSpy.mockRestore();
  });
});
