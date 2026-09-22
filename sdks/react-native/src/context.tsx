import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Tracker } from './tracker';
import type { TrackEvent, TrackerOptions, DoowContextValue, DoowProviderProps } from './types';

const DoowContext = createContext<DoowContextValue | null>(null);

export function DoowProvider({ apiKey, options, children }: DoowProviderProps): JSX.Element {
  const trackerRef = useRef<Tracker | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const tracker = new Tracker(apiKey, options);
    trackerRef.current = tracker;

    tracker.init().then(() => setReady(true));

    return () => {
      tracker.destroy();
    };
  }, [apiKey]);

  const value = useMemo<DoowContextValue>(
    () => ({
      track: (event: TrackEvent) => trackerRef.current?.track(event),
      flush: () => trackerRef.current?.flush() ?? Promise.resolve(),
      isEnabled: options?.enabled !== false,
    }),
    [options?.enabled]
  );

  if (!ready) return null as any;

  return <DoowContext.Provider value={value}>{children}</DoowContext.Provider>;
}

export function useDoow(): DoowContextValue {
  const context = useContext(DoowContext);
  if (!context) {
    throw new Error('useDoow must be used within a DoowProvider');
  }
  return context;
}

export function useTrackEvent() {
  const { track } = useDoow();
  return track;
}

export function useTrackOnMount(event: TrackEvent): void {
  const { track } = useDoow();
  const tracked = useRef(false);

  useEffect(() => {
    if (!tracked.current) {
      track(event);
      tracked.current = true;
    }
  }, []);
}

export function useTrackOnFocus(
  navigation: { addListener: (event: string, callback: () => void) => () => void },
  event: TrackEvent
): void {
  const { track } = useDoow();

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      track(event);
    });
    return unsubscribe;
  }, [navigation, event, track]);
}
