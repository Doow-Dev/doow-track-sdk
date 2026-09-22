enum EventKind { usage, adjustment }

enum ContractType { payAsYouGo, enterprise, unknown }

/// License types for SDK creation. SDK only supports USAGE_BASED.
enum LicenseType { usageBased }

/// All license types (for responses that may include UI-created licenses)
enum AllLicenseType { usageBased, seatBased, prepaidCredits, flatRate }

enum UsageAggregationType { sum, max, cumulative }

enum RateKind { perUnit, flatFee, perSeat, tiered, volume }

enum EntitlementPeriod { monthly, yearly, quarterly, weekly, daily, oneTime }

enum CarryoverPolicy { expireAtPeriodEnd, rollover, rolloverCapped }

enum CostAmortization { prorata, months, quarter, years }

class MetricTupleHint {
  final String appName;
  final String licenseName;
  final String metricName;

  MetricTupleHint({
    required this.appName,
    required this.licenseName,
    required this.metricName,
  });

  Map<String, dynamic> toJson() => {
        'app_name': appName,
        'license_name': licenseName,
        'metric_name': metricName,
      };

  factory MetricTupleHint.fromJson(Map<String, dynamic> json) => MetricTupleHint(
        appName: json['app_name'] as String,
        licenseName: json['license_name'] as String,
        metricName: json['metric_name'] as String,
      );
}

class TrackEvent {
  final String metric;
  final double quantity;
  final String licenseId;
  final String? unit;
  final EventKind kind;
  final Map<String, dynamic>? attribution;
  final Map<String, dynamic>? metadata;
  final DateTime? timestamp;
  final String? sourceSystem;
  final MetricTupleHint? metricTupleHint;

  TrackEvent({
    required this.metric,
    required this.quantity,
    required this.licenseId,
    this.unit,
    this.kind = EventKind.usage,
    this.attribution,
    this.metadata,
    this.timestamp,
    this.sourceSystem,
    this.metricTupleHint,
  });

  Map<String, dynamic> toJson() => {
        'metric': metric,
        'quantity': quantity,
        'license_id': licenseId,
        if (unit != null) 'unit': unit,
        'kind': kind == EventKind.usage ? 'USAGE' : 'ADJUSTMENT',
        if (attribution != null) 'attribution': attribution,
        if (metadata != null) 'metadata': metadata,
        'timestamp': (timestamp ?? DateTime.now()).toUtc().toIso8601String(),
        if (sourceSystem != null) 'source_system': sourceSystem,
        if (metricTupleHint != null) 'metric_tuple_hint': metricTupleHint!.toJson(),
      };

  factory TrackEvent.fromJson(Map<String, dynamic> json) => TrackEvent(
        metric: json['metric'] as String,
        quantity: (json['quantity'] as num).toDouble(),
        licenseId: json['license_id'] as String,
        unit: json['unit'] as String?,
        kind: json['kind'] == 'ADJUSTMENT' ? EventKind.adjustment : EventKind.usage,
        attribution: json['attribution'] as Map<String, dynamic>?,
        metadata: json['metadata'] as Map<String, dynamic>?,
        timestamp: json['timestamp'] != null
            ? DateTime.parse(json['timestamp'] as String)
            : null,
        sourceSystem: json['source_system'] as String?,
        metricTupleHint: json['metric_tuple_hint'] != null
            ? MetricTupleHint.fromJson(json['metric_tuple_hint'] as Map<String, dynamic>)
            : null,
      );
}

class App {
  final String id;
  final String name;
  final String? description;
  final String? website;
  final String? logoUrl;
  final List<String>? categories;
  final String? saasApplicationId;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  App({
    required this.id,
    required this.name,
    this.description,
    this.website,
    this.logoUrl,
    this.categories,
    this.saasApplicationId,
    this.createdAt,
    this.updatedAt,
  });

  factory App.fromJson(Map<String, dynamic> json) => App(
        id: json['id'] as String,
        name: json['name'] as String,
        description: json['description'] as String?,
        website: json['website'] as String?,
        logoUrl: json['logo_url'] as String?,
        categories: (json['categories'] as List<dynamic>?)?.cast<String>(),
        saasApplicationId: json['saas_application_id'] as String?,
        createdAt: json['created_at'] != null ? DateTime.parse(json['created_at'] as String) : null,
        updatedAt: json['updated_at'] != null ? DateTime.parse(json['updated_at'] as String) : null,
      );
}

class License {
  final String id;
  final String name;
  final AllLicenseType licenseType;
  final String? contractId;
  final int? seats;
  final double? pricePerSeat;
  final double? totalCost;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  License({
    required this.id,
    required this.name,
    required this.licenseType,
    this.contractId,
    this.seats,
    this.pricePerSeat,
    this.totalCost,
    this.createdAt,
    this.updatedAt,
  });

