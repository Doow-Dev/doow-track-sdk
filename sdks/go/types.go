package doow

import "time"

// TrackEvent is the customer-facing ergonomic shape
type TrackEvent struct {
	Metric          string                 `json:"metric"`
	Quantity        float64                `json:"quantity"`
	Unit            string                 `json:"unit,omitempty"`
	LicenseID       string                 `json:"license_id"`
	SourceSystem    string                 `json:"source_system,omitempty"`
	Timestamp       *time.Time             `json:"timestamp,omitempty"`
	MetricTupleHint *MetricTupleHint       `json:"metric_tuple_hint,omitempty"`
	Kind            EventKind              `json:"kind,omitempty"`
	Attribution     map[string]interface{} `json:"attribution,omitempty"`
	Metadata        map[string]interface{} `json:"metadata,omitempty"`
}

type MetricTupleHint struct {
	AppName     string `json:"app_name"`
	LicenseName string `json:"license_name"`
	MetricName  string `json:"metric_name"`
}

type EventKind string

const (
	EventKindUsage      EventKind = "USAGE"
	EventKindAdjustment EventKind = "ADJUSTMENT"
)

// SerializedEvent includes generated fields
type SerializedEvent struct {
	TrackEvent
	EventID   string `json:"event_id"`
	Timestamp string `json:"timestamp"`
}

// WireMeasurement for the wire protocol
type WireMeasurement struct {
	MetricName      string           `json:"metric_name"`
	Quantity        float64          `json:"quantity"`
	MetricTupleHint *MetricTupleHint `json:"metric_tuple_hint,omitempty"`
}

// WireEvent is the full wire format
type WireEvent struct {
	SerializedEvent
	OccurredAt   string            `json:"occurred_at"`
	SourceSystem string            `json:"source_system"`
	Measurements []WireMeasurement `json:"measurements"`
}

// BatchPayload is the wire payload sent to the API
type BatchPayload struct {
	BatchID    string      `json:"batch_id"`
	SDKVersion string      `json:"sdk_version"`
	Events     []WireEvent `json:"events"`
}

// SerializedBatch for offline storage
type SerializedBatch struct {
	BatchID   string `json:"batch_id"`
	Payload   string `json:"payload"`
	Timestamp string `json:"timestamp"`
}

// OfflineStore interface for persistent storage
type OfflineStore interface {
	Push(batch SerializedBatch) error
	Shift() (*SerializedBatch, error)
	Length() (int, error)
}

// TrackerOptions configures the telemetry tracker
type TrackerOptions struct {
	Endpoint            string
	Enabled             *bool // nil = true (default), false = disabled
	Attribution         map[string]interface{}
	Debug               bool
	FlushAt             int
	FlushInterval       time.Duration
	MaxPayloadBytes     int
	MaxQueueSize        int
	Timeout             time.Duration
	RetryCount          int
	DisableCompression  bool
	MaxConcurrentFlushes int
	ShutdownTimeout     time.Duration
	OnError             func(error)
	BeforeSend          func(SerializedEvent) *SerializedEvent
	BeforeFlush         func([]SerializedEvent) []SerializedEvent
	OfflineStore        OfflineStore
}

// RateLimit info from API response
type RateLimit struct {
	Limit     int
	Remaining int
	Reset     time.Time
}

// ManagementOptions configures the management client
type ManagementOptions struct {
	Endpoint string
	Timeout  time.Duration
	Debug    bool
}

// PaginatedResponse wraps paginated API responses
type PaginatedResponse[T any] struct {
	Data    []T    `json:"data"`
	Cursor  string `json:"cursor,omitempty"`
	HasMore bool   `json:"has_more"`
}

// PaginationParams for list requests
type PaginationParams struct {
	Cursor string
	Limit  int
}

