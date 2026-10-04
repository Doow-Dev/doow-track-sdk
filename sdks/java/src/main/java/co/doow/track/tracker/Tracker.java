package co.doow.track.tracker;

import co.doow.track.DoowError;
import co.doow.track.PartialAcceptError;
import co.doow.track.types.TrackEvent;
import com.fasterxml.jackson.databind.JsonNode;
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
    private static final String SDK_VERSION = "0.1.0";

    private final List<Pending> buffer = new ArrayList<>();
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

        Pending pending = new Pending(UUID.randomUUID().toString(), finalEvent);

        synchronized (lock) {
            if (buffer.size() >= options.getMaxQueueSize()) {
                if (options.isDebug()) {
                    System.err.println("[doow-track] Queue full, dropping event");
                }
                return;
            }
            buffer.add(pending);

            if (buffer.size() >= options.getFlushAt()) {
                scheduler.execute(this::flush);
            }
        }
    }

    public void flush() {
        List<Pending> batch;
        synchronized (lock) {
            if (buffer.isEmpty()) return;
            batch = new ArrayList<>(buffer);
            buffer.clear();
        }

        sendBatch(batch);
    }

    static final class Pending {
        final String eventId;
        final TrackEvent event;

        Pending(String eventId, TrackEvent event) {
            this.eventId = eventId;
            this.event = event;
        }
    }

    static Map<String, Object> buildPayload(String batchId, List<Pending> batch) {
        List<Map<String, Object>> events = new ArrayList<>();
        for (Pending pending : batch) {
            TrackEvent e = pending.event;
            Map<String, Object> measurement = new LinkedHashMap<>();
            measurement.put("metric_name", e.getMetric());
            measurement.put("quantity", e.getQuantity());
            if (e.getMetricTupleHint() != null) measurement.put("metric_tuple_hint", e.getMetricTupleHint());

            Map<String, Object> wire = new LinkedHashMap<>();
            wire.put("event_id", pending.eventId);
            wire.put("license_id", e.getLicenseId());
            wire.put("occurred_at", e.getTimestamp().toString());
            String source = e.getSourceSystem();
            wire.put("source_system", source == null || source.trim().isEmpty() ? "sdk" : source);
            wire.put("kind", e.getKind());
            if (e.getUnit() != null) wire.put("unit", e.getUnit());
            if (e.getAttribution() != null) wire.put("attribution", e.getAttribution());
            if (e.getMetadata() != null) wire.put("metadata", e.getMetadata());
            wire.put("measurements", List.of(measurement));
            events.add(wire);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("batch_id", batchId);
        payload.put("sdk_version", SDK_VERSION);
        payload.put("events", events);
        return payload;
    }

    private void sendBatch(List<Pending> batch) {
        String url = options.getEndpoint().replaceAll("/$", "") + "/telemetry/events";
        String batchId = UUID.randomUUID().toString();

        byte[] jsonBytes;
        try {
            jsonBytes = mapper.writeValueAsBytes(buildPayload(batchId, batch));
        } catch (IOException e) {
            report(e);
            return;
        }

        byte[] body = jsonBytes;
        boolean gzipped = false;
        if (!options.isDisableCompression() && jsonBytes.length > 1024) {
            try {
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                try (GZIPOutputStream gzip = new GZIPOutputStream(baos)) {
                    gzip.write(jsonBytes);
                }
                body = baos.toByteArray();
                gzipped = true;
            } catch (IOException e) {
                body = jsonBytes;
            }
        }

        for (int attempt = 0; attempt <= options.getRetryCount(); attempt++) {
            boolean lastAttempt = attempt >= options.getRetryCount();
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                conn.setConnectTimeout(options.getTimeoutMs());
                conn.setReadTimeout(options.getTimeoutMs());
                conn.setRequestProperty("Authorization", "Bearer " + apiKey);
                conn.setRequestProperty("Content-Type", "application/json");
                if (gzipped) conn.setRequestProperty("Content-Encoding", "gzip");
                conn.getOutputStream().write(body);

                int status = conn.getResponseCode();

                if (status == 207) {
                    report(parsePartialAccept(readStream(conn.getInputStream()), batchId));
                    return;
                }

                if (status >= 200 && status < 300) {
                    if (options.isDebug()) {
                        System.err.println("[doow-track] Flushed " + batch.size() + " events");
                    }
                    return;
                }

                if ((status == 429 || status >= 500) && !lastAttempt) {
                    Thread.sleep((long) Math.pow(2, attempt) * 1000);
                    continue;
                }

                report(new DoowError("API error: " + readStream(conn.getErrorStream()), status));
                return;
            } catch (IOException e) {
                if (lastAttempt) {
                    report(e);
                    return;
                }
                try {
                    Thread.sleep((long) Math.pow(2, attempt) * 1000);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    return;
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    private PartialAcceptError parsePartialAccept(String body, String fallbackBatchId) {
        int accepted = 0;
        int rejected = 0;
        String batchId = fallbackBatchId;
        List<PartialAcceptError.Rejection> rejections = new ArrayList<>();
        try {
            JsonNode root = mapper.readTree(body);
            accepted = root.path("accepted").asInt(0);
            rejected = root.path("rejected").asInt(0);
            batchId = root.path("batch_id").asText(fallbackBatchId);
            for (JsonNode r : root.path("rejections")) {
                rejections.add(new PartialAcceptError.Rejection(
                    r.path("event_id").asText("unknown"),
                    r.path("reason").asText("")));
            }
        } catch (IOException ignored) {
        }
        return new PartialAcceptError(accepted, rejected, batchId, rejections);
    }

    private void report(Exception error) {
        if (options.getOnError() != null) {
            options.getOnError().accept(error);
        }
        if (options.isDebug()) {
            System.err.println("[doow-track] Error: " + error.getMessage());
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
