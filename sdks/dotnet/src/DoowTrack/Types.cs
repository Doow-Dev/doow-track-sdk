using System.Text.Json.Serialization;

namespace DoowTrack;

public enum EventKind
{
    [JsonPropertyName("USAGE")] Usage,
    [JsonPropertyName("ADJUSTMENT")] Adjustment
}

public enum ContractType
{
    [JsonPropertyName("PAY_AS_YOU_GO")] PayAsYouGo,
    [JsonPropertyName("ENTERPRISE")] Enterprise,
    [JsonPropertyName("UNKNOWN")] Unknown
}

/// <summary>
/// License types for SDK creation. SDK only supports USAGE_BASED.
/// </summary>
public enum LicenseType
{
    [JsonPropertyName("USAGE_BASED")] UsageBased
}

/// <summary>
/// All license types (for responses that may include UI-created licenses)
/// </summary>
public enum AllLicenseType
{
    [JsonPropertyName("USAGE_BASED")] UsageBased,
    [JsonPropertyName("SEAT_BASED")] SeatBased,
    [JsonPropertyName("PREPAID_CREDITS")] PrepaidCredits,
    [JsonPropertyName("FLAT_RATE")] FlatRate
}

public enum UsageAggregationType
{
    [JsonPropertyName("SUM")] Sum,
    [JsonPropertyName("MAX")] Max,
    [JsonPropertyName("CUMULATIVE")] Cumulative
}

public enum RateKind
{
    [JsonPropertyName("PER_UNIT")] PerUnit,
    [JsonPropertyName("FLAT_FEE")] FlatFee,
    [JsonPropertyName("PER_SEAT")] PerSeat,
    [JsonPropertyName("TIERED")] Tiered,
    [JsonPropertyName("VOLUME")] Volume
}

public enum EntitlementPeriod
{
    [JsonPropertyName("MONTHLY")] Monthly,
    [JsonPropertyName("YEARLY")] Yearly,
    [JsonPropertyName("QUARTERLY")] Quarterly,
    [JsonPropertyName("WEEKLY")] Weekly,
    [JsonPropertyName("DAILY")] Daily,
    [JsonPropertyName("ONE_TIME")] OneTime
}

public enum CarryoverPolicy
{
    [JsonPropertyName("EXPIRE_AT_PERIOD_END")] ExpireAtPeriodEnd,
    [JsonPropertyName("ROLLOVER")] Rollover,
    [JsonPropertyName("ROLLOVER_CAPPED")] RolloverCapped
}

public enum CostAmortization
{
    [JsonPropertyName("PRORATA")] Prorata,
    [JsonPropertyName("MONTHS")] Months,
    [JsonPropertyName("QUARTER")] Quarter,
    [JsonPropertyName("YEARS")] Years
}

public record MetricTupleHint
{
    [JsonPropertyName("app_name")]
    public required string AppName { get; init; }

    [JsonPropertyName("license_name")]
    public required string LicenseName { get; init; }

    [JsonPropertyName("metric_name")]
    public required string MetricName { get; init; }
}

public record TrackEvent
{
    [JsonPropertyName("metric")]
    public required string Metric { get; init; }

    [JsonPropertyName("quantity")]
    public required double Quantity { get; init; }

    [JsonPropertyName("license_id")]
    public required string LicenseId { get; init; }

    [JsonPropertyName("unit")]
    public string? Unit { get; init; }

    [JsonPropertyName("kind")]
    public EventKind Kind { get; init; } = EventKind.Usage;

    [JsonPropertyName("timestamp")]
    public DateTimeOffset? Timestamp { get; init; }

    [JsonPropertyName("source_system")]
    public string? SourceSystem { get; init; }

    [JsonPropertyName("metric_tuple_hint")]
    public MetricTupleHint? MetricTupleHint { get; init; }

    [JsonPropertyName("attribution")]
    public Dictionary<string, object>? Attribution { get; init; }

    [JsonPropertyName("metadata")]
    public Dictionary<string, object>? Metadata { get; init; }
}

