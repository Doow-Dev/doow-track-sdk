package co.doow.track.types

import kotlinx.serialization.*
import kotlinx.serialization.json.*

@Serializable
enum class EventKind {
    @SerialName("USAGE") USAGE,
    @SerialName("ADJUSTMENT") ADJUSTMENT
}

@Serializable
enum class ContractType {
    @SerialName("PAY_AS_YOU_GO") PAY_AS_YOU_GO,
    @SerialName("ENTERPRISE") ENTERPRISE,
    @SerialName("UNKNOWN") UNKNOWN
}

/** License types for SDK creation. SDK only supports USAGE_BASED. */
@Serializable
enum class LicenseType {
    @SerialName("USAGE_BASED") USAGE_BASED
}

/** All license types (for responses that may include UI-created licenses) */
@Serializable
enum class AllLicenseType {
    @SerialName("USAGE_BASED") USAGE_BASED,
    @SerialName("SEAT_BASED") SEAT_BASED,
    @SerialName("PREPAID_CREDITS") PREPAID_CREDITS,
    @SerialName("FLAT_RATE") FLAT_RATE
}

@Serializable
enum class UsageAggregationType {
    @SerialName("SUM") SUM,
    @SerialName("MAX") MAX,
    @SerialName("CUMULATIVE") CUMULATIVE
}

@Serializable
enum class RateKind {
    @SerialName("PER_UNIT") PER_UNIT,
    @SerialName("FLAT_FEE") FLAT_FEE,
    @SerialName("PER_SEAT") PER_SEAT,
    @SerialName("TIERED") TIERED,
    @SerialName("VOLUME") VOLUME
}

@Serializable
enum class EntitlementPeriod {
    @SerialName("MONTHLY") MONTHLY,
    @SerialName("YEARLY") YEARLY,
    @SerialName("QUARTERLY") QUARTERLY,
    @SerialName("WEEKLY") WEEKLY,
    @SerialName("DAILY") DAILY,
    @SerialName("ONE_TIME") ONE_TIME
}

@Serializable
enum class CarryoverPolicy {
    @SerialName("EXPIRE_AT_PERIOD_END") EXPIRE_AT_PERIOD_END,
    @SerialName("ROLLOVER") ROLLOVER,
    @SerialName("ROLLOVER_CAPPED") ROLLOVER_CAPPED
}

@Serializable
enum class CostAmortization {
    @SerialName("PRORATA") PRORATA,
    @SerialName("MONTHS") MONTHS,
    @SerialName("QUARTER") QUARTER,
    @SerialName("YEARS") YEARS
}

@Serializable
data class MetricTupleHint(
    @SerialName("app_name") val appName: String,
    @SerialName("license_name") val licenseName: String,
    @SerialName("metric_name") val metricName: String
)

@Serializable
data class TrackEvent(
    val metric: String,
    val quantity: Double,
    @SerialName("license_id") val licenseId: String,
    val unit: String? = null,
    val kind: EventKind = EventKind.USAGE,
    val timestamp: String? = null,
    @SerialName("source_system") val sourceSystem: String? = null,
    @SerialName("metric_tuple_hint") val metricTupleHint: MetricTupleHint? = null,
    val attribution: Map<String, JsonElement>? = null,
    val metadata: Map<String, JsonElement>? = null
)

@Serializable
data class App(
    val id: String,
    val name: String,
    val description: String? = null,
    val website: String? = null,
    @SerialName("logo_url") val logoUrl: String? = null,
    val categories: List<String>? = null,
    @SerialName("saas_application_id") val saasApplicationId: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null
)

@Serializable
data class License(
    val id: String,
    val name: String,
    @SerialName("license_type") val licenseType: AllLicenseType,
    @SerialName("contract_id") val contractId: String? = null,
    val seats: Int? = null,
    @SerialName("price_per_seat") val pricePerSeat: Double? = null,
    @SerialName("total_cost") val totalCost: Double? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null
)

