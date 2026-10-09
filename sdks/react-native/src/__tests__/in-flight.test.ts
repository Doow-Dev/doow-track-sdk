import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => {} }) },
}));
vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => {
        store.set(k, v);
      },
    },
  };
});

import { Tracker } from '../tracker';

const event = { metric: 'api_calls', quantity: 1, licenseId: 'lic_1' };

function stubSlowFetch() {
  const state = { started: 0, completed: 0 };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      state.started += 1;
      await new Promise((resolve) => setTimeout(resolve, 200));
      state.completed += 1;
      return new Response('{}', { status: 202 });
    }),
  );
  return state;
}

describe('React Native tracker in-flight sends and shutdown', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('flush waits for a count-triggered send already in flight', async () => {
    const state = stubSlowFetch();
    const tracker = new Tracker('dk_test', { flushAt: 1, flushIntervalMs: 60_000, retryCount: 0 });

    tracker.track(event);
    await vi.waitFor(() => expect(state.started).toBe(1));
    await tracker.flush();

    expect(state.completed).toBe(1);
    await tracker.destroy();
  });

  it('destroy sends the events still in the queue', async () => {
    const state = stubSlowFetch();
    const tracker = new Tracker('dk_test', { flushAt: 100, flushIntervalMs: 60_000, retryCount: 0 });

    tracker.track(event);
    await tracker.destroy();

    expect(state.completed).toBe(1);
  });
});