  factory License.fromJson(Map<String, dynamic> json) => License(
        id: json['id'] as String,
        name: json['name'] as String,
        licenseType: _parseAllLicenseType(json['license_type'] ?? json['licenseType']),
        contractId: json['contract_id'] as String?,
        seats: json['seats'] as int?,
        pricePerSeat: (json['price_per_seat'] as num?)?.toDouble(),
        totalCost: (json['total_cost'] as num?)?.toDouble(),
        createdAt: json['created_at'] != null ? DateTime.parse(json['created_at'] as String) : null,
        updatedAt: json['updated_at'] != null ? DateTime.parse(json['updated_at'] as String) : null,
      );

  static AllLicenseType _parseAllLicenseType(String? value) {
    switch (value) {
      case 'USAGE_BASED':
        return AllLicenseType.usageBased;
      case 'SEAT_BASED':
        return AllLicenseType.seatBased;
      case 'PREPAID_CREDITS':
        return AllLicenseType.prepaidCredits;
      case 'FLAT_RATE':
        return AllLicenseType.flatRate;
      default:
        return AllLicenseType.usageBased;
    }
  }
}

class Contract {
  final String id;
  final String appId;
  final String title;
  final ContractType contractType;
  final String? startDate;
  final String? endDate;
  final String? currency;
  final double? cost;
  final CostAmortization? costAmortization;
  final double? totalContractCost;
  final double? totalDiscountAmount;
  final double? totalOriginalCost;
  final List<License>? licenses;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  Contract({
    required this.id,
    required this.appId,
    required this.title,
    required this.contractType,
    this.startDate,
    this.endDate,
    this.currency,
    this.cost,
    this.costAmortization,
    this.totalContractCost,
    this.totalDiscountAmount,
    this.totalOriginalCost,
    this.licenses,
    this.createdAt,
    this.updatedAt,
  });

  factory Contract.fromJson(Map<String, dynamic> json) => Contract(
        id: json['id'] as String,
        appId: json['app_id'] as String,
        title: json['title'] as String,
        contractType: _parseContractType(json['contract_type'] ?? json['contractType']),
        startDate: json['start_date'] as String?,
        endDate: json['end_date'] as String?,
        currency: json['currency'] as String?,
        cost: (json['cost'] as num?)?.toDouble(),
        costAmortization: _parseCostAmortization(json['cost_amortization']),
        totalContractCost: (json['total_contract_cost'] as num?)?.toDouble(),
        totalDiscountAmount: (json['total_discount_amount'] as num?)?.toDouble(),
        totalOriginalCost: (json['total_original_cost'] as num?)?.toDouble(),
        licenses: (json['licenses'] as List<dynamic>?)
            ?.map((e) => License.fromJson(e as Map<String, dynamic>))
            .toList(),
        createdAt: json['created_at'] != null ? DateTime.parse(json['created_at'] as String) : null,
        updatedAt: json['updated_at'] != null ? DateTime.parse(json['updated_at'] as String) : null,
      );

  static ContractType _parseContractType(String? value) {
    switch (value) {
      case 'PAY_AS_YOU_GO':
        return ContractType.payAsYouGo;
      case 'ENTERPRISE':
        return ContractType.enterprise;
      case 'UNKNOWN':
        return ContractType.unknown;
      default:
        return ContractType.payAsYouGo;
    }
  }

  static CostAmortization? _parseCostAmortization(String? value) {
    switch (value) {
      case 'PRORATA':
        return CostAmortization.prorata;
      case 'MONTHS':
        return CostAmortization.months;
      case 'QUARTER':
        return CostAmortization.quarter;
      case 'YEARS':
        return CostAmortization.years;
      default:
        return null;
    }
  }
}

class Metric {
  final String id;
  final String licenseId;
  final String metricType;
  final UsageAggregationType? usageAggregationType;
  final RateKind? rateKind;
  final EntitlementPeriod? entitlementPeriod;
  final CarryoverPolicy? carryoverPolicy;
  final double? usageRate;
  final double? usageLimit;
  final double? usageIncluded;
  final double? perUnitCap;
  final bool? usageRateIsEstimated;
  final String? usageCustomUnitLabel;
  final int? expectedEmissionIntervalMinutes;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  Metric({
    required this.id,
    required this.licenseId,
    required this.metricType,
    this.usageAggregationType,
    this.rateKind,
    this.entitlementPeriod,
    this.carryoverPolicy,
    this.usageRate,
    this.usageLimit,
    this.usageIncluded,
    this.perUnitCap,
    this.usageRateIsEstimated,
    this.usageCustomUnitLabel,
    this.expectedEmissionIntervalMinutes,
    this.createdAt,
    this.updatedAt,
  });

