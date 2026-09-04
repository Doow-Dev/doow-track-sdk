/**
 * DoowManagement — CRUD operations for apps, contracts, licenses, and metrics
 *
 * Usage:
 *   import { DoowManagement } from '@doow/track';
 *   const mgmt = new DoowManagement('dk_your_api_key');
 *
 *   // Create an app
 *   const app = await mgmt.apps.create({ name: 'My SaaS' });
 *
 *   // Create a contract under the app
 *   const contract = await mgmt.contracts.create(app.id, { title: 'Enterprise Plan' });
 *
 *   // Create a license under the contract
 *   const license = await mgmt.licenses.create(contract.id, { name: 'API Usage' });
 *
 *   // Create a metric under the license
 *   const metric = await mgmt.metrics.create(license.id, { metric_type: 'api_calls' });
 */

import type {
  DoowManagementOptions,
  App,
  CreateAppInput,
  UpdateAppInput,
  ListAppsParams,
  Contract,
  CreateContractInput,
  UpdateContractInput,
  ListContractsParams,
  License,
  CreateLicenseInput,
  UpdateLicenseInput,
  ListLicensesParams,
  Metric,
  CreateMetricInput,
  UpdateMetricInput,
  ListMetricsParams,
  Expense,
  ListExpensesParams,
  PaginatedResponse,
  ApiError,
} from './management-types.js';

const DEFAULT_ENDPOINT = 'https://api.doow.co';
const DEFAULT_TIMEOUT = 30_000;

class ManagementApiError extends Error {
  readonly status: number;
  readonly code?: string | undefined;
  readonly details?: Record<string, unknown> | undefined;

  constructor(error: ApiError) {
    super(error.message);
    this.name = 'ManagementApiError';
    this.status = error.status;
    if (error.code !== undefined) this.code = error.code;
    if (error.details !== undefined) this.details = error.details;
  }
}

export class DoowManagement {
  private readonly _apiKey: string;
  private readonly _endpoint: string;
  private readonly _timeout: number;
  private readonly _debug: boolean;

  readonly apps: AppsClient;
  readonly contracts: ContractsClient;
  readonly licenses: LicensesClient;
  readonly metrics: MetricsClient;
  readonly expenses: ExpensesClient;

  constructor(apiKey: string, options: DoowManagementOptions = {}) {
    if (!apiKey.startsWith('dk_')) {
      console.warn(
        `[doow/management] API key must start with "dk_". Got: "${apiKey.slice(0, 10)}..."`,
      );
    }

    this._apiKey = apiKey;
    this._endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this._timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this._debug = options.debug ?? false;

    this.apps = new AppsClient(this);
    this.contracts = new ContractsClient(this);
    this.licenses = new LicensesClient(this);
    this.metrics = new MetricsClient(this);
    this.expenses = new ExpensesClient(this);
  }

  private log(message: string): void {
    if (this._debug) {
      console.log(`[doow/management] ${message}`);
    }
  }

