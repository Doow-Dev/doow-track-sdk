import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { Tracker } from './tracker';
import type { TrackEvent, TrackerOptions, DoowContextValue } from './types';

const DoowContext = createContext<DoowContextValue | null>(null);

export interface DoowProviderProps {
  apiKey: string;
  options?: TrackerOptions;
  children: React.ReactNode;
}

export function DoowProvider({ apiKey, options, children }: DoowProviderProps): JSX.Element {
  const trackerRef = useRef<Tracker | null>(null);

  if (!trackerRef.current) {
    trackerRef.current = new Tracker(apiKey, options);
  }

  useEffect(() => {
    return () => {
      trackerRef.current?.destroy();
    };
  }, []);

  const value = useMemo<DoowContextValue>(
    () => ({
      track: (event: TrackEvent) => trackerRef.current?.track(event),
      flush: () => trackerRef.current?.flush() ?? Promise.resolve(),
      isEnabled: options?.enabled !== false,
    }),
    [options?.enabled]
  );

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

export function useTrackOnChange<T>(
  value: T,
  getEvent: (value: T) => TrackEvent | null
): void {
  const { track } = useDoow();
  const prevValue = useRef<T>(value);

  useEffect(() => {
    if (value !== prevValue.current) {
      const event = getEvent(value);
      if (event) track(event);
      prevValue.current = value;
    }
  }, [value, getEvent, track]);
}
