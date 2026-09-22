'use client';

import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import type { TrackEvent, TrackerOptions, DoowContextValue } from './types';

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const DEFAULT_OPTIONS: Required<Omit<TrackerOptions, 'attribution' | 'onError'>> = {
  endpoint: 'https://api.doow.co',
  enabled: true,
  debug: false,
  flushAt: 20,
  flushIntervalMs: 10000,
  maxQueueSize: 10000,
  timeoutMs: 10000,
  retryCount: 3,
  disableCompression: false,
};

class ClientTracker {
  private apiKey: string;
  private options: Required<Omit<TrackerOptions, 'attribution' | 'onError'>> & {
    attribution?: Record<string, unknown>;
    onError?: (error: Error) => void;
  };
  private queue: TrackEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private shutdown = false;

  constructor(apiKey: string, options: TrackerOptions = {}) {
    if (!apiKey.startsWith('dk_')) {
      throw new Error('API key must start with dk_');
    }
    this.apiKey = apiKey;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.startFlushTimer();
    this.setupLifecycleHooks();
  }

  private startFlushTimer(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = setInterval(() => this.flush(), this.options.flushIntervalMs);
  }

  private setupLifecycleHooks(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('beforeunload', () => this.flushSync());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushSync();
    });
  }

  private log(message: string): void {
    if (this.options.debug) console.log(`[DoowTrack] ${message}`);
  }

  track(event: TrackEvent): void {
    if (!this.options.enabled || this.shutdown) return;
    if (this.queue.length >= this.options.maxQueueSize) {
      this.log('Queue full, dropping event');
      return;
    }

    const enrichedEvent: TrackEvent = {
      ...event,
      timestamp: event.timestamp || new Date().toISOString(),
      attribution: { ...event.attribution, ...this.options.attribution },
    };

    this.queue.push(enrichedEvent);
    this.log(`Queued event: ${event.metric}`);

    if (this.queue.length >= this.options.flushAt) this.flush();
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0 || this.shutdown) return;
    const batch = [...this.queue];
    this.queue = [];
    this.log(`Flushing ${batch.length} events`);

    try {
      await this.sendWithRetry(batch);
    } catch (error) {
      this.options.onError?.(error as Error);
      this.log(`Flush failed: ${error}`);
    }
  }

  private flushSync(): void {
    if (this.queue.length === 0 || typeof navigator === 'undefined') return;
    const payload = JSON.stringify({
      events: this.queue.map((e) => ({
        event_id: generateUUID(),
        metric: e.metric,
        quantity: e.quantity,
        license_id: e.licenseId,
        unit: e.unit,
        attribution: e.attribution,
        timestamp: e.timestamp,
      })),
    });
    const blob = new Blob([payload], { type: 'application/json' });
    navigator.sendBeacon(`${this.options.endpoint}/telemetry/events`, blob);
    this.queue = [];
  }

  private async sendWithRetry(batch: TrackEvent[]): Promise<void> {
    const payload = JSON.stringify({
      events: batch.map((e) => ({
        event_id: generateUUID(),
        metric: e.metric,
        quantity: e.quantity,
        license_id: e.licenseId,
        unit: e.unit,
        attribution: e.attribution,
        timestamp: e.timestamp,
      })),
    });

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    let body: BodyInit = payload;

    if (!this.options.disableCompression && payload.length > 1024 && typeof CompressionStream !== 'undefined') {
      const stream = new Blob([payload]).stream().pipeThrough(new CompressionStream('gzip'));
      body = await new Response(stream).blob();
      headers['Content-Encoding'] = 'gzip';
    }

    for (let attempt = 0; attempt <= this.options.retryCount; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
        const response = await fetch(`${this.options.endpoint}/telemetry/events`, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (response.ok) {
          this.log('Batch sent successfully');
          return;
        }

        if (response.status === 429 || response.status >= 500) {
          await this.sleep(100 * Math.pow(2, attempt));
          continue;
        }

        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      } catch (error) {
        if (attempt === this.options.retryCount) throw error;
        await this.sleep(100 * Math.pow(2, attempt));
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  destroy(): void {
    this.shutdown = true;
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushSync();
  }
}

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
