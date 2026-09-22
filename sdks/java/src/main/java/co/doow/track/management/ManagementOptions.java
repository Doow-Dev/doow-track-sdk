package co.doow.track.management;

public class ManagementOptions {
    private String endpoint = "https://api.doow.co";
    private int timeoutMs = 30000;
    private int retryCount = 3;
    private boolean debug = false;

    public ManagementOptions() {
        String envEndpoint = System.getenv("DOOW_TRACK_ENDPOINT");
        if (envEndpoint != null) this.endpoint = envEndpoint;

        String envDebug = System.getenv("DOOW_TRACK_DEBUG");
        if ("true".equalsIgnoreCase(envDebug)) this.debug = true;
    }

    public String getEndpoint() { return endpoint; }
    public ManagementOptions setEndpoint(String endpoint) { this.endpoint = endpoint; return this; }

    public int getTimeoutMs() { return timeoutMs; }
    public ManagementOptions setTimeoutMs(int timeoutMs) { this.timeoutMs = timeoutMs; return this; }

    public int getRetryCount() { return retryCount; }
    public ManagementOptions setRetryCount(int retryCount) { this.retryCount = retryCount; return this; }

    public boolean isDebug() { return debug; }
    public ManagementOptions setDebug(boolean debug) { this.debug = debug; return this; }
}
