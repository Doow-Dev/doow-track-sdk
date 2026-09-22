"""Type definitions for Doow SDK."""

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class EventKind(str, Enum):
    USAGE = "USAGE"
    ADJUSTMENT = "ADJUSTMENT"


class ContractType(str, Enum):
    """Contract types supported by the SDK."""
    PAY_AS_YOU_GO = "PAY_AS_YOU_GO"
    ENTERPRISE = "ENTERPRISE"
    UNKNOWN = "UNKNOWN"


class LicenseType(str, Enum):
    """License types for SDK creation. SDK only supports USAGE_BASED."""
    USAGE_BASED = "USAGE_BASED"


class AllLicenseType(str, Enum):
    """All license types (for responses that may include UI-created licenses)."""
    USAGE_BASED = "USAGE_BASED"
    SEAT_BASED = "SEAT_BASED"
    PREPAID_CREDITS = "PREPAID_CREDITS"
    FLAT_RATE = "FLAT_RATE"


class UsageAggregationType(str, Enum):
    SUM = "SUM"
    MAX = "MAX"
    CUMULATIVE = "CUMULATIVE"


class RateKind(str, Enum):
    PER_UNIT = "PER_UNIT"
    FLAT_FEE = "FLAT_FEE"
    PER_SEAT = "PER_SEAT"
    TIERED = "TIERED"
    VOLUME = "VOLUME"


class EntitlementPeriod(str, Enum):
    MONTHLY = "MONTHLY"
    YEARLY = "YEARLY"
    QUARTERLY = "QUARTERLY"
    WEEKLY = "WEEKLY"
    DAILY = "DAILY"
    ONE_TIME = "ONE_TIME"


class CarryoverPolicy(str, Enum):
    EXPIRE_AT_PERIOD_END = "EXPIRE_AT_PERIOD_END"
    ROLLOVER = "ROLLOVER"
    ROLLOVER_CAPPED = "ROLLOVER_CAPPED"


class CostAmortization(str, Enum):
    PRORATA = "PRORATA"
    MONTHS = "MONTHS"
    QUARTER = "QUARTER"
    YEARS = "YEARS"


# --- Track Event Types ---


class MetricTupleHint(BaseModel):
    """Hint for direct metric resolution on ingest."""
    app_name: str
    license_name: str
    metric_name: str


class TrackEvent(BaseModel):
    """Event to track usage."""

    metric: str
    quantity: float
    license_id: str
    unit: Optional[str] = None
    kind: EventKind = EventKind.USAGE
    timestamp: Optional[datetime] = None
    source_system: Optional[str] = None
    metric_tuple_hint: Optional[MetricTupleHint] = None
    attribution: Optional[dict[str, Any]] = None
    metadata: Optional[dict[str, Any]] = None


class SerializedEvent(TrackEvent):
    """Event with generated fields."""

    event_id: str
    timestamp: str  # type: ignore[assignment]


# --- Management API Types ---


class App(BaseModel):
    """Application resource."""

    id: str
    name: str
    description: Optional[str] = None
    website: Optional[str] = None
    logo_url: Optional[str] = None
    categories: Optional[list[str]] = None
    saas_application_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class CreateAppInput(BaseModel):
    """Input for creating an app."""

    name: str
    description: Optional[str] = None
    website: Optional[str] = None
    logo_url: Optional[str] = None
    categories: Optional[list[str]] = None


class UpdateAppInput(BaseModel):
    """Input for updating an app."""

    name: Optional[str] = None
    description: Optional[str] = None
    website: Optional[str] = None
    logo_url: Optional[str] = None
    categories: Optional[list[str]] = None


class LicenseInContract(BaseModel):
    """License in contract response. Uses AllLicenseType since responses may include UI-created licenses."""

    id: str
    name: str
    license_type: AllLicenseType
    seats: Optional[int] = None
    price_per_seat: Optional[float] = None
    total_cost: Optional[float] = None
    discount: Optional[dict[str, Any]] = None
    discount_amount: Optional[float] = None
    discounted_cost: Optional[float] = None
    original_cost: Optional[float] = None
    tenure: Optional[int] = None
    seats_included_in_base_plan: Optional[int] = None


