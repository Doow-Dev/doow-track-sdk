/**
 * Types for SDK Management API (CRUD operations for apps, contracts, licenses, metrics)
 */

// ─── Pagination ────────────────────────────────────────────────────────────

export interface PaginationParams {
  cursor?: string;
  limit?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  cursor?: string;
  has_more: boolean;
}

// ─── Apps ──────────────────────────────────────────────────────────────────

export interface CreateAppInput {
  name: string;
  description?: string;
  website?: string;
  logo_url?: string;
  categories?: string[];
}

export interface UpdateAppInput {
  name?: string;
  description?: string;
  website?: string;
  logo_url?: string;
  categories?: string[];
}

export interface App {
  id: string;
  name: string;
  description?: string;
  website?: string;
  logo_url?: string;
  categories?: string[];
  saas_application_id: string;
  created_at: string;
  updated_at: string;
}

export interface ListAppsParams extends PaginationParams {
  name?: string;
}

// ─── Contracts ─────────────────────────────────────────────────────────────

export type ContractType = 'PAY_AS_YOU_GO' | 'ENTERPRISE' | 'UNKNOWN';

export type CostAmortization = 'PRORATA' | 'MONTHS' | 'QUARTER' | 'YEARS';

export interface Expense {
  id: string;
  app_id: string | null;
  contract_id: string | null;
  license_id: string | null;
  total: number;
  date: string;
  month: number;
  year: number;
  description: string | null;
  transaction_id: string | null;
  vendor: string | null;
  payment_channel: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface ListExpensesParams extends PaginationParams {
  app_id?: string;
  contract_id?: string;
  year?: number;
  month?: number;
}

/**
 * Input for creating a license inline with a contract.
 *
 * SDK only supports USAGE_BASED licenses — SEAT_BASED must be created via UI.
 * total_cost is optional (calculated from usage metrics).
 */
export interface LicenseInput {
  name: string;
  /** Defaults to USAGE_BASED. SDK only supports USAGE_BASED. */
  license_type?: LicenseType;
  seats?: number;
  price_per_seat?: number;
  total_cost?: number;
  discount?: Record<string, unknown>;
  discount_amount?: number;
  discounted_cost?: number;
  original_cost?: number;
  tenure?: number;
  seats_included_in_base_plan?: number;
}

/**
 * License in contract response. Uses AllLicenseType since responses may include
 * UI-created SEAT_BASED licenses.
 */
export interface LicenseInContract {
  id: string;
  name: string;
  license_type: AllLicenseType;
  seats?: number;
  price_per_seat?: number;
  total_cost?: number;
  discount?: Record<string, unknown>;
  discount_amount?: number;
  discounted_cost?: number;
  original_cost?: number;
  tenure?: number;
  seats_included_in_base_plan?: number;
}

export interface CreateContractInput {
  title?: string;
  contract_type?: ContractType;
  start_date?: string;
  end_date?: string;
  currency?: string;
  cost?: number;
  cost_break_down?: Record<string, unknown>;
  cost_amortization?: CostAmortization;
  add_ons?: Record<string, unknown>;
  add_ons_total_cost?: number;
  total_contract_cost?: number;
  total_discount_amount?: number;
  total_original_cost?: number;
  licenses: LicenseInput[];
  expense_ids?: string[];
}

export interface UpdateContractInput {
  title?: string;
  contract_type?: ContractType;
  start_date?: string;
  end_date?: string;
  currency?: string;
  cost?: number;
  cost_break_down?: Record<string, unknown>;
  cost_amortization?: CostAmortization;
  add_ons?: Record<string, unknown>;
  add_ons_total_cost?: number;
  total_contract_cost?: number;
  total_discount_amount?: number;
  total_original_cost?: number;
}

export interface Contract {
  id: string;
  app_id: string;
  title: string;
  contract_type: ContractType;
  start_date?: string;
  end_date?: string;
  currency?: string;
  cost?: number;
  cost_break_down?: Record<string, unknown>;
  cost_amortization?: CostAmortization;
  add_ons?: Record<string, unknown>;
  add_ons_total_cost?: number;
  total_contract_cost?: number;
  total_discount_amount?: number;
  total_original_cost?: number;
  licenses?: LicenseInContract[];
  expenses?: Expense[];
  created_at: string;
  updated_at: string;
}

export interface ListContractsParams extends PaginationParams {
  contract_type?: ContractType;
}

// ─── Licenses ──────────────────────────────────────────────────────────────

/**
 * License types for SDK creation. SDK only supports USAGE_BASED.
 * SEAT_BASED licenses must be created via the UI.
 */
export type LicenseType = 'USAGE_BASED';

/**
 * All license types (for responses that may include UI-created licenses)
 */
export type AllLicenseType = 'USAGE_BASED' | 'SEAT_BASED' | 'PREPAID_CREDITS' | 'FLAT_RATE';

export interface CreateLicenseInput {
  name: string;
  license_type?: LicenseType;
  seats?: number;
  price_per_seat?: number;
  total_cost?: number;
  discount?: Record<string, unknown>;
  discount_amount?: number;
  discounted_cost?: number;
  original_cost?: number;
  tenure?: number;
  seats_included_in_base_plan?: number;
}

export interface UpdateLicenseInput {
  name?: string;
  license_type?: LicenseType;
  seats?: number;
  price_per_seat?: number;
  total_cost?: number;
  discount?: Record<string, unknown>;
  discount_amount?: number;
  discounted_cost?: number;
  original_cost?: number;
  tenure?: number;
  seats_included_in_base_plan?: number;
}

/**
 * License response. Uses AllLicenseType since responses may include
 * UI-created SEAT_BASED licenses.
 */
export interface License {
  id: string;
  contract_id: string;
  name: string;
  license_type: AllLicenseType;
  seats?: number;
  price_per_seat?: number;
  total_cost?: number;
  discount?: Record<string, unknown>;
  discount_amount?: number;
  discounted_cost?: number;
  original_cost?: number;
  tenure?: number;
  seats_included_in_base_plan?: number;
}

export interface ListLicensesParams extends PaginationParams {
  license_type?: AllLicenseType;
}

// ─── Metrics ───────────────────────────────────────────────────────────────

export type UsageAggregationType = 'SUM' | 'MAX' | 'CUMULATIVE';

export type RateKind = 'PER_UNIT' | 'FLAT_FEE' | 'PER_SEAT' | 'TIERED' | 'VOLUME';

export type EntitlementPeriod = 'MONTHLY' | 'YEARLY' | 'QUARTERLY' | 'WEEKLY' | 'DAILY' | 'ONE_TIME';

export type CarryoverPolicy = 'EXPIRE_AT_PERIOD_END' | 'ROLLOVER' | 'ROLLOVER_CAPPED';

export interface CreateMetricInput {
  metric_type: string;
  usage_aggregation_type?: UsageAggregationType;
  rate_kind?: RateKind;
  entitlement_period?: EntitlementPeriod;
  carryover_policy?: CarryoverPolicy;
  usage_rate?: number;
  usage_limit?: number;
  usage_included?: number;
  per_unit_cap?: number;
  usage_rate_is_estimated?: boolean;
  usage_custom_unit_label?: string;
  expected_emission_interval_minutes?: number;
}

export interface UpdateMetricInput {
  metric_type?: string;
  usage_aggregation_type?: UsageAggregationType;
  rate_kind?: RateKind;
  entitlement_period?: EntitlementPeriod;
  carryover_policy?: CarryoverPolicy;
  usage_rate?: number;
  usage_limit?: number;
  usage_included?: number;
  per_unit_cap?: number;
  usage_rate_is_estimated?: boolean;
  usage_custom_unit_label?: string;
  expected_emission_interval_minutes?: number;
}

export interface Metric {
  id: string;
  license_id: string;
  metric_type: string;
  usage_aggregation_type: UsageAggregationType;
  rate_kind: RateKind;
  entitlement_period: EntitlementPeriod;
  carryover_policy: CarryoverPolicy;
  usage_rate?: number;
  usage_limit?: number;
  usage_included?: number;
  per_unit_cap?: number;
  usage_rate_is_estimated?: boolean;
  usage_custom_unit_label?: string;
  expected_emission_interval_minutes?: number;
  created_at: string;
  updated_at: string;
}

export interface ListMetricsParams extends PaginationParams {
  metric_type?: string;
}

// ─── Management Client Options ─────────────────────────────────────────────

export interface DoowManagementOptions {
  /** Server endpoint. Default: https://api.doow.co */
  endpoint?: string;
  /** Request timeout in ms. Default: 30000 */
  timeout?: number;
  /** Enable debug logging */
  debug?: boolean;
}

// ─── API Error ─────────────────────────────────────────────────────────────

export interface ApiError {
  status: number;
  message: string;
  code?: string;
  details?: Record<string, unknown>;
}
