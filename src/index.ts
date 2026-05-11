/**
 * @doow/track — Customer-facing usage telemetry SDK
 *
 * Quick start:
 *   import { DoowTracker } from '@doow/track';
 *   const meter = new DoowTracker('dk_your_api_key');
 *   meter.track({ metric: 'api_calls', quantity: 1, license_id: 'lic_...' });
 *   await meter.shutdown();
 */

export { DoowTracker } from './tracker.js';
export { FileOfflineStore } from './file-offline-store.js';

export type {
  TrackEvent,
  SerializedEvent,
  BatchPayload,
  DoowTrackerOptions,
  SdkError,
  SdkErrorKind,
  RateLimit,
  OfflineStore,
  SerializedBatch,
  CustomTransport,
  TransportPayload,
  TransportResponse,
  PartialAcceptResponse,
} from './types.js';
