/**
 * @doow/track — Customer-facing usage telemetry SDK
 *
 * Quick start (telemetry):
 *   import { DoowTracker } from '@doow/track';
 *   const meter = new DoowTracker('dk_your_api_key');
 *   meter.track({ metric: 'api_calls', quantity: 1, license_id: 'lic_...' });
 *   await meter.shutdown();
 *
 * Quick start (management):
 *   import { DoowManagement } from '@doow/track';
 *   const mgmt = new DoowManagement('dk_your_api_key');
 *   const app = await mgmt.apps.create({ name: 'My SaaS' });
 *   const contract = await mgmt.contracts.create(app.id, { title: 'Plan' });
 *   const license = await mgmt.licenses.create(contract.id, { name: 'Usage' });
 *   const metric = await mgmt.metrics.create(license.id, { metric_type: 'api_calls' });
 */

// Telemetry
export { DoowTracker } from './tracker.js';
export { FileOfflineStore } from './file-offline-store.js';

// Management
export { DoowManagement, ManagementApiError } from './management.js';

// Telemetry types
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

// Management types
export type {
  DoowManagementOptions,
  App,
  CreateAppInput,
  UpdateAppInput,
  ListAppsParams,
  Contract,
  ContractType,
  CostAmortization,
  Expense,
  ListExpensesParams,
  LicenseInput,
  LicenseInContract,
  CreateContractInput,
  UpdateContractInput,
  ListContractsParams,
  License,
  LicenseType,
  CreateLicenseInput,
  UpdateLicenseInput,
  ListLicensesParams,
  Metric,
  UsageAggregationType,
  RateKind,
  EntitlementPeriod,
  CarryoverPolicy,
  CreateMetricInput,
  UpdateMetricInput,
  ListMetricsParams,
  PaginatedResponse,
  PaginationParams,
  ApiError,
} from './management-types.js';