// App represents a SaaS application
type App struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	Description       string   `json:"description,omitempty"`
	Website           string   `json:"website,omitempty"`
	LogoURL           string   `json:"logo_url,omitempty"`
	Categories        []string `json:"categories,omitempty"`
	SaasApplicationID string   `json:"saas_application_id"`
	CreatedAt         string   `json:"created_at"`
	UpdatedAt         string   `json:"updated_at"`
}

// CreateAppInput for creating apps
type CreateAppInput struct {
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	Website     string   `json:"website,omitempty"`
	LogoURL     string   `json:"logo_url,omitempty"`
	Categories  []string `json:"categories,omitempty"`
}

// UpdateAppInput for updating apps
type UpdateAppInput struct {
	Name        *string  `json:"name,omitempty"`
	Description *string  `json:"description,omitempty"`
	Website     *string  `json:"website,omitempty"`
	LogoURL     *string  `json:"logo_url,omitempty"`
	Categories  []string `json:"categories,omitempty"`
}

// ListAppsParams for filtering apps
type ListAppsParams struct {
	PaginationParams
	Name string
}

// ContractType enum
type ContractType string

const (
	ContractTypePayAsYouGo ContractType = "PAY_AS_YOU_GO"
	ContractTypeEnterprise ContractType = "ENTERPRISE"
	ContractTypeUnknown    ContractType = "UNKNOWN"
)

// CostAmortization enum
type CostAmortization string

const (
	CostAmortizationProrata CostAmortization = "PRORATA"
	CostAmortizationMonths  CostAmortization = "MONTHS"
	CostAmortizationQuarter CostAmortization = "QUARTER"
	CostAmortizationYears   CostAmortization = "YEARS"
)

// Contract represents a contract
type Contract struct {
	ID                  string                 `json:"id"`
	AppID               string                 `json:"app_id"`
	Title               string                 `json:"title"`
	ContractType        ContractType           `json:"contract_type"`
	StartDate           string                 `json:"start_date,omitempty"`
	EndDate             string                 `json:"end_date,omitempty"`
	Currency            string                 `json:"currency,omitempty"`
	Cost                float64                `json:"cost,omitempty"`
	CostBreakDown       map[string]interface{} `json:"cost_break_down,omitempty"`
	CostAmortization    CostAmortization       `json:"cost_amortization,omitempty"`
	AddOns              map[string]interface{} `json:"add_ons,omitempty"`
	AddOnsTotalCost     float64                `json:"add_ons_total_cost,omitempty"`
	TotalContractCost   float64                `json:"total_contract_cost,omitempty"`
	TotalDiscountAmount float64                `json:"total_discount_amount,omitempty"`
	TotalOriginalCost   float64                `json:"total_original_cost,omitempty"`
	Licenses            []License              `json:"licenses,omitempty"`
	Expenses            []Expense              `json:"expenses,omitempty"`
	CreatedAt           string                 `json:"created_at"`
	UpdatedAt           string                 `json:"updated_at"`
}

// LicenseInput for creating licenses inline with contracts
type LicenseInput struct {
	Name                    string                 `json:"name"`
	LicenseType             LicenseType            `json:"license_type,omitempty"`
	Seats                   int                    `json:"seats,omitempty"`
	PricePerSeat            float64                `json:"price_per_seat,omitempty"`
	TotalCost               float64                `json:"total_cost,omitempty"`
	Discount                map[string]interface{} `json:"discount,omitempty"`
	DiscountAmount          float64                `json:"discount_amount,omitempty"`
	DiscountedCost          float64                `json:"discounted_cost,omitempty"`
	OriginalCost            float64                `json:"original_cost,omitempty"`
	Tenure                  int                    `json:"tenure,omitempty"`
	SeatsIncludedInBasePlan int                    `json:"seats_included_in_base_plan,omitempty"`
}

