import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('React tracker in-flight sends', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('flush waits for a count-triggered send already in flight', async () => {
    const state = stubSlowFetch();
    const tracker = new Tracker('dk_test', { flushAt: 1, flushIntervalMs: 60_000, retryCount: 0 });

    tracker.track(event);
    expect(state.started).toBe(1);
    await tracker.flush();

    expect(state.completed).toBe(1);
    tracker.destroy();
  });
});