class License(BaseModel):
    """License resource."""

    id: str
    name: str
    license_type: AllLicenseType
    contract_id: Optional[str] = None
    seats: Optional[int] = None
    price_per_seat: Optional[float] = None
    total_cost: Optional[float] = None
    discount: Optional[dict[str, Any]] = None
    discount_amount: Optional[float] = None
    discounted_cost: Optional[float] = None
    original_cost: Optional[float] = None
    tenure: Optional[int] = None
    seats_included_in_base_plan: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class LicenseInput(BaseModel):
    """Input for creating a license within a contract. SDK only supports USAGE_BASED."""

    name: str
    license_type: LicenseType = LicenseType.USAGE_BASED
    seats: Optional[int] = None
    price_per_seat: Optional[float] = None
    total_cost: Optional[float] = None
    discount: Optional[dict[str, Any]] = None
    discount_amount: Optional[float] = None
    discounted_cost: Optional[float] = None
    original_cost: Optional[float] = None
    tenure: Optional[int] = None
    seats_included_in_base_plan: Optional[int] = None


class CreateLicenseInput(BaseModel):
    """Input for creating a standalone license."""

    name: str
    license_type: LicenseType = LicenseType.USAGE_BASED
    seats: Optional[int] = None
    price_per_seat: Optional[float] = None
    total_cost: Optional[float] = None
    discount: Optional[dict[str, Any]] = None
    discount_amount: Optional[float] = None
    discounted_cost: Optional[float] = None
    original_cost: Optional[float] = None
    tenure: Optional[int] = None
    seats_included_in_base_plan: Optional[int] = None


class UpdateLicenseInput(BaseModel):
    """Input for updating a license."""

    name: Optional[str] = None
    license_type: Optional[LicenseType] = None
    seats: Optional[int] = None
    price_per_seat: Optional[float] = None
    total_cost: Optional[float] = None
    discount: Optional[dict[str, Any]] = None
    discount_amount: Optional[float] = None
    discounted_cost: Optional[float] = None
    original_cost: Optional[float] = None
    tenure: Optional[int] = None
    seats_included_in_base_plan: Optional[int] = None


class Expense(BaseModel):
    """Expense resource."""

    id: str
    app_id: Optional[str] = None
    contract_id: Optional[str] = None
    license_id: Optional[str] = None
    total: float
    date: Optional[str] = None
    month: Optional[int] = None
    year: Optional[int] = None
    description: Optional[str] = None
    transaction_id: Optional[str] = None
    vendor: Optional[str] = None
    payment_channel: Optional[str] = None
    currency: str = "USD"
    created_at: datetime
    updated_at: Optional[datetime] = None


class Contract(BaseModel):
    """Contract resource."""

    id: str
    app_id: str
    title: str
    contract_type: ContractType
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    currency: Optional[str] = None
    cost: Optional[float] = None
    cost_break_down: Optional[dict[str, Any]] = None
    cost_amortization: Optional[CostAmortization] = None
    add_ons: Optional[dict[str, Any]] = None
    add_ons_total_cost: Optional[float] = None
    total_contract_cost: Optional[float] = None
    total_discount_amount: Optional[float] = None
    total_original_cost: Optional[float] = None
    licenses: list[LicenseInContract] = Field(default_factory=list)
    expenses: list[Expense] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class CreateContractInput(BaseModel):
    """Input for creating a contract."""

    title: Optional[str] = None
    contract_type: ContractType = ContractType.PAY_AS_YOU_GO
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    currency: Optional[str] = None
    cost: Optional[float] = None
    cost_break_down: Optional[dict[str, Any]] = None
    cost_amortization: Optional[CostAmortization] = None
    add_ons: Optional[dict[str, Any]] = None
    add_ons_total_cost: Optional[float] = None
    total_contract_cost: Optional[float] = None
    total_discount_amount: Optional[float] = None
    total_original_cost: Optional[float] = None
    licenses: list[LicenseInput] = Field(default_factory=list)
    expense_ids: Optional[list[str]] = None


