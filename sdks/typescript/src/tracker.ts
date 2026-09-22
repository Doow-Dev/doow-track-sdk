/**
 * S76: DoowTracker — public API surface
 *
 * The customer-facing class. Four lines to start emitting:
 *
 *   import { DoowTracker } from '@doow/track';
 *   const meter = new DoowTracker('dk_...');
 *   meter.track({ metric: 'api_calls', quantity: 1, license_id: '...' });
 *   await meter.shutdown();
 */
import { generateUUID } from './uuid.js';
import { createDebugLogger } from './debug.js';
import { Exporter } from './exporter.js';
import type { ExporterConfig } from './exporter.js';
import { EventProcessor } from './event-processor.js';
import type { ProcessorConfig } from './event-processor.js';
import type { DoowTrackerOptions, SdkError, SerializedEvent, TrackEvent } from './types.js';

// ─── Defaults ──────────────────────────────────────────────────────────────

const DEFAULTS = {
  endpoint: 'https://api.doow.co',
  enabled: true,
  debug: false,
  flushAt: 20,
  flushInterval: 10_000,
  maxPayloadBytes: 450 * 1024,
  maxQueueSize: 10_000,
  timeout: 10_000,
  retryCount: 3,
  disableCompression: false,
  maxConcurrentFlushes: 30,
  shutdownTimeout: 5_000,
} as const;

// ─── Env var parsing ───────────────────────────────────────────────────────

function resolveEnvOverrides(opts: DoowTrackerOptions): DoowTrackerOptions {
  const env: NodeJS.ProcessEnv | undefined =
    typeof process !== 'undefined' ? process.env : undefined;
  // Spread opts without creating explicit undefined keys that would override DEFAULTS
  const result = { ...opts };

  if (env?.DOOW_TRACK_ENDPOINT) result.endpoint = env.DOOW_TRACK_ENDPOINT;
  if (env?.DOOW_TRACK_DISABLED === 'true') result.enabled = false;
  if (env?.DOOW_TRACK_DEBUG === 'true') result.debug = true;
  if (env?.DOOW_TRACK_FLUSH_AT !== undefined) {
    const n = parseInt(env.DOOW_TRACK_FLUSH_AT, 10);
    if (!isNaN(n) && n > 0) result.flushAt = n;
  }
  if (env?.DOOW_TRACK_FLUSH_INTERVAL !== undefined) {
    const n = parseInt(env.DOOW_TRACK_FLUSH_INTERVAL, 10);
    if (!isNaN(n) && n > 0) result.flushInterval = n;
  }
  if (env?.DOOW_TRACK_ATTRIBUTION !== undefined) {
    try {
      result.attribution = JSON.parse(env.DOOW_TRACK_ATTRIBUTION) as Record<string, string>;
    } catch {
      /* keep opts.attribution */
    }
  }

  return result;
}

// ─── DoowTracker ───────────────────────────────────────────────────────────

export class DoowTracker {
  private readonly _apiKey: string;
  private readonly _options: Required<
    Pick<
      DoowTrackerOptions,
      | 'endpoint'
      | 'enabled'
      | 'debug'
      | 'flushAt'
      | 'flushInterval'
      | 'maxPayloadBytes'
      | 'maxQueueSize'
      | 'timeout'
      | 'retryCount'
      | 'disableCompression'
      | 'maxConcurrentFlushes'
      | 'shutdownTimeout'
    >
  > &
    DoowTrackerOptions;
  private readonly _processor: EventProcessor | null;
  private readonly _exporter: Exporter | null;
  private _shutdownCalled = false;
  private _sigHandlers: { sigterm: () => void; beforeExit: () => void } | null = null;

  constructor(apiKey: string, options: DoowTrackerOptions = {}) {
    // Validate API key prefix
    const envApiKey =
      typeof process !== 'undefined' ? (process.env['DOOW_TRACK_API_KEY'] ?? apiKey) : apiKey;

    if (!envApiKey.startsWith('dk_')) {
      console.warn(
        `[doow/track] API key must start with "dk_". Got: "${envApiKey.slice(0, 10)}..."`,
      );
    }

    this._apiKey = envApiKey;

    // Merge options with env var overrides (env takes precedence)
    const merged = resolveEnvOverrides(options);

    // Log unknown options in debug mode
    const knownKeys = new Set([
      'endpoint',
      'enabled',
      'attribution',
      'debug',
      'flushAt',
      'flushInterval',
      'maxPayloadBytes',
      'maxQueueSize',
      'timeout',
      'retryCount',
      'disableCompression',
      'onError',
      'beforeSend',
      'beforeFlush',
      'transport',
      'offlineStore',
      'maxConcurrentFlushes',
      'shutdownTimeout',
    ]);

    this._options = {
      ...DEFAULTS,
      ...merged,
    };

    const unknownKeys = Object.keys(options).filter((k) => !knownKeys.has(k));

    const debugLogger = createDebugLogger(this._options.debug ?? false);

    if (unknownKeys.length > 0) {
      debugLogger.warn(`Unknown init options ignored: ${unknownKeys.join(', ')}`);
    }

    // If disabled — complete no-op, no buffers allocated
    if (!this._options.enabled) {
      debugLogger.log('SDK disabled — all operations are no-ops');
      this._processor = null;
      this._exporter = null;
      return;
    }

    const onError: (e: SdkError) => void =
      this._options.onError ??
      ((e: SdkError): void => console.warn(`[doow/track] ${e.kind}: ${e.message}`));

    const exporterConfig: ExporterConfig = {
      endpoint: this._options.endpoint,
      apiKey: this._apiKey,
      timeout: this._options.timeout,
      retryCount: this._options.retryCount,
      disableCompression: this._options.disableCompression,
      maxConcurrentFlushes: this._options.maxConcurrentFlushes,
      onError,
      debug: debugLogger,
    };
    if (this._options.transport) exporterConfig.transport = this._options.transport;
    if (this._options.offlineStore) exporterConfig.offlineStore = this._options.offlineStore;
    this._exporter = new Exporter(exporterConfig);

    const processorConfig: ProcessorConfig = {
      flushAt: this._options.flushAt,
      flushInterval: this._options.flushInterval,
      maxPayloadBytes: this._options.maxPayloadBytes,
      maxQueueSize: this._options.maxQueueSize,
      debug: debugLogger,
    };
    if (this._options.beforeSend) processorConfig.beforeSend = this._options.beforeSend;
    if (this._options.beforeFlush) processorConfig.beforeFlush = this._options.beforeFlush;
    this._processor = new EventProcessor(processorConfig, this._exporter);

    if (typeof process !== 'undefined') {
      const sigterm = (): void => {
        void this.shutdown();
      };
      const beforeExit = (): void => {
        void this.shutdown();
      };

      process.setMaxListeners(process.getMaxListeners() + 2);
      process.on('SIGTERM', sigterm);
      process.on('beforeExit', beforeExit);

      this._sigHandlers = { sigterm, beforeExit };
    }
  }