// CreateContractInput for creating contracts
type CreateContractInput struct {
	Title               string                 `json:"title,omitempty"`
	ContractType        ContractType           `json:"contract_type,omitempty"`
	StartDate           string                 `json:"start_date,omitempty"`
	EndDate             string                 `json:"end_date,omitempty"`
	Currency            string                 `json:"currency,omitempty"`
	Cost                float64                `json:"cost,omitempty"`
	CostBreakDown       map[string]interface{} `json:"cost_break_down,omitempty"`
	CostAmortization    CostAmortization       `json:"cost_amortization,omitempty"`
	AddOns              map[string]interface{} `json:"add_ons,omitempty"`
	AddOnsTotalCost     float64                `json:"add_ons_total_cost,omitempty"`
	TotalContractCost   float64                `json:"total_contract_cost,omitempty"`
	TotalDiscountAmount float64                `json:"total_discount_amount,omitempty"`
	TotalOriginalCost   float64                `json:"total_original_cost,omitempty"`
	Licenses            []LicenseInput         `json:"licenses"`
	ExpenseIDs          []string               `json:"expense_ids,omitempty"`
}

// UpdateContractInput for updating contracts
type UpdateContractInput struct {
	Title               *string                `json:"title,omitempty"`
	ContractType        *ContractType          `json:"contract_type,omitempty"`
	StartDate           *string                `json:"start_date,omitempty"`
	EndDate             *string                `json:"end_date,omitempty"`
	Currency            *string                `json:"currency,omitempty"`
	Cost                *float64               `json:"cost,omitempty"`
	CostBreakDown       map[string]interface{} `json:"cost_break_down,omitempty"`
	CostAmortization    *CostAmortization      `json:"cost_amortization,omitempty"`
	AddOns              map[string]interface{} `json:"add_ons,omitempty"`
	AddOnsTotalCost     *float64               `json:"add_ons_total_cost,omitempty"`
	TotalContractCost   *float64               `json:"total_contract_cost,omitempty"`
	TotalDiscountAmount *float64               `json:"total_discount_amount,omitempty"`
	TotalOriginalCost   *float64               `json:"total_original_cost,omitempty"`
}

// ListContractsParams for filtering contracts
type ListContractsParams struct {
	PaginationParams
	ContractType ContractType
}

// LicenseType for SDK creation. SDK only supports USAGE_BASED.
type LicenseType string

const (
	LicenseTypeUsageBased LicenseType = "USAGE_BASED"
)

// AllLicenseType for responses that may include UI-created licenses
type AllLicenseType string

const (
	AllLicenseTypeUsageBased     AllLicenseType = "USAGE_BASED"
	AllLicenseTypeSeatBased      AllLicenseType = "SEAT_BASED"
	AllLicenseTypePrepaidCredits AllLicenseType = "PREPAID_CREDITS"
	AllLicenseTypeFlatRate       AllLicenseType = "FLAT_RATE"
)

// License represents a license (response type uses AllLicenseType)
type License struct {
	ID                      string                 `json:"id"`
	ContractID              string                 `json:"contract_id"`
	Name                    string                 `json:"name"`
	LicenseType             AllLicenseType         `json:"license_type"`
	Seats                   int                    `json:"seats,omitempty"`
	PricePerSeat            float64                `json:"price_per_seat,omitempty"`
	TotalCost               float64                `json:"total_cost,omitempty"`
	Discount                map[string]interface{} `json:"discount,omitempty"`
	DiscountAmount          float64                `json:"discount_amount,omitempty"`
	DiscountedCost          float64                `json:"discounted_cost,omitempty"`
	OriginalCost            float64                `json:"original_cost,omitempty"`
	Tenure                  int                    `json:"tenure,omitempty"`
	SeatsIncludedInBasePlan int                    `json:"seats_included_in_base_plan,omitempty"`
}

