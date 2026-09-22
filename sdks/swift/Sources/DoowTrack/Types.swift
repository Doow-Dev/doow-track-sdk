import Foundation

public enum EventKind: String, Codable {
    case usage = "USAGE"
    case adjustment = "ADJUSTMENT"
}

public enum ContractType: String, Codable {
    case payAsYouGo = "PAY_AS_YOU_GO"
    case enterprise = "ENTERPRISE"
    case unknown = "UNKNOWN"
}

/// License types for SDK creation. SDK only supports USAGE_BASED.
public enum LicenseType: String, Codable {
    case usageBased = "USAGE_BASED"
}

/// All license types (for responses that may include UI-created licenses)
public enum AllLicenseType: String, Codable {
    case usageBased = "USAGE_BASED"
    case seatBased = "SEAT_BASED"
    case prepaidCredits = "PREPAID_CREDITS"
    case flatRate = "FLAT_RATE"
}

public enum UsageAggregationType: String, Codable {
    case sum = "SUM"
    case max = "MAX"
    case cumulative = "CUMULATIVE"
}

public enum RateKind: String, Codable {
    case perUnit = "PER_UNIT"
    case flatFee = "FLAT_FEE"
    case perSeat = "PER_SEAT"
    case tiered = "TIERED"
    case volume = "VOLUME"
}

public enum EntitlementPeriod: String, Codable {
    case monthly = "MONTHLY"
    case yearly = "YEARLY"
    case quarterly = "QUARTERLY"
    case weekly = "WEEKLY"
    case daily = "DAILY"
    case oneTime = "ONE_TIME"
}

public enum CarryoverPolicy: String, Codable {
    case expireAtPeriodEnd = "EXPIRE_AT_PERIOD_END"
    case rollover = "ROLLOVER"
    case rolloverCapped = "ROLLOVER_CAPPED"
}

public enum CostAmortization: String, Codable {
    case prorata = "PRORATA"
    case months = "MONTHS"
    case quarter = "QUARTER"
    case years = "YEARS"
}

public struct MetricTupleHint: Codable {
    public var appName: String
    public var licenseName: String
    public var metricName: String

    enum CodingKeys: String, CodingKey {
        case appName = "app_name"
        case licenseName = "license_name"
        case metricName = "metric_name"
    }

    public init(appName: String, licenseName: String, metricName: String) {
        self.appName = appName
        self.licenseName = licenseName
        self.metricName = metricName
    }
}

public struct TrackEvent: Codable {
    public var metric: String
    public var quantity: Double
    public var licenseId: String
    public var unit: String?
    public var kind: EventKind
    public var timestamp: Date?
    public var sourceSystem: String?
    public var metricTupleHint: MetricTupleHint?
    public var attribution: [String: AnyCodable]?
    public var metadata: [String: AnyCodable]?

    enum CodingKeys: String, CodingKey {
        case metric, quantity, unit, kind, timestamp, attribution, metadata
        case licenseId = "license_id"
        case sourceSystem = "source_system"
        case metricTupleHint = "metric_tuple_hint"
    }

    public init(
        metric: String,
        quantity: Double,
        licenseId: String,
        unit: String? = nil,
        kind: EventKind = .usage,
        timestamp: Date? = nil,
        sourceSystem: String? = nil,
        metricTupleHint: MetricTupleHint? = nil,
        attribution: [String: AnyCodable]? = nil,
        metadata: [String: AnyCodable]? = nil
    ) {
        self.metric = metric
        self.quantity = quantity
        self.licenseId = licenseId
        self.unit = unit
        self.kind = kind
        self.timestamp = timestamp
        self.sourceSystem = sourceSystem
        self.metricTupleHint = metricTupleHint
        self.attribution = attribution
        self.metadata = metadata
    }
}