  factory Metric.fromJson(Map<String, dynamic> json) => Metric(
        id: json['id'] as String,
        licenseId: json['license_id'] ?? json['licenseId'] as String,
        metricType: json['metric_type'] ?? json['metricType'] as String,
        usageAggregationType: _parseUsageAggregationType(json['usage_aggregation_type']),
        rateKind: _parseRateKind(json['rate_kind']),
        entitlementPeriod: _parseEntitlementPeriod(json['entitlement_period']),
        carryoverPolicy: _parseCarryoverPolicy(json['carryover_policy']),
        usageRate: (json['usage_rate'] as num?)?.toDouble(),
        usageLimit: (json['usage_limit'] as num?)?.toDouble(),
        usageIncluded: (json['usage_included'] as num?)?.toDouble(),
        perUnitCap: (json['per_unit_cap'] as num?)?.toDouble(),
        usageRateIsEstimated: json['usage_rate_is_estimated'] as bool?,
        usageCustomUnitLabel: json['usage_custom_unit_label'] as String?,
        expectedEmissionIntervalMinutes: json['expected_emission_interval_minutes'] as int?,
        createdAt: json['created_at'] != null ? DateTime.parse(json['created_at'] as String) : null,
        updatedAt: json['updated_at'] != null ? DateTime.parse(json['updated_at'] as String) : null,
      );

  static UsageAggregationType? _parseUsageAggregationType(String? value) {
    switch (value) {
      case 'SUM': return UsageAggregationType.sum;
      case 'MAX': return UsageAggregationType.max;
      case 'CUMULATIVE': return UsageAggregationType.cumulative;
      default: return null;
    }
  }

  static RateKind? _parseRateKind(String? value) {
    switch (value) {
      case 'PER_UNIT': return RateKind.perUnit;
      case 'FLAT_FEE': return RateKind.flatFee;
      case 'PER_SEAT': return RateKind.perSeat;
      case 'TIERED': return RateKind.tiered;
      case 'VOLUME': return RateKind.volume;
      default: return null;
    }
  }

  static EntitlementPeriod? _parseEntitlementPeriod(String? value) {
    switch (value) {
      case 'MONTHLY': return EntitlementPeriod.monthly;
      case 'YEARLY': return EntitlementPeriod.yearly;
      case 'QUARTERLY': return EntitlementPeriod.quarterly;
      case 'WEEKLY': return EntitlementPeriod.weekly;
      case 'DAILY': return EntitlementPeriod.daily;
      case 'ONE_TIME': return EntitlementPeriod.oneTime;
      default: return null;
    }
  }

  static CarryoverPolicy? _parseCarryoverPolicy(String? value) {
    switch (value) {
      case 'EXPIRE_AT_PERIOD_END': return CarryoverPolicy.expireAtPeriodEnd;
      case 'ROLLOVER': return CarryoverPolicy.rollover;
      case 'ROLLOVER_CAPPED': return CarryoverPolicy.rolloverCapped;
      default: return null;
    }
  }
}

class Expense {
  final String id;
  final String? appId;
  final String? contractId;
  final String? licenseId;
  final double total;
  final String? date;
  final int? month;
  final int? year;
  final String? description;
  final String? transactionId;
  final String? vendor;
  final String? paymentChannel;
  final String currency;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  Expense({
    required this.id,
    this.appId,
    this.contractId,
    this.licenseId,
    required this.total,
    this.date,
    this.month,
    this.year,
    this.description,
    this.transactionId,
    this.vendor,
    this.paymentChannel,
    this.currency = 'USD',
    this.createdAt,
    this.updatedAt,
  });

  factory Expense.fromJson(Map<String, dynamic> json) => Expense(
        id: json['id'] as String,
        appId: json['app_id'] as String?,
        contractId: json['contract_id'] as String?,
        licenseId: json['license_id'] as String?,
        total: (json['total'] as num).toDouble(),
        date: json['date'] as String?,
        month: json['month'] as int?,
        year: json['year'] as int?,
        description: json['description'] as String?,
        transactionId: json['transaction_id'] as String?,
        vendor: json['vendor'] as String?,
        paymentChannel: json['payment_channel'] as String?,
        currency: json['currency'] as String? ?? 'USD',
        createdAt: json['created_at'] != null ? DateTime.parse(json['created_at'] as String) : null,
        updatedAt: json['updated_at'] != null ? DateTime.parse(json['updated_at'] as String) : null,
      );
}

class PaginatedResponse<T> {
  final List<T> data;
  final String? cursor;
  final bool hasMore;

  PaginatedResponse({required this.data, this.cursor, this.hasMore = false});
}

class CreateAppInput {
  final String name;
  final String? description;
  final String? website;
  final String? logoUrl;
  final List<String>? categories;

  CreateAppInput({
    required this.name,
    this.description,
    this.website,
    this.logoUrl,
    this.categories,
  });

