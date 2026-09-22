<?php

declare(strict_types=1);

namespace Doow\Track;

enum EventKind: string
{
    case USAGE = 'USAGE';
    case ADJUSTMENT = 'ADJUSTMENT';
}

enum ContractType: string
{
    case PAY_AS_YOU_GO = 'PAY_AS_YOU_GO';
    case ENTERPRISE = 'ENTERPRISE';
    case UNKNOWN = 'UNKNOWN';
}

/** License types for SDK creation. SDK only supports USAGE_BASED. */
enum LicenseType: string
{
    case USAGE_BASED = 'USAGE_BASED';
}

/** All license types (for responses that may include UI-created licenses) */
enum AllLicenseType: string
{
    case USAGE_BASED = 'USAGE_BASED';
    case SEAT_BASED = 'SEAT_BASED';
    case PREPAID_CREDITS = 'PREPAID_CREDITS';
    case FLAT_RATE = 'FLAT_RATE';
}

enum UsageAggregationType: string
{
    case SUM = 'SUM';
    case MAX = 'MAX';
    case CUMULATIVE = 'CUMULATIVE';
}

enum RateKind: string
{
    case PER_UNIT = 'PER_UNIT';
    case FLAT_FEE = 'FLAT_FEE';
    case PER_SEAT = 'PER_SEAT';
    case TIERED = 'TIERED';
    case VOLUME = 'VOLUME';
}

enum EntitlementPeriod: string
{
    case MONTHLY = 'MONTHLY';
    case YEARLY = 'YEARLY';
    case QUARTERLY = 'QUARTERLY';
    case WEEKLY = 'WEEKLY';
    case DAILY = 'DAILY';
    case ONE_TIME = 'ONE_TIME';
}

enum CarryoverPolicy: string
{
    case EXPIRE_AT_PERIOD_END = 'EXPIRE_AT_PERIOD_END';
    case ROLLOVER = 'ROLLOVER';
    case ROLLOVER_CAPPED = 'ROLLOVER_CAPPED';
}

enum CostAmortization: string
{
    case PRORATA = 'PRORATA';
    case MONTHS = 'MONTHS';
    case QUARTER = 'QUARTER';
    case YEARS = 'YEARS';
}

class MetricTupleHint
{
    public function __construct(
        public string $appName,
        public string $licenseName,
        public string $metricName,
    ) {}

    public function toArray(): array
    {
        return [
            'app_name' => $this->appName,
            'license_name' => $this->licenseName,
            'metric_name' => $this->metricName,
        ];
    }
}

class TrackEvent
{
    public function __construct(
        public string $metric,
        public float $quantity,
        public string $licenseId,
        public ?string $unit = null,
        public EventKind $kind = EventKind::USAGE,
        public ?\DateTimeInterface $timestamp = null,
        public ?string $sourceSystem = null,
        public ?MetricTupleHint $metricTupleHint = null,
        public ?array $attribution = null,
        public ?array $metadata = null,
    ) {}

    public function toArray(): array
    {
        return array_filter([
            'metric' => $this->metric,
            'quantity' => $this->quantity,
            'license_id' => $this->licenseId,
            'unit' => $this->unit,
            'kind' => $this->kind->value,
            'timestamp' => $this->timestamp?->format('c'),
            'source_system' => $this->sourceSystem,
            'metric_tuple_hint' => $this->metricTupleHint?->toArray(),
            'attribution' => $this->attribution,
            'metadata' => $this->metadata,
        ], fn($v) => $v !== null);
    }
}

class App
{
    public function __construct(
        public string $id,
        public string $name,
        public ?string $description = null,
        public ?string $website = null,
        public ?string $logoUrl = null,
        public ?array $categories = null,
        public ?string $saasApplicationId = null,
        public ?string $createdAt = null,
        public ?string $updatedAt = null,
    ) {}

    public static function fromArray(array $data): self
    {
        return new self(
            id: $data['id'],
            name: $data['name'],
            description: $data['description'] ?? null,
            website: $data['website'] ?? null,
            logoUrl: $data['logo_url'] ?? null,
            categories: $data['categories'] ?? null,
            saasApplicationId: $data['saas_application_id'] ?? null,
            createdAt: $data['created_at'] ?? null,
            updatedAt: $data['updated_at'] ?? null,
        );
    }
}

class License
{
    public function __construct(
        public string $id,
        public string $name,
        public AllLicenseType $licenseType,
        public ?string $contractId = null,
        public ?int $seats = null,
        public ?float $pricePerSeat = null,
        public ?float $totalCost = null,
        public ?array $discount = null,
        public ?float $discountAmount = null,
        public ?float $discountedCost = null,
        public ?float $originalCost = null,
        public ?int $tenure = null,
        public ?int $seatsIncludedInBasePlan = null,
        public ?string $createdAt = null,
        public ?string $updatedAt = null,
    ) {}

    public static function fromArray(array $data): self
    {
        return new self(
            id: $data['id'],
            name: $data['name'],
            licenseType: AllLicenseType::from($data['license_type']),
            contractId: $data['contract_id'] ?? null,
            seats: $data['seats'] ?? null,
            pricePerSeat: $data['price_per_seat'] ?? null,
            totalCost: $data['total_cost'] ?? null,
            discount: $data['discount'] ?? null,
            discountAmount: $data['discount_amount'] ?? null,
            discountedCost: $data['discounted_cost'] ?? null,
            originalCost: $data['original_cost'] ?? null,
            tenure: $data['tenure'] ?? null,
            seatsIncludedInBasePlan: $data['seats_included_in_base_plan'] ?? null,
            createdAt: $data['created_at'] ?? null,
            updatedAt: $data['updated_at'] ?? null,
        );
    }
}

