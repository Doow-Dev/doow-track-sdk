//! Type definitions for Doow SDK.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Event kind
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EventKind {
    #[default]
    Usage,
    Adjustment,
}

/// Contract type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ContractType {
    #[serde(rename = "PAY_AS_YOU_GO")]
    PayAsYouGo,
    #[serde(rename = "ENTERPRISE")]
    Enterprise,
    #[serde(rename = "UNKNOWN")]
    Unknown,
}

impl Default for ContractType {
    fn default() -> Self {
        Self::PayAsYouGo
    }
}

/// License type for SDK creation. SDK only supports USAGE_BASED.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum LicenseType {
    #[serde(rename = "USAGE_BASED")]
    UsageBased,
}

impl Default for LicenseType {
    fn default() -> Self {
        Self::UsageBased
    }
}

/// All license types (for responses that may include UI-created licenses)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AllLicenseType {
    #[serde(rename = "USAGE_BASED")]
    UsageBased,
    #[serde(rename = "SEAT_BASED")]
    SeatBased,
    #[serde(rename = "PREPAID_CREDITS")]
    PrepaidCredits,
    #[serde(rename = "FLAT_RATE")]
    FlatRate,
}

impl Default for AllLicenseType {
    fn default() -> Self {
        Self::UsageBased
    }
}

/// Usage aggregation type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UsageAggregationType {
    Sum,
    Max,
    Cumulative,
}

impl Default for UsageAggregationType {
    fn default() -> Self {
        Self::Sum
    }
}

/// Rate kind
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RateKind {
    PerUnit,
    FlatFee,
    PerSeat,
    Tiered,
    Volume,
}

impl Default for RateKind {
    fn default() -> Self {
        Self::PerUnit
    }
}

/// Entitlement period
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EntitlementPeriod {
    Monthly,
    Yearly,
    Quarterly,
    Weekly,
    Daily,
    OneTime,
}

/// Carryover policy
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum CarryoverPolicy {
    #[serde(rename = "EXPIRE_AT_PERIOD_END")]
    ExpireAtPeriodEnd,
    #[serde(rename = "ROLLOVER")]
    Rollover,
    #[serde(rename = "ROLLOVER_CAPPED")]
    RolloverCapped,
}

/// Cost amortization
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CostAmortization {
    Prorata,
    Months,
    Quarter,
    Years,
}

// --- Track Event Types ---

/// Metric tuple hint for direct resolution on ingest
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricTupleHint {
    pub app_name: String,
    pub license_name: String,
    pub metric_name: String,
}

/// Event to track usage
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TrackEvent {
    pub metric: String,
    pub quantity: f64,
    pub license_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    #[serde(default)]
    pub kind: EventKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_system: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metric_tuple_hint: Option<MetricTupleHint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attribution: Option<HashMap<String, serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

/// Serialized event with generated fields
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerializedEvent {
    pub event_id: String,
    pub metric: String,
    pub quantity: f64,
    pub license_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    pub kind: EventKind,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_system: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metric_tuple_hint: Option<MetricTupleHint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attribution: Option<HashMap<String, serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

// --- Management API Types ---

/// Application resource
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct App {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub website: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub categories: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saas_application_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Input for creating an app
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CreateAppInput {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub website: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub categories: Option<Vec<String>>,
}

/// Input for updating an app
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateAppInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub website: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub categories: Option<Vec<String>>,
}

/// License in contract response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseInContract {
    pub id: String,
    pub name: String,
    pub license_type: AllLicenseType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seats: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price_per_seat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discount: Option<HashMap<String, serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discount_amount: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discounted_cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenure: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seats_included_in_base_plan: Option<i32>,
}

/// License resource
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct License {
    pub id: String,
    pub name: String,
    pub license_type: AllLicenseType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seats: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price_per_seat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<DateTime<Utc>>,
}

/// Input for creating a license within a contract
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LicenseInput {
    pub name: String,
    #[serde(default)]
    pub license_type: LicenseType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seats: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price_per_seat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_cost: Option<f64>,
}

/// Input for creating a standalone license
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CreateLicenseInput {
    pub name: String,
    #[serde(default)]
    pub license_type: LicenseType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seats: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price_per_seat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_cost: Option<f64>,
}

/// Input for updating a license
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateLicenseInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license_type: Option<LicenseType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seats: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price_per_seat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_cost: Option<f64>,
}

