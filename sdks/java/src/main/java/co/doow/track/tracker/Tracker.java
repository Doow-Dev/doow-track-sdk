package co.doow.track.tracker;

import co.doow.track.DoowError;
import co.doow.track.types.TrackEvent;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;
import java.util.zip.GZIPOutputStream;

public class Tracker implements AutoCloseable {
    private final String apiKey;
    private final TrackerOptions options;
    private final ObjectMapper mapper;
    private final List<TrackEvent> buffer = new ArrayList<>();
    private final Object lock = new Object();
    private final ScheduledExecutorService scheduler;
    private volatile boolean closed = false;

    public Tracker(String apiKey) {
        this(apiKey, new TrackerOptions());
    }

    public Tracker(String apiKey, TrackerOptions options) {
        String envKey = System.getenv("DOOW_TRACK_API_KEY");
        this.apiKey = envKey != null ? envKey : apiKey;
        this.options = options;

        if (this.apiKey == null || !this.apiKey.startsWith("dk_")) {
            throw new DoowError("Invalid API key format. Must start with 'dk_'.");
        }

        this.mapper = new ObjectMapper();
        this.mapper.registerModule(new JavaTimeModule());
        this.mapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);

        this.scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "doow-tracker-flush");
            t.setDaemon(true);
            return t;
        });

        if (options.getFlushIntervalMs() > 0) {
            scheduler.scheduleAtFixedRate(
                this::flush,
                options.getFlushIntervalMs(),
                options.getFlushIntervalMs(),
                TimeUnit.MILLISECONDS
            );
        }
    }

    public void track(TrackEvent event) {
        if (!options.isEnabled() || closed) return;

        TrackEvent finalEvent = TrackEvent.builder()
            .metric(event.getMetric())
            .quantity(event.getQuantity())
            .licenseId(event.getLicenseId())
            .unit(event.getUnit())
            .kind(event.getKind())
            .timestamp(event.getTimestamp() != null ? event.getTimestamp() : Instant.now())
            .sourceSystem(event.getSourceSystem())
            .metricTupleHint(event.getMetricTupleHint())
            .attribution(mergeAttribution(event.getAttribution()))
            .metadata(event.getMetadata())
            .build();

        synchronized (lock) {
            if (buffer.size() >= options.getMaxQueueSize()) {
                if (options.isDebug()) {
                    System.err.println("[doow-track] Queue full, dropping event");
                }
                return;
            }
            buffer.add(finalEvent);

            if (buffer.size() >= options.getFlushAt()) {
                scheduler.execute(this::flush);
            }
        }
    }

    public void flush() {
        List<TrackEvent> batch;
        synchronized (lock) {
            if (buffer.isEmpty()) return;
            batch = new ArrayList<>(buffer);
            buffer.clear();
        }

        sendBatch(batch);
    }

    private void sendBatch(List<TrackEvent> batch) {
        String url = options.getEndpoint().replaceAll("/$", "") + "/telemetry/events";

        for (int attempt = 0; attempt <= options.getRetryCount(); attempt++) {
            try {
                Map<String, Object> payload = Map.of("events", batch);
                String json = mapper.writeValueAsString(payload);
                byte[] jsonBytes = json.getBytes("UTF-8");

                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                conn.setConnectTimeout(options.getTimeoutMs());
                conn.setReadTimeout(options.getTimeoutMs());
                conn.setRequestProperty("Authorization", "Bearer " + apiKey);
                conn.setRequestProperty("Content-Type", "application/json");

                byte[] body;
                if (!options.isDisableCompression() && jsonBytes.length > 1024) {
                    ByteArrayOutputStream baos = new ByteArrayOutputStream();
                    try (GZIPOutputStream gzip = new GZIPOutputStream(baos)) {
                        gzip.write(jsonBytes);
                    }
                    body = baos.toByteArray();
                    conn.setRequestProperty("Content-Encoding", "gzip");
                } else {
                    body = jsonBytes;
                }

                conn.getOutputStream().write(body);

                int status = conn.getResponseCode();
                if (status >= 200 && status < 300) {
                    if (options.isDebug()) {
                        System.err.println("[doow-track] Flushed " + batch.size() + " events");
                    }
                    return;
                }

                if (status >= 500 && attempt < options.getRetryCount()) {
                    Thread.sleep((long) Math.pow(2, attempt) * 1000);
                    continue;
                }

                String errorBody = readStream(conn.getErrorStream());
                throw new DoowError("API error: " + errorBody, status);

            } catch (IOException e) {
                if (attempt < options.getRetryCount()) {
                    try {
                        Thread.sleep((long) Math.pow(2, attempt) * 1000);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        break;
                    }
                    continue;
                }
                if (options.getOnError() != null) {
                    options.getOnError().accept(e);
                }
                if (options.isDebug()) {
                    System.err.println("[doow-track] Error: " + e.getMessage());
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
    }

    private String readStream(InputStream is) throws IOException {
        if (is == null) return "";
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(is))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line);
            }
            return sb.toString();
        }
    }

    private Map<String, Object> mergeAttribution(Map<String, Object> eventAttribution) {
        if (options.getAttribution() == null && eventAttribution == null) return null;
        if (options.getAttribution() == null) return eventAttribution;
        if (eventAttribution == null) return options.getAttribution();

        Map<String, Object> merged = new HashMap<>(options.getAttribution());
        merged.putAll(eventAttribution);
        return merged;
    }

    public void shutdown() {
        closed = true;
        flush();
        scheduler.shutdown();
        try {
            scheduler.awaitTermination(5, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    @Override
    public void close() {
        shutdown();
    }
}
