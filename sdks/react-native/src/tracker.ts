import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TrackEvent, TrackerOptions } from './types';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const STORAGE_KEY = '@doow/track/queue';

const DEFAULT_OPTIONS: Required<Omit<TrackerOptions, 'attribution' | 'onError'>> = {
  endpoint: 'https://api.doow.co',
  enabled: true,
  debug: false,
  flushAt: 20,
  flushIntervalMs: 10000,
  maxQueueSize: 10000,
  timeoutMs: 10000,
  retryCount: 3,
  persistQueue: true,
};

export class Tracker {
  private apiKey: string;
  private options: Required<Omit<TrackerOptions, 'attribution' | 'onError'>> & {
    attribution?: Record<string, unknown>;
    onError?: (error: Error) => void;
  };
  private queue: TrackEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private shutdown = false;
  private appStateSubscription: { remove: () => void } | null = null;

  constructor(apiKey: string, options: TrackerOptions = {}) {
    if (!apiKey.startsWith('dk_')) {
      throw new Error('API key must start with dk_');
    }
    this.apiKey = apiKey;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async init(): Promise<void> {
    if (this.options.persistQueue) {
      await this.loadQueue();
    }
    this.startFlushTimer();
    this.setupAppStateListener();
  }

  private async loadQueue(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.queue = JSON.parse(stored);
        this.log(`Loaded ${this.queue.length} events from storage`);
      }
    } catch (error) {
      this.log(`Failed to load queue: ${error}`);
    }
  }

  private async persistQueue(): Promise<void> {
    if (!this.options.persistQueue) return;
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
    } catch (error) {
      this.log(`Failed to persist queue: ${error}`);
    }
  }

  private startFlushTimer(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = setInterval(() => this.flush(), this.options.flushIntervalMs);
  }

  private setupAppStateListener(): void {
    this.appStateSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'background' || state === 'inactive') {
        this.flush();
      }
    });
  }

  private log(message: string): void {
    if (this.options.debug) {
      console.log(`[DoowTrack] ${message}`);
    }
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
    this.persistQueue();
    this.log(`Queued event: ${event.metric}`);

    if (this.queue.length >= this.options.flushAt) {
      this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0 || this.shutdown) return;

    const batch = [...this.queue];
    this.queue = [];
    await this.persistQueue();

    this.log(`Flushing ${batch.length} events`);

    try {
      await this.sendWithRetry(batch);
    } catch (error) {
      this.queue = [...batch, ...this.queue];
      await this.persistQueue();
      this.options.onError?.(error as Error);
      this.log(`Flush failed: ${error}`);
    }
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

    for (let attempt = 0; attempt <= this.options.retryCount; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

        const response = await fetch(`${this.options.endpoint}/telemetry/events`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: payload,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (response.ok) {
          this.log('Batch sent successfully');
          return;
        }

        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 100 * Math.pow(2, attempt);
          await this.sleep(delay);
          continue;
        }

        if (response.status >= 500) {
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

  async destroy(): Promise<void> {
    this.shutdown = true;
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.appStateSubscription?.remove();
    await this.flush();
  }
}