public record App
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("name")]
    public required string Name { get; init; }

    [JsonPropertyName("description")]
    public string? Description { get; init; }

    [JsonPropertyName("website")]
    public string? Website { get; init; }

    [JsonPropertyName("logo_url")]
    public string? LogoUrl { get; init; }

    [JsonPropertyName("categories")]
    public List<string>? Categories { get; init; }

    [JsonPropertyName("saas_application_id")]
    public string? SaasApplicationId { get; init; }

    [JsonPropertyName("created_at")]
    public DateTimeOffset? CreatedAt { get; init; }

    [JsonPropertyName("updated_at")]
    public DateTimeOffset? UpdatedAt { get; init; }
}

public record CreateAppInput
{
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    [JsonPropertyName("description")]
    public string? Description { get; init; }

    [JsonPropertyName("website")]
    public string? Website { get; init; }

    [JsonPropertyName("logo_url")]
    public string? LogoUrl { get; init; }

    [JsonPropertyName("categories")]
    public List<string>? Categories { get; init; }
}

public record UpdateAppInput
{
    [JsonPropertyName("name")]
    public string? Name { get; init; }

    [JsonPropertyName("description")]
    public string? Description { get; init; }

    [JsonPropertyName("website")]
    public string? Website { get; init; }

    [JsonPropertyName("logo_url")]
    public string? LogoUrl { get; init; }

    [JsonPropertyName("categories")]
    public List<string>? Categories { get; init; }
}

public record License
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("name")]
    public required string Name { get; init; }

    [JsonPropertyName("license_type")]
    public required AllLicenseType LicenseType { get; init; }

    [JsonPropertyName("contract_id")]
    public string? ContractId { get; init; }

    [JsonPropertyName("seats")]
    public int? Seats { get; init; }

    [JsonPropertyName("price_per_seat")]
    public double? PricePerSeat { get; init; }

    [JsonPropertyName("total_cost")]
    public double? TotalCost { get; init; }

    [JsonPropertyName("created_at")]
    public DateTimeOffset? CreatedAt { get; init; }

    [JsonPropertyName("updated_at")]
    public DateTimeOffset? UpdatedAt { get; init; }
}

public record LicenseInput
{
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    [JsonPropertyName("license_type")]
    public LicenseType LicenseType { get; init; } = LicenseType.UsageBased;

    [JsonPropertyName("seats")]
    public int? Seats { get; init; }

    [JsonPropertyName("price_per_seat")]
    public double? PricePerSeat { get; init; }

    [JsonPropertyName("total_cost")]
    public double? TotalCost { get; init; }
}

public record Contract
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("app_id")]
    public required string AppId { get; init; }

    [JsonPropertyName("title")]
    public required string Title { get; init; }

    [JsonPropertyName("contract_type")]
    public required ContractType ContractType { get; init; }

    [JsonPropertyName("start_date")]
    public string? StartDate { get; init; }

    [JsonPropertyName("end_date")]
    public string? EndDate { get; init; }

    [JsonPropertyName("currency")]
    public string? Currency { get; init; }

    [JsonPropertyName("cost")]
    public double? Cost { get; init; }

    [JsonPropertyName("cost_amortization")]
    public CostAmortization? CostAmortization { get; init; }

    [JsonPropertyName("total_contract_cost")]
    public double? TotalContractCost { get; init; }

    [JsonPropertyName("total_discount_amount")]
    public double? TotalDiscountAmount { get; init; }

    [JsonPropertyName("total_original_cost")]
    public double? TotalOriginalCost { get; init; }

    [JsonPropertyName("licenses")]
    public List<License> Licenses { get; init; } = new();

    [JsonPropertyName("expenses")]
    public List<Expense> Expenses { get; init; } = new();

    [JsonPropertyName("created_at")]
    public DateTimeOffset? CreatedAt { get; init; }

    [JsonPropertyName("updated_at")]
    public DateTimeOffset? UpdatedAt { get; init; }
}

public record CreateContractInput
{
    [JsonPropertyName("title")]
    public string? Title { get; init; }

    [JsonPropertyName("contract_type")]
    public ContractType ContractType { get; init; } = ContractType.PayAsYouGo;

    [JsonPropertyName("start_date")]
    public string? StartDate { get; init; }

    [JsonPropertyName("end_date")]
    public string? EndDate { get; init; }