  Map<String, dynamic> toJson() => {
        'name': name,
        if (description != null) 'description': description,
        if (website != null) 'website': website,
        if (logoUrl != null) 'logo_url': logoUrl,
        if (categories != null) 'categories': categories,
      };
}

class LicenseInput {
  final String name;
  final LicenseType licenseType;
  final int? seats;
  final double? pricePerSeat;
  final double? totalCost;

  LicenseInput({
    required this.name,
    this.licenseType = LicenseType.usageBased,
    this.seats,
    this.pricePerSeat,
    this.totalCost,
  });

  Map<String, dynamic> toJson() => {
        'name': name,
        'license_type': 'USAGE_BASED',
        if (seats != null) 'seats': seats,
        if (pricePerSeat != null) 'price_per_seat': pricePerSeat,
        if (totalCost != null) 'total_cost': totalCost,
      };
}

class CreateContractInput {
  final String? title;
  final ContractType contractType;
  final String? startDate;
  final String? endDate;
  final String? currency;
  final double? cost;
  final List<LicenseInput>? licenses;

  CreateContractInput({
    this.title,
    this.contractType = ContractType.payAsYouGo,
    this.startDate,
    this.endDate,
    this.currency,
    this.cost,
    this.licenses,
  });

  Map<String, dynamic> toJson() => {
        if (title != null) 'title': title,
        'contract_type': _contractTypeToString(contractType),
        if (startDate != null) 'start_date': startDate,
        if (endDate != null) 'end_date': endDate,
        if (currency != null) 'currency': currency,
        if (cost != null) 'cost': cost,
        if (licenses != null) 'licenses': licenses!.map((l) => l.toJson()).toList(),
      };

  static String _contractTypeToString(ContractType type) {
    switch (type) {
      case ContractType.payAsYouGo:
        return 'PAY_AS_YOU_GO';
      case ContractType.enterprise:
        return 'ENTERPRISE';
      case ContractType.unknown:
        return 'UNKNOWN';
    }
  }
}

class CreateMetricInput {
  final String metricType;
  final UsageAggregationType? usageAggregationType;
  final RateKind? rateKind;
  final EntitlementPeriod? entitlementPeriod;
  final CarryoverPolicy? carryoverPolicy;
  final double? usageRate;
  final double? usageLimit;
  final double? usageIncluded;

  CreateMetricInput({
    required this.metricType,
    this.usageAggregationType,
    this.rateKind,
    this.entitlementPeriod,
    this.carryoverPolicy,
    this.usageRate,
    this.usageLimit,
    this.usageIncluded,
  });

  Map<String, dynamic> toJson() => {
        'metric_type': metricType,
        if (usageAggregationType != null)
          'usage_aggregation_type': _usageAggregationTypeToString(usageAggregationType!),
        if (rateKind != null) 'rate_kind': _rateKindToString(rateKind!),
        if (entitlementPeriod != null)
          'entitlement_period': _entitlementPeriodToString(entitlementPeriod!),
        if (carryoverPolicy != null)
          'carryover_policy': _carryoverPolicyToString(carryoverPolicy!),
        if (usageRate != null) 'usage_rate': usageRate,
        if (usageLimit != null) 'usage_limit': usageLimit,
        if (usageIncluded != null) 'usage_included': usageIncluded,
      };

  static String _usageAggregationTypeToString(UsageAggregationType type) {
    switch (type) {
      case UsageAggregationType.sum: return 'SUM';
      case UsageAggregationType.max: return 'MAX';
      case UsageAggregationType.cumulative: return 'CUMULATIVE';
    }
  }

  static String _rateKindToString(RateKind type) {
    switch (type) {
      case RateKind.perUnit: return 'PER_UNIT';
      case RateKind.flatFee: return 'FLAT_FEE';
      case RateKind.perSeat: return 'PER_SEAT';
      case RateKind.tiered: return 'TIERED';
      case RateKind.volume: return 'VOLUME';
    }
  }

  static String _entitlementPeriodToString(EntitlementPeriod type) {
    switch (type) {
      case EntitlementPeriod.monthly: return 'MONTHLY';
      case EntitlementPeriod.yearly: return 'YEARLY';
      case EntitlementPeriod.quarterly: return 'QUARTERLY';
      case EntitlementPeriod.weekly: return 'WEEKLY';
      case EntitlementPeriod.daily: return 'DAILY';
      case EntitlementPeriod.oneTime: return 'ONE_TIME';
    }
  }

  static String _carryoverPolicyToString(CarryoverPolicy type) {
    switch (type) {
      case CarryoverPolicy.expireAtPeriodEnd: return 'EXPIRE_AT_PERIOD_END';
      case CarryoverPolicy.rollover: return 'ROLLOVER';
      case CarryoverPolicy.rolloverCapped: return 'ROLLOVER_CAPPED';
    }
  }
}
