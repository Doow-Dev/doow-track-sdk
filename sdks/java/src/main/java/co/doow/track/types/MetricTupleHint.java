package co.doow.track.types;

import com.fasterxml.jackson.annotation.JsonProperty;

public class MetricTupleHint {
    @JsonProperty("app_name")
    private final String appName;

    @JsonProperty("license_name")
    private final String licenseName;

    @JsonProperty("metric_name")
    private final String metricName;

    public MetricTupleHint(String appName, String licenseName, String metricName) {
        this.appName = appName;
        this.licenseName = licenseName;
        this.metricName = metricName;
    }

    public String getAppName() { return appName; }
    public String getLicenseName() { return licenseName; }
    public String getMetricName() { return metricName; }
}