  async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const url = new URL(`${this._endpoint}${path}`);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this._apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': '@doow/track-sdk',
    };

    this.log(`${method} ${url.pathname}${url.search}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this._timeout);

    try {
      const fetchOptions: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };
      if (body) {
        fetchOptions.body = JSON.stringify(body);
      }
      const response = await fetch(url.toString(), fetchOptions);

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorBody: ApiError;
        try {
          errorBody = (await response.json()) as ApiError;
        } catch {
          errorBody = {
            status: response.status,
            message: response.statusText || `HTTP ${response.status}`,
          };
        }
        errorBody.status = response.status;
        throw new ManagementApiError(errorBody);
      }

      if (response.status === 204) {
        return undefined as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof ManagementApiError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new ManagementApiError({
          status: 0,
          message: `Request timeout after ${this._timeout}ms`,
          code: 'TIMEOUT',
        });
      }

      throw new ManagementApiError({
        status: 0,
        message: error instanceof Error ? error.message : 'Network error',
        code: 'NETWORK_ERROR',
      });
    }
  }
}

// ─── Apps Client ───────────────────────────────────────────────────────────

class AppsClient {
  constructor(private readonly mgmt: DoowManagement) {}

  async create(input: CreateAppInput): Promise<App> {
    return this.mgmt.request<App>('POST', '/sdk/apps', input as unknown as Record<string, unknown>);
  }

  async list(params: ListAppsParams = {}): Promise<PaginatedResponse<App>> {
    return this.mgmt.request<PaginatedResponse<App>>('GET', '/sdk/apps', undefined, {
      cursor: params.cursor,
      limit: params.limit,
      name: params.name,
    });
  }

  async get(id: string): Promise<App> {
    return this.mgmt.request<App>('GET', `/sdk/apps/${id}`);
  }

  async update(id: string, input: UpdateAppInput): Promise<App> {
    return this.mgmt.request<App>(
      'PUT',
      `/sdk/apps/${id}`,
      input as unknown as Record<string, unknown>,
    );
  }

  async delete(id: string): Promise<void> {
    return this.mgmt.request<void>('DELETE', `/sdk/apps/${id}`);
  }
}

// ─── Contracts Client ──────────────────────────────────────────────────────

class ContractsClient {
  constructor(private readonly mgmt: DoowManagement) {}

  async create(appId: string, input: CreateContractInput): Promise<Contract> {
    return this.mgmt.request<Contract>(
      'POST',
      `/sdk/apps/${appId}/contracts`,
      input as unknown as Record<string, unknown>,
    );
  }

  async listByApp(
    appId: string,
    params: ListContractsParams = {},
  ): Promise<PaginatedResponse<Contract>> {
    return this.mgmt.request<PaginatedResponse<Contract>>(
      'GET',
      `/sdk/apps/${appId}/contracts`,
      undefined,
      {
        cursor: params.cursor,
        limit: params.limit,
        contract_type: params.contract_type,
      },
    );
  }

  async get(id: string): Promise<Contract> {
    return this.mgmt.request<Contract>('GET', `/sdk/contracts/${id}`);
  }

  async update(id: string, input: UpdateContractInput): Promise<Contract> {
    return this.mgmt.request<Contract>(
      'PUT',
      `/sdk/contracts/${id}`,
      input as unknown as Record<string, unknown>,
    );
  }

  async delete(id: string): Promise<void> {
    return this.mgmt.request<void>('DELETE', `/sdk/contracts/${id}`);
  }
}

// ─── Licenses Client ───────────────────────────────────────────────────────

class LicensesClient {
  constructor(private readonly mgmt: DoowManagement) {}

  async create(contractId: string, input: CreateLicenseInput): Promise<License> {
    return this.mgmt.request<License>(
      'POST',
      `/sdk/contracts/${contractId}/licenses`,
      input as unknown as Record<string, unknown>,
    );
  }

  async listByContract(
    contractId: string,
    params: ListLicensesParams = {},
  ): Promise<PaginatedResponse<License>> {
    return this.mgmt.request<PaginatedResponse<License>>(
      'GET',
      `/sdk/contracts/${contractId}/licenses`,
      undefined,
      {
        cursor: params.cursor,
        limit: params.limit,
        license_type: params.license_type,
      },
    );
  }

  async get(id: string): Promise<License> {
    return this.mgmt.request<License>('GET', `/sdk/licenses/${id}`);
  }

  async update(id: string, input: UpdateLicenseInput): Promise<License> {
    return this.mgmt.request<License>(
      'PUT',
      `/sdk/licenses/${id}`,
      input as unknown as Record<string, unknown>,
    );
  }

  async delete(id: string): Promise<void> {
    return this.mgmt.request<void>('DELETE', `/sdk/licenses/${id}`);
  }
}

// ─── Metrics Client ────────────────────────────────────────────────────────

class MetricsClient {
  constructor(private readonly mgmt: DoowManagement) {}

  async create(licenseId: string, input: CreateMetricInput): Promise<Metric> {
    return this.mgmt.request<Metric>(
      'POST',
      `/sdk/licenses/${licenseId}/metrics`,
      input as unknown as Record<string, unknown>,
    );
  }

  async listByLicense(
    licenseId: string,
    params: ListMetricsParams = {},
  ): Promise<PaginatedResponse<Metric>> {
    return this.mgmt.request<PaginatedResponse<Metric>>(
      'GET',
      `/sdk/licenses/${licenseId}/metrics`,
      undefined,
      {
        cursor: params.cursor,
        limit: params.limit,
        metric_type: params.metric_type,
      },
    );
  }

  async get(id: string): Promise<Metric> {
    return this.mgmt.request<Metric>('GET', `/sdk/metrics/${id}`);
  }

  async update(id: string, input: UpdateMetricInput): Promise<Metric> {
    return this.mgmt.request<Metric>(
      'PUT',
      `/sdk/metrics/${id}`,
      input as unknown as Record<string, unknown>,
    );
  }

  async delete(id: string): Promise<void> {
    return this.mgmt.request<void>('DELETE', `/sdk/metrics/${id}`);
  }
}

class ExpensesClient {
  constructor(private readonly mgmt: DoowManagement) {}

  async list(params: ListExpensesParams = {}): Promise<PaginatedResponse<Expense>> {
    return this.mgmt.request<PaginatedResponse<Expense>>('GET', '/sdk/expenses', undefined, {
      cursor: params.cursor,
      limit: params.limit,
      app_id: params.app_id,
      contract_id: params.contract_id,
      year: params.year,
      month: params.month,
    });
  }

  async get(id: string): Promise<Expense> {
    return this.mgmt.request<Expense>('GET', `/sdk/expenses/${id}`);
  }
}

export { ManagementApiError };