class UpdateContractInput(BaseModel):
    """Input for updating a contract."""

    title: Optional[str] = None
    contract_type: Optional[ContractType] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    currency: Optional[str] = None
    cost: Optional[float] = None
    cost_break_down: Optional[dict[str, Any]] = None
    cost_amortization: Optional[CostAmortization] = None
    add_ons: Optional[dict[str, Any]] = None
    add_ons_total_cost: Optional[float] = None
    total_contract_cost: Optional[float] = None
    total_discount_amount: Optional[float] = None
    total_original_cost: Optional[float] = None


class Metric(BaseModel):
    """Metric resource."""

    id: str
    license_id: str
    metric_type: str
    usage_aggregation_type: UsageAggregationType = UsageAggregationType.SUM
    rate_kind: RateKind = RateKind.PER_UNIT
    entitlement_period: Optional[EntitlementPeriod] = None
    carryover_policy: Optional[CarryoverPolicy] = None
    usage_rate: Optional[float] = None
    usage_limit: Optional[float] = None
    usage_included: Optional[float] = None
    per_unit_cap: Optional[float] = None
    usage_rate_is_estimated: Optional[bool] = None
    usage_custom_unit_label: Optional[str] = None
    expected_emission_interval_minutes: Optional[int] = None
    created_at: datetime
    updated_at: datetime


class CreateMetricInput(BaseModel):
    """Input for creating a metric."""

    metric_type: str
    usage_aggregation_type: Optional[UsageAggregationType] = None
    rate_kind: Optional[RateKind] = None
    entitlement_period: Optional[EntitlementPeriod] = None
    carryover_policy: Optional[CarryoverPolicy] = None
    usage_rate: Optional[float] = None
    usage_limit: Optional[float] = None
    usage_included: Optional[float] = None
    per_unit_cap: Optional[float] = None
    usage_rate_is_estimated: Optional[bool] = None
    usage_custom_unit_label: Optional[str] = None
    expected_emission_interval_minutes: Optional[int] = None


class UpdateMetricInput(BaseModel):
    """Input for updating a metric."""

    metric_type: Optional[str] = None
    usage_aggregation_type: Optional[UsageAggregationType] = None
    rate_kind: Optional[RateKind] = None
    entitlement_period: Optional[EntitlementPeriod] = None
    carryover_policy: Optional[CarryoverPolicy] = None
    usage_rate: Optional[float] = None
    usage_limit: Optional[float] = None
    usage_included: Optional[float] = None
    per_unit_cap: Optional[float] = None
    usage_rate_is_estimated: Optional[bool] = None
    usage_custom_unit_label: Optional[str] = None
    expected_emission_interval_minutes: Optional[int] = None


class ListAppsParams(BaseModel):
    """Parameters for listing apps."""
    cursor: Optional[str] = None
    limit: Optional[int] = None
    name: Optional[str] = None


class ListContractsParams(BaseModel):
    """Parameters for listing contracts."""
    cursor: Optional[str] = None
    limit: Optional[int] = None
    contract_type: Optional[ContractType] = None


class ListLicensesParams(BaseModel):
    """Parameters for listing licenses."""
    cursor: Optional[str] = None
    limit: Optional[int] = None
    license_type: Optional[AllLicenseType] = None


class ListMetricsParams(BaseModel):
    """Parameters for listing metrics."""
    cursor: Optional[str] = None
    limit: Optional[int] = None
    metric_type: Optional[str] = None


class ListExpensesParams(BaseModel):
    """Parameters for listing expenses."""
    cursor: Optional[str] = None
    limit: Optional[int] = None
    app_id: Optional[str] = None
    contract_id: Optional[str] = None
    year: Optional[int] = None
    month: Optional[int] = None


class PaginationParams(BaseModel):
    """Pagination parameters."""

    limit: int = 25
    cursor: Optional[str] = None


class PaginatedResponse(BaseModel):
    """Paginated response wrapper."""

    data: list[Any]
    cursor: Optional[str] = None
    has_more: bool = False


class RateLimit(BaseModel):
    """Rate limit info from API."""

    limit: int
    remaining: int
    reset: datetime