// CreateLicenseInput for creating licenses
type CreateLicenseInput struct {
	Name                    string                 `json:"name"`
	LicenseType             LicenseType            `json:"license_type,omitempty"`
	Seats                   int                    `json:"seats,omitempty"`
	PricePerSeat            float64                `json:"price_per_seat,omitempty"`
	TotalCost               float64                `json:"total_cost,omitempty"`
	Discount                map[string]interface{} `json:"discount,omitempty"`
	DiscountAmount          float64                `json:"discount_amount,omitempty"`
	DiscountedCost          float64                `json:"discounted_cost,omitempty"`
	OriginalCost            float64                `json:"original_cost,omitempty"`
	Tenure                  int                    `json:"tenure,omitempty"`
	SeatsIncludedInBasePlan int                    `json:"seats_included_in_base_plan,omitempty"`
}

// UpdateLicenseInput for updating licenses
type UpdateLicenseInput struct {
	Name                    *string                `json:"name,omitempty"`
	LicenseType             *LicenseType           `json:"license_type,omitempty"`
	Seats                   *int                   `json:"seats,omitempty"`
	PricePerSeat            *float64               `json:"price_per_seat,omitempty"`
	TotalCost               *float64               `json:"total_cost,omitempty"`
	Discount                map[string]interface{} `json:"discount,omitempty"`
	DiscountAmount          *float64               `json:"discount_amount,omitempty"`
	DiscountedCost          *float64               `json:"discounted_cost,omitempty"`
	OriginalCost            *float64               `json:"original_cost,omitempty"`
	Tenure                  *int                   `json:"tenure,omitempty"`
	SeatsIncludedInBasePlan *int                   `json:"seats_included_in_base_plan,omitempty"`
}

// ListLicensesParams for filtering licenses
type ListLicensesParams struct {
	PaginationParams
	LicenseType AllLicenseType
}

// UsageAggregationType enum
type UsageAggregationType string

const (
	UsageAggregationSum        UsageAggregationType = "SUM"
	UsageAggregationMax        UsageAggregationType = "MAX"
	UsageAggregationCumulative UsageAggregationType = "CUMULATIVE"
)

// RateKind enum
type RateKind string

const (
	RateKindPerUnit RateKind = "PER_UNIT"
	RateKindFlatFee RateKind = "FLAT_FEE"
	RateKindPerSeat RateKind = "PER_SEAT"
	RateKindTiered  RateKind = "TIERED"
	RateKindVolume  RateKind = "VOLUME"
)

// EntitlementPeriod enum
type EntitlementPeriod string

const (
	EntitlementPeriodMonthly   EntitlementPeriod = "MONTHLY"
	EntitlementPeriodYearly    EntitlementPeriod = "YEARLY"
	EntitlementPeriodQuarterly EntitlementPeriod = "QUARTERLY"
	EntitlementPeriodWeekly    EntitlementPeriod = "WEEKLY"
	EntitlementPeriodDaily     EntitlementPeriod = "DAILY"
	EntitlementPeriodOneTime   EntitlementPeriod = "ONE_TIME"
)

// CarryoverPolicy enum
type CarryoverPolicy string

const (
	CarryoverExpire      CarryoverPolicy = "EXPIRE_AT_PERIOD_END"
	CarryoverRollover    CarryoverPolicy = "ROLLOVER"
	CarryoverRolloverCap CarryoverPolicy = "ROLLOVER_CAPPED"
)

// Metric represents a usage metric
type Metric struct {
	ID                           string               `json:"id"`
	LicenseID                    string               `json:"license_id"`
	MetricType                   string               `json:"metric_type"`
	UsageAggregationType         UsageAggregationType `json:"usage_aggregation_type"`
	RateKind                     RateKind             `json:"rate_kind"`
	EntitlementPeriod            EntitlementPeriod    `json:"entitlement_period"`
	CarryoverPolicy              CarryoverPolicy      `json:"carryover_policy"`
	UsageRate                    float64              `json:"usage_rate,omitempty"`
	UsageLimit                   float64              `json:"usage_limit,omitempty"`
	UsageIncluded                float64              `json:"usage_included,omitempty"`
	PerUnitCap                   float64              `json:"per_unit_cap,omitempty"`
	UsageRateIsEstimated         bool                 `json:"usage_rate_is_estimated,omitempty"`
	UsageCustomUnitLabel         string               `json:"usage_custom_unit_label,omitempty"`
	ExpectedEmissionIntervalMins int                  `json:"expected_emission_interval_minutes,omitempty"`
	CreatedAt                    string               `json:"created_at"`
	UpdatedAt                    string               `json:"updated_at"`
}

