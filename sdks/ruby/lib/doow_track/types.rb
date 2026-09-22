# frozen_string_literal: true

module DoowTrack
  module EventKind
    USAGE = "USAGE"
    ADJUSTMENT = "ADJUSTMENT"
  end

  module ContractType
    PAY_AS_YOU_GO = "PAY_AS_YOU_GO"
    ENTERPRISE = "ENTERPRISE"
    UNKNOWN = "UNKNOWN"
  end

  # License types for SDK creation. SDK only supports USAGE_BASED.
  module LicenseType
    USAGE_BASED = "USAGE_BASED"
  end

  # All license types (for responses that may include UI-created licenses)
  module AllLicenseType
    USAGE_BASED = "USAGE_BASED"
    SEAT_BASED = "SEAT_BASED"
    PREPAID_CREDITS = "PREPAID_CREDITS"
    FLAT_RATE = "FLAT_RATE"
  end

  module UsageAggregationType
    SUM = "SUM"
    MAX = "MAX"
    CUMULATIVE = "CUMULATIVE"
  end

  module RateKind
    PER_UNIT = "PER_UNIT"
    FLAT_FEE = "FLAT_FEE"
    PER_SEAT = "PER_SEAT"
    TIERED = "TIERED"
    VOLUME = "VOLUME"
  end

  module EntitlementPeriod
    MONTHLY = "MONTHLY"
    YEARLY = "YEARLY"
    QUARTERLY = "QUARTERLY"
    WEEKLY = "WEEKLY"
    DAILY = "DAILY"
    ONE_TIME = "ONE_TIME"
  end

  module CarryoverPolicy
    EXPIRE_AT_PERIOD_END = "EXPIRE_AT_PERIOD_END"
    ROLLOVER = "ROLLOVER"
    ROLLOVER_CAPPED = "ROLLOVER_CAPPED"
  end

  module CostAmortization
    PRORATA = "PRORATA"
    MONTHS = "MONTHS"
    QUARTER = "QUARTER"
    YEARS = "YEARS"
  end

  MetricTupleHint = Struct.new(:app_name, :license_name, :metric_name, keyword_init: true) do
    def to_h
      { app_name: app_name, license_name: license_name, metric_name: metric_name }.compact
    end
  end

  TrackEvent = Struct.new(
    :metric, :quantity, :license_id, :unit, :kind,
    :timestamp, :source_system, :metric_tuple_hint,
    :attribution, :metadata,
    keyword_init: true
  ) do
    def to_h
      {
        metric: metric,
        quantity: quantity,
        license_id: license_id,
        unit: unit,
        kind: kind || EventKind::USAGE,
        timestamp: timestamp&.iso8601 || Time.now.utc.iso8601,
        source_system: source_system,
        metric_tuple_hint: metric_tuple_hint&.to_h,
        attribution: attribution,
        metadata: metadata
      }.compact
    end
  end

  class App
    attr_accessor :id, :name, :description, :logo_url, :website, :categories, :saas_application_id, :created_at, :updated_at

    def initialize(**attrs)
      attrs.each { |k, v| send("#{k}=", v) if respond_to?("#{k}=") }
    end
  end

  class License
    attr_accessor :id, :name, :license_type, :contract_id, :seats, :price_per_seat, :total_cost,
                  :discount, :discount_amount, :discounted_cost, :original_cost, :tenure,
                  :seats_included_in_base_plan, :created_at, :updated_at

    def initialize(**attrs)
      attrs.each { |k, v| send("#{k}=", v) if respond_to?("#{k}=") }
    end
  end

  class Expense
    attr_accessor :id, :app_id, :contract_id, :license_id, :total, :date, :month, :year,
                  :description, :transaction_id, :vendor, :payment_channel, :currency,
                  :created_at, :updated_at

    def initialize(**attrs)
      @currency = "USD"
      attrs.each { |k, v| send("#{k}=", v) if respond_to?("#{k}=") }
    end
  end

  class Contract
    attr_accessor :id, :app_id, :title, :contract_type, :start_date, :end_date, :currency,
                  :cost, :cost_break_down, :cost_amortization, :add_ons, :add_ons_total_cost,
                  :total_contract_cost, :total_discount_amount, :total_original_cost,
                  :licenses, :expenses, :created_at, :updated_at

    def initialize(**attrs)
      @licenses = []
      @expenses = []
      attrs.each { |k, v| send("#{k}=", v) if respond_to?("#{k}=") }
    end
  end

  class Metric
    attr_accessor :id, :license_id, :metric_type, :usage_aggregation_type, :rate_kind,
                  :entitlement_period, :carryover_policy, :usage_rate, :usage_limit,
                  :usage_included, :per_unit_cap, :usage_rate_is_estimated,
                  :usage_custom_unit_label, :expected_emission_interval_minutes,
                  :created_at, :updated_at

    def initialize(**attrs)
      attrs.each { |k, v| send("#{k}=", v) if respond_to?("#{k}=") }
    end
  end

  class PaginatedResponse
    attr_accessor :data, :cursor, :has_more

    def initialize(**attrs)
      attrs.each { |k, v| send("#{k}=", v) if respond_to?("#{k}=") }
    end
  end
end
