/**
 * Debug logging — gated behind __DOOW_DEBUG__ compile-time flag.
 * In production builds (NODE_ENV=production), __DOOW_DEBUG__ is replaced
 * with `false` by rollup-plugin-replace, and tree-shaking eliminates
 * all debug branches at zero cost.
 *
 * In test/dev builds, __DOOW_DEBUG__ is `true`, enabling debug output
 * when the `debug` runtime option is also true.
 */
declare const __DOOW_DEBUG__: boolean;

export type DebugLogger = {
  log: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
};

export function createDebugLogger(enabled: boolean): DebugLogger {
  if (!__DOOW_DEBUG__) {
    // In production builds this branch is tree-shaken away entirely
    return { log: () => undefined, warn: () => undefined };
  }

  if (!enabled) {
    return { log: () => undefined, warn: () => undefined };
  }

  return {
    log: (msg: string, ...args: unknown[]): void => {
      // eslint-disable-next-line no-console
      console.warn(`[doow/track] ${msg}`, ...args);
    },
    warn: (msg: string, ...args: unknown[]): void => {
      console.warn(`[doow/track:warn] ${msg}`, ...args);
    },
  };
}