// CreateMetricInput for creating metrics
type CreateMetricInput struct {
	MetricType                   string               `json:"metric_type"`
	UsageAggregationType         UsageAggregationType `json:"usage_aggregation_type,omitempty"`
	RateKind                     RateKind             `json:"rate_kind,omitempty"`
	EntitlementPeriod            EntitlementPeriod    `json:"entitlement_period,omitempty"`
	CarryoverPolicy              CarryoverPolicy      `json:"carryover_policy,omitempty"`
	UsageRate                    float64              `json:"usage_rate,omitempty"`
	UsageLimit                   float64              `json:"usage_limit,omitempty"`
	UsageIncluded                float64              `json:"usage_included,omitempty"`
	PerUnitCap                   float64              `json:"per_unit_cap,omitempty"`
	UsageRateIsEstimated         bool                 `json:"usage_rate_is_estimated,omitempty"`
	UsageCustomUnitLabel         string               `json:"usage_custom_unit_label,omitempty"`
	ExpectedEmissionIntervalMins int                  `json:"expected_emission_interval_minutes,omitempty"`
}

// UpdateMetricInput for updating metrics
type UpdateMetricInput struct {
	MetricType                   *string               `json:"metric_type,omitempty"`
	UsageAggregationType         *UsageAggregationType `json:"usage_aggregation_type,omitempty"`
	RateKind                     *RateKind             `json:"rate_kind,omitempty"`
	EntitlementPeriod            *EntitlementPeriod    `json:"entitlement_period,omitempty"`
	CarryoverPolicy              *CarryoverPolicy      `json:"carryover_policy,omitempty"`
	UsageRate                    *float64              `json:"usage_rate,omitempty"`
	UsageLimit                   *float64              `json:"usage_limit,omitempty"`
	UsageIncluded                *float64              `json:"usage_included,omitempty"`
	PerUnitCap                   *float64              `json:"per_unit_cap,omitempty"`
	UsageRateIsEstimated         *bool                 `json:"usage_rate_is_estimated,omitempty"`
	UsageCustomUnitLabel         *string               `json:"usage_custom_unit_label,omitempty"`
	ExpectedEmissionIntervalMins *int                  `json:"expected_emission_interval_minutes,omitempty"`
}

// ListMetricsParams for filtering metrics
type ListMetricsParams struct {
	PaginationParams
	MetricType string
}

// Expense represents an expense
type Expense struct {
	ID             string  `json:"id"`
	AppID          string  `json:"app_id,omitempty"`
	ContractID     string  `json:"contract_id,omitempty"`
	LicenseID      string  `json:"license_id,omitempty"`
	Total          float64 `json:"total"`
	Date           string  `json:"date"`
	Month          int     `json:"month"`
	Year           int     `json:"year"`
	Description    string  `json:"description,omitempty"`
	TransactionID  string  `json:"transaction_id,omitempty"`
	Vendor         string  `json:"vendor,omitempty"`
	PaymentChannel string  `json:"payment_channel,omitempty"`
	CreatedAt      string  `json:"created_at"`
	UpdatedAt      string  `json:"updated_at,omitempty"`
}

// ListExpensesParams for filtering expenses
type ListExpensesParams struct {
	PaginationParams
	AppID      string
	ContractID string
	Year       int
	Month      int
}