public struct App: Codable {
    public let id: String
    public let name: String
    public let description: String?
    public let website: String?
    public let logoUrl: String?
    public let categories: [String]?
    public let saasApplicationId: String?
    public let createdAt: Date?
    public let updatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, name, description, website, categories
        case logoUrl = "logo_url"
        case saasApplicationId = "saas_application_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

public struct License: Codable {
    public let id: String
    public let name: String
    public let licenseType: AllLicenseType
    public let contractId: String?
    public let seats: Int?
    public let pricePerSeat: Double?
    public let totalCost: Double?
    public let createdAt: Date?
    public let updatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, name, seats
        case licenseType = "license_type"
        case contractId = "contract_id"
        case pricePerSeat = "price_per_seat"
        case totalCost = "total_cost"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

public struct Expense: Codable {
    public let id: String
    public let appId: String?
    public let contractId: String?
    public let licenseId: String?
    public let total: Double
    public let date: String?
    public let month: Int?
    public let year: Int?
    public let description: String?
    public let transactionId: String?
    public let vendor: String?
    public let paymentChannel: String?
    public let currency: String?
    public let createdAt: Date?
    public let updatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, total, date, month, year, description, vendor, currency
        case appId = "app_id"
        case contractId = "contract_id"
        case licenseId = "license_id"
        case transactionId = "transaction_id"
        case paymentChannel = "payment_channel"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

public struct Contract: Codable {
    public let id: String
    public let appId: String
    public let title: String
    public let contractType: ContractType
    public let startDate: String?
    public let endDate: String?
    public let currency: String?
    public let cost: Double?
    public let costAmortization: CostAmortization?
    public let totalContractCost: Double?
    public let totalDiscountAmount: Double?
    public let totalOriginalCost: Double?
    public let licenses: [License]?
    public let expenses: [Expense]?
    public let createdAt: Date?
    public let updatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, title, licenses, expenses, currency, cost
        case appId = "app_id"
        case contractType = "contract_type"
        case startDate = "start_date"
        case endDate = "end_date"
        case costAmortization = "cost_amortization"
        case totalContractCost = "total_contract_cost"
        case totalDiscountAmount = "total_discount_amount"
        case totalOriginalCost = "total_original_cost"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

public struct Metric: Codable {
    public let id: String
    public let licenseId: String
    public let metricType: String
    public let usageAggregationType: UsageAggregationType?
    public let rateKind: RateKind?
    public let entitlementPeriod: EntitlementPeriod?
    public let carryoverPolicy: CarryoverPolicy?
    public let usageRate: Double?
    public let usageLimit: Double?
    public let usageIncluded: Double?
    public let perUnitCap: Double?
    public let usageRateIsEstimated: Bool?
    public let usageCustomUnitLabel: String?
    public let expectedEmissionIntervalMinutes: Int?
    public let createdAt: Date?
    public let updatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case licenseId = "license_id"
        case metricType = "metric_type"
        case usageAggregationType = "usage_aggregation_type"
        case rateKind = "rate_kind"
        case entitlementPeriod = "entitlement_period"
        case carryoverPolicy = "carryover_policy"
        case usageRate = "usage_rate"
        case usageLimit = "usage_limit"
        case usageIncluded = "usage_included"
        case perUnitCap = "per_unit_cap"
        case usageRateIsEstimated = "usage_rate_is_estimated"
        case usageCustomUnitLabel = "usage_custom_unit_label"
        case expectedEmissionIntervalMinutes = "expected_emission_interval_minutes"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

public struct PaginatedResponse<T: Codable>: Codable {
    public let data: [T]
    public let cursor: String?
    public let hasMore: Bool

    enum CodingKeys: String, CodingKey {
        case data, cursor
        case hasMore = "has_more"
    }
}

public struct CreateAppInput: Codable {
    public var name: String
    public var description: String?
    public var website: String?
    public var logoUrl: String?
    public var categories: [String]?

    enum CodingKeys: String, CodingKey {
        case name, description, website, categories
        case logoUrl = "logo_url"
    }

    public init(name: String, description: String? = nil, website: String? = nil, categories: [String]? = nil) {
        self.name = name
        self.description = description
        self.website = website
        self.categories = categories
    }
}

public struct LicenseInput: Codable {
    public var name: String
    public var licenseType: LicenseType

    enum CodingKeys: String, CodingKey {
        case name
        case licenseType = "license_type"
    }

    public init(name: String, licenseType: LicenseType = .usageBased) {
        self.name = name
        self.licenseType = licenseType
    }
}

public struct CreateContractInput: Codable {
    public var title: String?
    public var contractType: ContractType
    public var startDate: String?
    public var endDate: String?
    public var currency: String?
    public var cost: Double?
    public var licenses: [LicenseInput]

    enum CodingKeys: String, CodingKey {
        case title, licenses, currency, cost
        case contractType = "contract_type"
        case startDate = "start_date"
        case endDate = "end_date"
    }

    public init(title: String? = nil, contractType: ContractType = .payAsYouGo, licenses: [LicenseInput] = []) {
        self.title = title
        self.contractType = contractType
        self.licenses = licenses
    }
}

public struct CreateMetricInput: Codable {
    public var metricType: String
    public var usageAggregationType: UsageAggregationType?
    public var rateKind: RateKind?
    public var entitlementPeriod: EntitlementPeriod?
    public var carryoverPolicy: CarryoverPolicy?
    public var usageRate: Double?
    public var usageLimit: Double?
    public var usageIncluded: Double?

    enum CodingKeys: String, CodingKey {
        case metricType = "metric_type"
        case usageAggregationType = "usage_aggregation_type"
        case rateKind = "rate_kind"
        case entitlementPeriod = "entitlement_period"
        case carryoverPolicy = "carryover_policy"
        case usageRate = "usage_rate"
        case usageLimit = "usage_limit"
        case usageIncluded = "usage_included"
    }

    public init(metricType: String) {
        self.metricType = metricType
    }
}

public struct AnyCodable: Codable {
    public let value: Any

    public init(_ value: Any) {
        self.value = value
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else {
            value = try container.decode([String: AnyCodable].self)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let int = value as? Int {
            try container.encode(int)
        } else if let double = value as? Double {
            try container.encode(double)
        } else if let string = value as? String {
            try container.encode(string)
        } else if let bool = value as? Bool {
            try container.encode(bool)
        } else if let dict = value as? [String: AnyCodable] {
            try container.encode(dict)
        }
    }
}
