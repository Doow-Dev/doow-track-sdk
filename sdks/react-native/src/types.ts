export interface TrackEvent {
  metric: string;
  quantity: number;
  licenseId: string;
  unit?: string;
  attribution?: Record<string, unknown>;
  timestamp?: string;
}

export interface TrackerOptions {
  endpoint?: string;
  enabled?: boolean;
  debug?: boolean;
  flushAt?: number;
  flushIntervalMs?: number;
  maxQueueSize?: number;
  timeoutMs?: number;
  retryCount?: number;
  persistQueue?: boolean;
  attribution?: Record<string, unknown>;
  onError?: (error: Error) => void;
}

export interface DoowContextValue {
  track: (event: TrackEvent) => void;
  flush: () => Promise<void>;
  isEnabled: boolean;
}

export interface DoowProviderProps {
  apiKey: string;
  options?: TrackerOptions;
  children: React.ReactNode;
}
