'use client';

import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import type { TrackEvent, TrackerOptions, DoowContextValue } from './types';
import { ClientTracker } from './client-tracker';

const DoowContext = createContext<DoowContextValue | null>(null);

export interface DoowProviderProps {
  apiKey: string;
  options?: TrackerOptions;
  children: React.ReactNode;
}

export function DoowProvider({ apiKey, options, children }: DoowProviderProps): JSX.Element {
  const trackerRef = useRef<ClientTracker | null>(null);

  if (!trackerRef.current) {
    trackerRef.current = new ClientTracker(apiKey, options);
  }

  useEffect(() => {
    return () => trackerRef.current?.destroy();
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
  if (!context) throw new Error('useDoow must be used within a DoowProvider');
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