    [JsonPropertyName("currency")]
    public string? Currency { get; init; }

    [JsonPropertyName("cost")]
    public double? Cost { get; init; }

    [JsonPropertyName("licenses")]
    public List<LicenseInput> Licenses { get; init; } = new();
}

public record Metric
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("license_id")]
    public required string LicenseId { get; init; }

    [JsonPropertyName("metric_type")]
    public required string MetricType { get; init; }

    [JsonPropertyName("usage_aggregation_type")]
    public UsageAggregationType? UsageAggregationType { get; init; }

    [JsonPropertyName("rate_kind")]
    public RateKind? RateKind { get; init; }

    [JsonPropertyName("entitlement_period")]
    public EntitlementPeriod? EntitlementPeriod { get; init; }

    [JsonPropertyName("carryover_policy")]
    public CarryoverPolicy? CarryoverPolicy { get; init; }

    [JsonPropertyName("usage_rate")]
    public double? UsageRate { get; init; }

    [JsonPropertyName("usage_limit")]
    public double? UsageLimit { get; init; }

    [JsonPropertyName("usage_included")]
    public double? UsageIncluded { get; init; }

    [JsonPropertyName("per_unit_cap")]
    public double? PerUnitCap { get; init; }

    [JsonPropertyName("usage_rate_is_estimated")]
    public bool? UsageRateIsEstimated { get; init; }

    [JsonPropertyName("usage_custom_unit_label")]
    public string? UsageCustomUnitLabel { get; init; }

    [JsonPropertyName("expected_emission_interval_minutes")]
    public int? ExpectedEmissionIntervalMinutes { get; init; }

    [JsonPropertyName("created_at")]
    public DateTimeOffset? CreatedAt { get; init; }

    [JsonPropertyName("updated_at")]
    public DateTimeOffset? UpdatedAt { get; init; }
}

public record CreateMetricInput
{
    [JsonPropertyName("metric_type")]
    public required string MetricType { get; init; }

    [JsonPropertyName("usage_aggregation_type")]
    public UsageAggregationType? UsageAggregationType { get; init; }

    [JsonPropertyName("rate_kind")]
    public RateKind? RateKind { get; init; }

    [JsonPropertyName("entitlement_period")]
    public EntitlementPeriod? EntitlementPeriod { get; init; }

    [JsonPropertyName("carryover_policy")]
    public CarryoverPolicy? CarryoverPolicy { get; init; }

    [JsonPropertyName("usage_rate")]
    public double? UsageRate { get; init; }

    [JsonPropertyName("usage_limit")]
    public double? UsageLimit { get; init; }

    [JsonPropertyName("usage_included")]
    public double? UsageIncluded { get; init; }
}

public record Expense
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("app_id")]
    public string? AppId { get; init; }

    [JsonPropertyName("contract_id")]
    public string? ContractId { get; init; }

    [JsonPropertyName("license_id")]
    public string? LicenseId { get; init; }

    [JsonPropertyName("total")]
    public required double Total { get; init; }

    [JsonPropertyName("date")]
    public string? Date { get; init; }

    [JsonPropertyName("month")]
    public int? Month { get; init; }

    [JsonPropertyName("year")]
    public int? Year { get; init; }

    [JsonPropertyName("description")]
    public string? Description { get; init; }

    [JsonPropertyName("transaction_id")]
    public string? TransactionId { get; init; }

    [JsonPropertyName("vendor")]
    public string? Vendor { get; init; }

    [JsonPropertyName("payment_channel")]
    public string? PaymentChannel { get; init; }

    [JsonPropertyName("currency")]
    public string Currency { get; init; } = "USD";

    [JsonPropertyName("created_at")]
    public DateTimeOffset? CreatedAt { get; init; }

    [JsonPropertyName("updated_at")]
    public DateTimeOffset? UpdatedAt { get; init; }
}

public record PaginatedResponse<T>
{
    [JsonPropertyName("data")]
    public required List<T> Data { get; init; }

    [JsonPropertyName("cursor")]
    public string? Cursor { get; init; }

    [JsonPropertyName("has_more")]
    public bool HasMore { get; init; }
}