class Expense
{
    public function __construct(
        public string $id,
        public ?string $appId = null,
        public ?string $contractId = null,
        public ?string $licenseId = null,
        public float $total = 0,
        public ?string $date = null,
        public ?int $month = null,
        public ?int $year = null,
        public ?string $description = null,
        public ?string $transactionId = null,
        public ?string $vendor = null,
        public ?string $paymentChannel = null,
        public string $currency = 'USD',
        public ?string $createdAt = null,
        public ?string $updatedAt = null,
    ) {}

    public static function fromArray(array $data): self
    {
        return new self(
            id: $data['id'],
            appId: $data['app_id'] ?? null,
            contractId: $data['contract_id'] ?? null,
            licenseId: $data['license_id'] ?? null,
            total: $data['total'] ?? 0,
            date: $data['date'] ?? null,
            month: $data['month'] ?? null,
            year: $data['year'] ?? null,
            description: $data['description'] ?? null,
            transactionId: $data['transaction_id'] ?? null,
            vendor: $data['vendor'] ?? null,
            paymentChannel: $data['payment_channel'] ?? null,
            currency: $data['currency'] ?? 'USD',
            createdAt: $data['created_at'] ?? null,
            updatedAt: $data['updated_at'] ?? null,
        );
    }
}

class Contract
{
    public function __construct(
        public string $id,
        public string $appId,
        public string $title,
        public ContractType $contractType,
        public ?string $startDate = null,
        public ?string $endDate = null,
        public ?string $currency = null,
        public ?float $cost = null,
        public ?array $costBreakDown = null,
        public ?CostAmortization $costAmortization = null,
        public ?array $addOns = null,
        public ?float $addOnsTotalCost = null,
        public ?float $totalContractCost = null,
        public ?float $totalDiscountAmount = null,
        public ?float $totalOriginalCost = null,
        public array $licenses = [],
        public array $expenses = [],
        public ?string $createdAt = null,
        public ?string $updatedAt = null,
    ) {}

    public static function fromArray(array $data): self
    {
        $licenses = array_map(
            fn($l) => License::fromArray($l),
            $data['licenses'] ?? []
        );
        $expenses = array_map(
            fn($e) => Expense::fromArray($e),
            $data['expenses'] ?? []
        );

        return new self(
            id: $data['id'],
            appId: $data['app_id'],
            title: $data['title'],
            contractType: ContractType::from($data['contract_type']),
            startDate: $data['start_date'] ?? null,
            endDate: $data['end_date'] ?? null,
            currency: $data['currency'] ?? null,
            cost: $data['cost'] ?? null,
            costBreakDown: $data['cost_break_down'] ?? null,
            costAmortization: isset($data['cost_amortization']) ? CostAmortization::from($data['cost_amortization']) : null,
            addOns: $data['add_ons'] ?? null,
            addOnsTotalCost: $data['add_ons_total_cost'] ?? null,
            totalContractCost: $data['total_contract_cost'] ?? null,
            totalDiscountAmount: $data['total_discount_amount'] ?? null,
            totalOriginalCost: $data['total_original_cost'] ?? null,
            licenses: $licenses,
            expenses: $expenses,
            createdAt: $data['created_at'] ?? null,
            updatedAt: $data['updated_at'] ?? null,
        );
    }
}

class Metric
{
    public function __construct(
        public string $id,
        public string $licenseId,
        public string $metricType,
        public UsageAggregationType $usageAggregationType = UsageAggregationType::SUM,
        public RateKind $rateKind = RateKind::PER_UNIT,
        public ?EntitlementPeriod $entitlementPeriod = null,
        public ?CarryoverPolicy $carryoverPolicy = null,
        public ?float $usageRate = null,
        public ?float $usageLimit = null,
        public ?float $usageIncluded = null,
        public ?float $perUnitCap = null,
        public ?bool $usageRateIsEstimated = null,
        public ?string $usageCustomUnitLabel = null,
        public ?int $expectedEmissionIntervalMinutes = null,
        public ?string $createdAt = null,
        public ?string $updatedAt = null,
    ) {}

    public static function fromArray(array $data): self
    {
        return new self(
            id: $data['id'],
            licenseId: $data['license_id'],
            metricType: $data['metric_type'],
            usageAggregationType: UsageAggregationType::from($data['usage_aggregation_type'] ?? 'SUM'),
            rateKind: RateKind::from($data['rate_kind'] ?? 'PER_UNIT'),
            entitlementPeriod: isset($data['entitlement_period']) ? EntitlementPeriod::from($data['entitlement_period']) : null,
            carryoverPolicy: isset($data['carryover_policy']) ? CarryoverPolicy::from($data['carryover_policy']) : null,
            usageRate: $data['usage_rate'] ?? null,
            usageLimit: $data['usage_limit'] ?? null,
            usageIncluded: $data['usage_included'] ?? null,
            perUnitCap: $data['per_unit_cap'] ?? null,
            usageRateIsEstimated: $data['usage_rate_is_estimated'] ?? null,
            usageCustomUnitLabel: $data['usage_custom_unit_label'] ?? null,
            expectedEmissionIntervalMinutes: $data['expected_emission_interval_minutes'] ?? null,
            createdAt: $data['created_at'] ?? null,
            updatedAt: $data['updated_at'] ?? null,
        );
    }
}

class PaginatedResponse
{
    public function __construct(
        public array $data,
        public ?string $cursor = null,
        public bool $hasMore = false,
    ) {}
}
