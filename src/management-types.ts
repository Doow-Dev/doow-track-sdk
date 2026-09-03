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

export interface ExpenseInput {
  /** Amount in cents (min 1) */
  total: number;
  /** ISO date string (YYYY-MM-DD) */
  date: string;
  description?: string;
  transaction_id?: string;
}

export interface Expense {
  id: string;
  total: number;
  date: string;
  month: number;
  year: number;
  description?: string;
  transaction_id?: string;
  created_at: string;
}

/**
 * Input for creating a license inline with a contract.
 *
 * SEAT_BASED licenses require: seats, total_cost
 * USAGE_BASED licenses: total_cost optional (calculated from usage)
 */
export interface LicenseInput {
  name: string;
  /** Defaults to SEAT_BASED */
  license_type?: LicenseType;
  /** Required for SEAT_BASED licenses (min 1) */
  seats?: number;
  price_per_seat?: number;
  /** Required for SEAT_BASED licenses (min 0) */
  total_cost?: number;
  discount?: Record<string, unknown>;
  discount_amount?: number;
  discounted_cost?: number;
  original_cost?: number;
  tenure?: number;
  seats_included_in_base_plan?: number;
}

export interface LicenseInContract {
  id: string;
  name: string;
  license_type: LicenseType;
  seats?: number;
  price_per_seat?: number;
  total_cost?: number;
  discount?: Record<string, unknown>;
  discount_amount?: number;
  discounted_cost?: number;
  original_cost?: number;
  tenure?: number;
  seats_included_in_base_plan?: number;
  created_at: string;
}

/**
 * Input for creating a contract.
 *
 * Requires at least 1 license and 1 expense. Contracts without these cannot be created.
 * - start_date must be before end_date if both provided
 * - currency must be 3-char ISO code (e.g., USD, EUR)
 */
export interface CreateContractInput {
  title?: string;
  contract_type?: ContractType;
  /** ISO date string. Must be before end_date */
  start_date?: string;
  /** ISO date string. Must be after start_date */
  end_date?: string;
  /** 3-char ISO currency code (e.g., USD, EUR) */
  currency?: string;
  /** Cost in cents (min 0) */
  cost?: number;
  cost_break_down?: Record<string, unknown>;
  cost_amortization?: CostAmortization;
  add_ons?: Record<string, unknown>;
  add_ons_total_cost?: number;
  total_contract_cost?: number;
  total_discount_amount?: number;
  total_original_cost?: number;
  /** At least 1 license required */
  licenses: LicenseInput[];
  /** At least 1 expense required */
  expenses: ExpenseInput[];
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

export type LicenseType = 'USAGE_BASED' | 'SEAT_BASED' | 'PREPAID_CREDITS' | 'FLAT_RATE';

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

export interface License {
  id: string;
  contract_id: string;
  name: string;
  license_type: LicenseType;
  seats?: number;
  price_per_seat?: number;
  total_cost?: number;
  discount?: Record<string, unknown>;
  discount_amount?: number;
  discounted_cost?: number;
  original_cost?: number;
  tenure?: number;
  seats_included_in_base_plan?: number;
  created_at: string;
  updated_at: string;
}

export interface ListLicensesParams extends PaginationParams {
  license_type?: LicenseType;
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