@Serializable
data class Expense(
    val id: String,
    @SerialName("app_id") val appId: String? = null,
    @SerialName("contract_id") val contractId: String? = null,
    @SerialName("license_id") val licenseId: String? = null,
    val total: Double,
    val date: String? = null,
    val month: Int? = null,
    val year: Int? = null,
    val description: String? = null,
    @SerialName("transaction_id") val transactionId: String? = null,
    val vendor: String? = null,
    @SerialName("payment_channel") val paymentChannel: String? = null,
    val currency: String? = "USD",
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null
)

@Serializable
data class Contract(
    val id: String,
    @SerialName("app_id") val appId: String,
    val title: String,
    @SerialName("contract_type") val contractType: ContractType,
    @SerialName("start_date") val startDate: String? = null,
    @SerialName("end_date") val endDate: String? = null,
    val currency: String? = null,
    val cost: Double? = null,
    @SerialName("cost_amortization") val costAmortization: CostAmortization? = null,
    @SerialName("total_contract_cost") val totalContractCost: Double? = null,
    @SerialName("total_discount_amount") val totalDiscountAmount: Double? = null,
    @SerialName("total_original_cost") val totalOriginalCost: Double? = null,
    val licenses: List<License> = emptyList(),
    val expenses: List<Expense> = emptyList(),
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null
)

@Serializable
data class Metric(
    val id: String,
    @SerialName("license_id") val licenseId: String,
    @SerialName("metric_type") val metricType: String,
    @SerialName("usage_aggregation_type") val usageAggregationType: UsageAggregationType? = null,
    @SerialName("rate_kind") val rateKind: RateKind? = null,
    @SerialName("entitlement_period") val entitlementPeriod: EntitlementPeriod? = null,
    @SerialName("carryover_policy") val carryoverPolicy: CarryoverPolicy? = null,
    @SerialName("usage_rate") val usageRate: Double? = null,
    @SerialName("usage_limit") val usageLimit: Double? = null,
    @SerialName("usage_included") val usageIncluded: Double? = null,
    @SerialName("per_unit_cap") val perUnitCap: Double? = null,
    @SerialName("usage_rate_is_estimated") val usageRateIsEstimated: Boolean? = null,
    @SerialName("usage_custom_unit_label") val usageCustomUnitLabel: String? = null,
    @SerialName("expected_emission_interval_minutes") val expectedEmissionIntervalMinutes: Int? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null
)

@Serializable
data class PaginatedResponse<T>(
    val data: List<T>,
    val cursor: String? = null,
    @SerialName("has_more") val hasMore: Boolean = false
)

@Serializable
data class CreateAppInput(
    val name: String,
    val description: String? = null,
    val website: String? = null,
    @SerialName("logo_url") val logoUrl: String? = null,
    val categories: List<String>? = null
)

@Serializable
data class LicenseInput(
    val name: String,
    @SerialName("license_type") val licenseType: LicenseType = LicenseType.USAGE_BASED,
    val seats: Int? = null,
    @SerialName("price_per_seat") val pricePerSeat: Double? = null,
    @SerialName("total_cost") val totalCost: Double? = null
)

@Serializable
data class CreateContractInput(
    val title: String? = null,
    @SerialName("contract_type") val contractType: ContractType = ContractType.PAY_AS_YOU_GO,
    @SerialName("start_date") val startDate: String? = null,
    @SerialName("end_date") val endDate: String? = null,
    val currency: String? = null,
    val cost: Double? = null,
    val licenses: List<LicenseInput> = emptyList()
)

@Serializable
data class CreateMetricInput(
    @SerialName("metric_type") val metricType: String,
    @SerialName("usage_aggregation_type") val usageAggregationType: UsageAggregationType? = null,
    @SerialName("rate_kind") val rateKind: RateKind? = null,
    @SerialName("entitlement_period") val entitlementPeriod: EntitlementPeriod? = null,
    @SerialName("carryover_policy") val carryoverPolicy: CarryoverPolicy? = null,
    @SerialName("usage_rate") val usageRate: Double? = null,
    @SerialName("usage_limit") val usageLimit: Double? = null,
    @SerialName("usage_included") val usageIncluded: Double? = null
)
