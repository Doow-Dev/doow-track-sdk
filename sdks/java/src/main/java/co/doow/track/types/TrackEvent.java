package co.doow.track.types;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.Instant;
import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class TrackEvent {
    @JsonProperty("metric")
    private String metric;

    @JsonProperty("quantity")
    private double quantity;

    @JsonProperty("license_id")
    private String licenseId;

    @JsonProperty("unit")
    private String unit;

    @JsonProperty("kind")
    private EventKind kind = EventKind.USAGE;

    @JsonProperty("timestamp")
    private Instant timestamp;

    @JsonProperty("source_system")
    private String sourceSystem;

    @JsonProperty("metric_tuple_hint")
    private String metricTupleHint;

    @JsonProperty("attribution")
    private Map<String, Object> attribution;

    @JsonProperty("metadata")
    private Map<String, Object> metadata;

    public TrackEvent() {}

    public TrackEvent(String metric, double quantity, String licenseId) {
        this.metric = metric;
        this.quantity = quantity;
        this.licenseId = licenseId;
    }

    public String getMetric() { return metric; }
    public void setMetric(String metric) { this.metric = metric; }

    public double getQuantity() { return quantity; }
    public void setQuantity(double quantity) { this.quantity = quantity; }

    public String getLicenseId() { return licenseId; }
    public void setLicenseId(String licenseId) { this.licenseId = licenseId; }

    public String getUnit() { return unit; }
    public void setUnit(String unit) { this.unit = unit; }

    public EventKind getKind() { return kind; }
    public void setKind(EventKind kind) { this.kind = kind; }

    public Instant getTimestamp() { return timestamp; }
    public void setTimestamp(Instant timestamp) { this.timestamp = timestamp; }

    public String getSourceSystem() { return sourceSystem; }
    public void setSourceSystem(String sourceSystem) { this.sourceSystem = sourceSystem; }

    public String getMetricTupleHint() { return metricTupleHint; }
    public void setMetricTupleHint(String metricTupleHint) { this.metricTupleHint = metricTupleHint; }

    public Map<String, Object> getAttribution() { return attribution; }
    public void setAttribution(Map<String, Object> attribution) { this.attribution = attribution; }

    public Map<String, Object> getMetadata() { return metadata; }
    public void setMetadata(Map<String, Object> metadata) { this.metadata = metadata; }

    public static Builder builder() { return new Builder(); }

    public static class Builder {
        private final TrackEvent event = new TrackEvent();

        public Builder metric(String metric) { event.metric = metric; return this; }
        public Builder quantity(double quantity) { event.quantity = quantity; return this; }
        public Builder licenseId(String licenseId) { event.licenseId = licenseId; return this; }
        public Builder unit(String unit) { event.unit = unit; return this; }
        public Builder kind(EventKind kind) { event.kind = kind; return this; }
        public Builder timestamp(Instant timestamp) { event.timestamp = timestamp; return this; }
        public Builder sourceSystem(String sourceSystem) { event.sourceSystem = sourceSystem; return this; }
        public Builder metricTupleHint(String hint) { event.metricTupleHint = hint; return this; }
        public Builder attribution(Map<String, Object> attribution) { event.attribution = attribution; return this; }
        public Builder metadata(Map<String, Object> metadata) { event.metadata = metadata; return this; }

        public TrackEvent build() { return event; }
    }
}