/// Expense resource
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Expense {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license_id: Option<String>,
    pub total: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub month: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transaction_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vendor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payment_channel: Option<String>,
    #[serde(default = "default_currency")]
    pub currency: String,
    pub created_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<DateTime<Utc>>,
}

/// Contract resource
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contract {
    pub id: String,
    pub app_id: String,
    pub title: String,
    pub contract_type: ContractType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_break_down: Option<HashMap<String, serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_amortization: Option<CostAmortization>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub add_ons: Option<HashMap<String, serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub add_ons_total_cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_contract_cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_discount_amount: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_original_cost: Option<f64>,
    #[serde(default)]
    pub licenses: Vec<LicenseInContract>,
    #[serde(default)]
    pub expenses: Vec<Expense>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Input for creating a contract
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CreateContractInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default)]
    pub contract_type: ContractType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_amortization: Option<CostAmortization>,
    #[serde(default)]
    pub licenses: Vec<LicenseInput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expense_ids: Option<Vec<String>>,
}

/// Input for updating a contract
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateContractInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_type: Option<ContractType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_amortization: Option<CostAmortization>,
}

/// Metric resource
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Metric {
    pub id: String,
    pub license_id: String,
    pub metric_type: String,
    #[serde(default)]
    pub usage_aggregation_type: UsageAggregationType,
    #[serde(default)]
    pub rate_kind: RateKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entitlement_period: Option<EntitlementPeriod>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub carryover_policy: Option<CarryoverPolicy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_rate: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_limit: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_included: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub per_unit_cap: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_rate_is_estimated: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_custom_unit_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_emission_interval_minutes: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Input for creating a metric
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CreateMetricInput {
    pub metric_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_aggregation_type: Option<UsageAggregationType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate_kind: Option<RateKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entitlement_period: Option<EntitlementPeriod>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub carryover_policy: Option<CarryoverPolicy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_rate: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_limit: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_included: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub per_unit_cap: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_rate_is_estimated: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_custom_unit_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_emission_interval_minutes: Option<i32>,
}

/// Input for updating a metric
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateMetricInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metric_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_aggregation_type: Option<UsageAggregationType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate_kind: Option<RateKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entitlement_period: Option<EntitlementPeriod>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub carryover_policy: Option<CarryoverPolicy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_rate: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_limit: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_included: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub per_unit_cap: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_rate_is_estimated: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_custom_unit_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_emission_interval_minutes: Option<i32>,
}

fn default_currency() -> String {
    "USD".to_string()
}

fn default_limit() -> i32 {
    25
}

/// Pagination parameters
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PaginationParams {
    #[serde(default = "default_limit")]
    pub limit: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
}

/// Parameters for listing apps
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ListAppsParams {
    #[serde(default = "default_limit")]
    pub limit: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// Parameters for listing contracts
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ListContractsParams {
    #[serde(default = "default_limit")]
    pub limit: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_type: Option<ContractType>,
}

/// Parameters for listing licenses
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ListLicensesParams {
    #[serde(default = "default_limit")]
    pub limit: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license_type: Option<AllLicenseType>,
}

/// Parameters for listing metrics
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ListMetricsParams {
    #[serde(default = "default_limit")]
    pub limit: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metric_type: Option<String>,
}

/// Parameters for listing expenses
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ListExpensesParams {
    #[serde(default = "default_limit")]
    pub limit: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub month: Option<i32>,
}

/// Paginated response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedResponse<T> {
    pub data: Vec<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(default)]
    pub has_more: bool,
}

/// Rate limit info
#[derive(Debug, Clone)]
pub struct RateLimit {
    pub limit: i32,
    pub remaining: i32,
    pub reset: DateTime<Utc>,
}
