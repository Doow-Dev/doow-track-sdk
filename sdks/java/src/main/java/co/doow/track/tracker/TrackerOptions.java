package co.doow.track.tracker;

import java.util.Map;
import java.util.function.Consumer;

public class TrackerOptions {
    private String endpoint = "https://api.doow.co";
    private boolean enabled = true;
    private boolean debug = false;
    private int flushAt = 20;
    private int flushIntervalMs = 10000;
    private int maxQueueSize = 10000;
    private int timeoutMs = 10000;
    private int retryCount = 3;
    private boolean disableCompression = false;
    private Map<String, Object> attribution;
    private Consumer<Exception> onError;

    public TrackerOptions() {
        String envEndpoint = System.getenv("DOOW_TRACK_ENDPOINT");
        if (envEndpoint != null) this.endpoint = envEndpoint;

        String envDisabled = System.getenv("DOOW_TRACK_DISABLED");
        if ("true".equalsIgnoreCase(envDisabled)) this.enabled = false;

        String envDebug = System.getenv("DOOW_TRACK_DEBUG");
        if ("true".equalsIgnoreCase(envDebug)) this.debug = true;
    }

    public String getEndpoint() { return endpoint; }
    public TrackerOptions setEndpoint(String endpoint) { this.endpoint = endpoint; return this; }

    public boolean isEnabled() { return enabled; }
    public TrackerOptions setEnabled(boolean enabled) { this.enabled = enabled; return this; }

    public boolean isDebug() { return debug; }
    public TrackerOptions setDebug(boolean debug) { this.debug = debug; return this; }

    public int getFlushAt() { return flushAt; }
    public TrackerOptions setFlushAt(int flushAt) { this.flushAt = flushAt; return this; }

    public int getFlushIntervalMs() { return flushIntervalMs; }
    public TrackerOptions setFlushIntervalMs(int flushIntervalMs) { this.flushIntervalMs = flushIntervalMs; return this; }

    public int getMaxQueueSize() { return maxQueueSize; }
    public TrackerOptions setMaxQueueSize(int maxQueueSize) { this.maxQueueSize = maxQueueSize; return this; }

    public int getTimeoutMs() { return timeoutMs; }
    public TrackerOptions setTimeoutMs(int timeoutMs) { this.timeoutMs = timeoutMs; return this; }

    public int getRetryCount() { return retryCount; }
    public TrackerOptions setRetryCount(int retryCount) { this.retryCount = retryCount; return this; }

    public boolean isDisableCompression() { return disableCompression; }
    public TrackerOptions setDisableCompression(boolean disableCompression) { this.disableCompression = disableCompression; return this; }

    public Map<String, Object> getAttribution() { return attribution; }
    public TrackerOptions setAttribution(Map<String, Object> attribution) { this.attribution = attribution; return this; }

    public Consumer<Exception> getOnError() { return onError; }
    public TrackerOptions setOnError(Consumer<Exception> onError) { this.onError = onError; return this; }
}