  /**
   * Track a usage event.
   * - Generates UUID v4 event_id at call time
   * - Merges SDK-level attribution defaults
   * - Enqueues to EventProcessor
   * - No-op if SDK is disabled or stopped
   */
  track(event: TrackEvent): void {
    if (!this._processor || !this._exporter) return; // disabled
    if (this._exporter.stopped) return; // auth failure
    if (this._shutdownCalled) return;

    const serialized: SerializedEvent = {
      ...event,
      event_id: generateUUID(),
      timestamp: event.timestamp ?? new Date().toISOString(),
      attribution: {
        ...(this._options.attribution ?? {}),
        ...(event.attribution ?? {}),
      },
      kind: event.kind ?? 'USAGE',
    };

    // Fire-and-forget enqueue — errors surface via onError
    void this._processor.enqueue(serialized);
  }

  /**
   * Manually flush the current buffer.
   * Returns a Promise that resolves when the flush completes.
   */
  async flush(): Promise<void> {
    if (!this._processor) return;
    await this._processor.flush();
  }

  /**
   * Drain all pending events and shut down.
   * Registers SIGTERM + beforeExit handlers automatically.
   * Best-effort — hard kill loses buffered events.
   */
  async shutdown(timeout?: number): Promise<void> {
    if (this._shutdownCalled) return;
    this._shutdownCalled = true;

    // Remove signal handlers
    if (this._sigHandlers && typeof process !== 'undefined') {
      process.removeListener('SIGTERM', this._sigHandlers.sigterm);
      process.removeListener('beforeExit', this._sigHandlers.beforeExit);
      process.setMaxListeners(Math.max(0, process.getMaxListeners() - 2));
      this._sigHandlers = null;
    }

    if (!this._processor) return;

    const timeoutMs = timeout ?? this._options.shutdownTimeout;

    const shutdownPromise = this._processor.shutdown();
    const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));

    await Promise.race([shutdownPromise, timeoutPromise]);
  }

  /** True if the SDK is enabled */
  get enabled(): boolean {
    return !!this._processor;
  }

  /** True if auth has failed and SDK stopped emitting */
  get stopped(): boolean {
    return this._exporter?.stopped ?? false;
  }

  /** S79: True if a per-category rate limit is currently active */
  get rateLimited(): boolean {
    return this._exporter?.rateLimited ?? false;
  }

  // ─── S81: Serverless wrappers ─────────────────────────────────────────────

  /**
   * Wrap an AWS Lambda handler.
   * Sets flushAt=1 internally, calls shutdown() in a finally block.
   *
   * @example
   * export const handler = meter.withLambda(async (event, context) => {
   *   meter.track({ ... });
   *   return { statusCode: 200 };
   * });
   */
  withLambda<TEvent = unknown, TContext = unknown, TResult = unknown>(
    handler: (event: TEvent, context: TContext) => Promise<TResult>,
  ): (event: TEvent, context: TContext) => Promise<TResult> {
    // Override flushAt to 1 so every track() flushes immediately
    if (this._processor) {
      this._processor.setFlushAt(1);
    }
    return async (event: TEvent, context: TContext): Promise<TResult> => {
      try {
        return await handler(event, context);
      } finally {
        await this.flush();
      }
    };
  }

  /**
   * Wrap a Vercel serverless function handler.
   * Sets flushAt=1 internally, calls flush() in a finally block.
   */
  withVercel<TRequest = unknown, TResponse = unknown>(
    handler: (req: TRequest, res: TResponse) => Promise<void>,
  ): (req: TRequest, res: TResponse) => Promise<void> {
    if (this._processor) {
      this._processor.setFlushAt(1);
    }
    return async (req: TRequest, res: TResponse): Promise<void> => {
      try {
        await handler(req, res);
      } finally {
        await this.flush();
      }
    };
  }

  /**
   * Wrap an Azure Function handler.
   * Sets flushAt=1 internally, calls flush() in a finally block.
   */
  withAzureFunction<TContext = unknown, TInput = unknown, TOutput = unknown>(
    handler: (context: TContext, input: TInput) => Promise<TOutput>,
  ): (context: TContext, input: TInput) => Promise<TOutput> {
    if (this._processor) {
      this._processor.setFlushAt(1);
    }
    return async (context: TContext, input: TInput): Promise<TOutput> => {
      try {
        return await handler(context, input);
      } finally {
        await this.flush();
      }
    };
  }
}
