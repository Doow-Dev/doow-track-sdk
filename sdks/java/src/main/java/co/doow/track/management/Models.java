package co.doow.track.management;

import co.doow.track.types.*;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.Instant;
import java.util.List;

public class Models {

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class App {
        @JsonProperty("id") public String id;
        @JsonProperty("name") public String name;
        @JsonProperty("description") public String description;
        @JsonProperty("logo_url") public String logoUrl;
        @JsonProperty("website_url") public String websiteUrl;
        @JsonProperty("vendor_app_id") public String vendorAppId;
        @JsonProperty("created_at") public Instant createdAt;
        @JsonProperty("updated_at") public Instant updatedAt;
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class CreateAppInput {
        @JsonProperty("name") public String name;
        @JsonProperty("description") public String description;
        @JsonProperty("logo_url") public String logoUrl;
        @JsonProperty("website_url") public String websiteUrl;
        @JsonProperty("vendor_app_id") public String vendorAppId;

        public CreateAppInput() {}
        public CreateAppInput(String name) { this.name = name; }
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class UpdateAppInput {
        @JsonProperty("name") public String name;
        @JsonProperty("description") public String description;
        @JsonProperty("logo_url") public String logoUrl;
        @JsonProperty("website_url") public String websiteUrl;
        @JsonProperty("vendor_app_id") public String vendorAppId;
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class License {
        @JsonProperty("id") public String id;
        @JsonProperty("name") public String name;
        @JsonProperty("license_type") public LicenseType licenseType;
        @JsonProperty("contract_id") public String contractId;
        @JsonProperty("created_at") public Instant createdAt;
        @JsonProperty("updated_at") public Instant updatedAt;
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class LicenseInput {
        @JsonProperty("name") public String name;
        @JsonProperty("license_type") public LicenseType licenseType = LicenseType.USAGE_BASED;

        public LicenseInput() {}
        public LicenseInput(String name) { this.name = name; }
        public LicenseInput(String name, LicenseType type) { this.name = name; this.licenseType = type; }
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class Contract {
        @JsonProperty("id") public String id;
        @JsonProperty("title") public String title;
        @JsonProperty("contract_type") public ContractType contractType;
        @JsonProperty("app_id") public String appId;
        @JsonProperty("licenses") public List<License> licenses;
        @JsonProperty("created_at") public Instant createdAt;
        @JsonProperty("updated_at") public Instant updatedAt;
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class CreateContractInput {
        @JsonProperty("title") public String title;
        @JsonProperty("contract_type") public ContractType contractType = ContractType.PAY_AS_YOU_GO;
        @JsonProperty("licenses") public List<LicenseInput> licenses;

        public CreateContractInput() {}
        public CreateContractInput(String title) { this.title = title; }
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class Metric {
        @JsonProperty("id") public String id;
        @JsonProperty("metric_type") public String metricType;
        @JsonProperty("usage_aggregation_type") public String usageAggregationType;
        @JsonProperty("rate_kind") public String rateKind;
        @JsonProperty("license_id") public String licenseId;
        @JsonProperty("usage_rate") public Double usageRate;
        @JsonProperty("created_at") public Instant createdAt;
        @JsonProperty("updated_at") public Instant updatedAt;
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class CreateMetricInput {
        @JsonProperty("metric_type") public String metricType;
        @JsonProperty("usage_aggregation_type") public String usageAggregationType;
        @JsonProperty("rate_kind") public String rateKind;
        @JsonProperty("usage_rate") public Double usageRate;

        public CreateMetricInput() {}
        public CreateMetricInput(String metricType) { this.metricType = metricType; }
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class Expense {
        @JsonProperty("id") public String id;
        @JsonProperty("app_id") public String appId;
        @JsonProperty("month") public int month;
        @JsonProperty("year") public int year;
        @JsonProperty("total") public double total;
        @JsonProperty("currency") public String currency;
        @JsonProperty("created_at") public Instant createdAt;
        @JsonProperty("updated_at") public Instant updatedAt;
    }

    public static class PaginatedResponse<T> {
        @JsonProperty("data") public List<T> data;
        @JsonProperty("next_cursor") public String nextCursor;
        @JsonProperty("has_more") public boolean hasMore;
    }
}
