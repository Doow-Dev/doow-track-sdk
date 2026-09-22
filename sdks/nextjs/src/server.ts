import type { TrackEvent, ServerTrackerOptions } from './types';

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

const DEFAULT_OPTIONS: Required<Omit<ServerTrackerOptions, 'debug'>> & { debug: boolean } = {
  endpoint: 'https://api.doow.co',
  debug: false,
  timeoutMs: 10000,
  retryCount: 3,
};

export class ServerTracker {
  private apiKey: string;
  private options: typeof DEFAULT_OPTIONS;

  constructor(apiKey: string, options: ServerTrackerOptions = {}) {
    if (!apiKey.startsWith('dk_')) {
      throw new Error('API key must start with dk_');
    }
    this.apiKey = apiKey;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  private log(message: string): void {
    if (this.options.debug) {
      console.log(`[DoowTrack:Server] ${message}`);
    }
  }

  async track(event: TrackEvent): Promise<void> {
    const enrichedEvent = {
      event_id: generateUUID(),
      metric: event.metric,
      quantity: event.quantity,
      license_id: event.licenseId,
      unit: event.unit,
      attribution: event.attribution,
      timestamp: event.timestamp || new Date().toISOString(),
    };

    this.log(`Tracking: ${event.metric}`);

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
          body: JSON.stringify({ events: [enrichedEvent] }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (response.ok) {
          this.log('Event sent successfully');
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

  async trackBatch(events: TrackEvent[]): Promise<void> {
    const enrichedEvents = events.map((event) => ({
      event_id: generateUUID(),
      metric: event.metric,
      quantity: event.quantity,
      license_id: event.licenseId,
      unit: event.unit,
      attribution: event.attribution,
      timestamp: event.timestamp || new Date().toISOString(),
    }));

    this.log(`Tracking batch: ${events.length} events`);

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
          body: JSON.stringify({ events: enrichedEvents }),
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
}

let defaultTracker: ServerTracker | null = null;

export function initServerTracker(apiKey: string, options?: ServerTrackerOptions): ServerTracker {
  defaultTracker = new ServerTracker(apiKey, options);
  return defaultTracker;
}

export function getServerTracker(): ServerTracker {
  if (!defaultTracker) {
    throw new Error('Server tracker not initialized. Call initServerTracker() first.');
  }
  return defaultTracker;
}

export async function trackServerEvent(event: TrackEvent): Promise<void> {
  return getServerTracker().track(event);
}
