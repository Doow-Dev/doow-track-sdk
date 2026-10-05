package co.doow.track.tracker;

import co.doow.track.PartialAcceptError;
import co.doow.track.types.MetricTupleHint;
import co.doow.track.types.TrackEvent;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.zip.GZIPInputStream;

import static org.junit.jupiter.api.Assertions.*;

class TrackerProtocolTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    private HttpServer server;
    private final List<JsonNode> bodies = new CopyOnWriteArrayList<>();
    private final List<String> encodings = new CopyOnWriteArrayList<>();
    private final List<Exception> errors = new CopyOnWriteArrayList<>();
    private volatile int[] statuses = {202};
    private volatile String responseBody = "{}";
    private volatile String retryAfter = null;

    @BeforeEach
    void startServer() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/telemetry/events", exchange -> {
            byte[] raw = exchange.getRequestBody().readAllBytes();
            String encoding = exchange.getRequestHeaders().getFirst("Content-Encoding");
            encodings.add(String.valueOf(encoding));
            if ("gzip".equals(encoding)) {
                raw = new GZIPInputStream(new ByteArrayInputStream(raw)).readAllBytes();
            }
            bodies.add(JSON.readTree(raw));
            int status = statuses[Math.min(bodies.size() - 1, statuses.length - 1)];
            byte[] out = responseBody.getBytes(StandardCharsets.UTF_8);
            if ((status == 429 || status == 503) && retryAfter != null) {
                exchange.getResponseHeaders().add("Retry-After", retryAfter);
            }
            exchange.sendResponseHeaders(status, out.length);
            exchange.getResponseBody().write(out);
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private Tracker tracker() {
        TrackerOptions options = new TrackerOptions()
            .setEndpoint("http://127.0.0.1:" + server.getAddress().getPort())
            .setFlushIntervalMs(0)
            .setFlushAt(1000)
            .setRetryCount(1)
            .setOnError(errors::add);
        return new Tracker("dk_test", options);
    }

    private TrackEvent event() {
        return TrackEvent.builder()
            .metric("api_calls")
            .quantity(1)
            .licenseId("lic_1")
            .metricTupleHint(new MetricTupleHint("app", "lic", "calls"))
            .build();
    }

    @Test
    void sendsBatchEnvelopeWithObjectTupleHint() {
        Tracker tracker = tracker();
        tracker.track(event());
        tracker.flush();
        tracker.shutdown();

        assertEquals(1, bodies.size());
        JsonNode body = bodies.get(0);
        assertFalse(body.path("batch_id").asText().isEmpty());
        assertFalse(body.path("sdk_version").asText().isEmpty());
        JsonNode e = body.path("events").get(0);
        assertFalse(e.path("event_id").asText().isEmpty());
        assertFalse(e.path("occurred_at").asText().isEmpty());
        assertEquals("lic_1", e.path("license_id").asText());
        assertEquals("sdk", e.path("source_system").asText());
        JsonNode hint = e.path("measurements").get(0).path("metric_tuple_hint");
        assertTrue(hint.isObject());
        assertEquals("app", hint.path("app_name").asText());
        assertEquals("lic", hint.path("license_name").asText());
        assertEquals("calls", hint.path("metric_name").asText());
        assertTrue(errors.isEmpty());
    }

    @Test
    void partialAcceptReportsEachRejectionWithoutRetry() {
        statuses = new int[] {207};
        responseBody = "{\"accepted\":1,\"rejected\":1,\"batch_id\":\"b\","
            + "\"rejections\":[{\"event_id\":\"evt-x\",\"reason\":\"license_id is required\"}]}";
        Tracker tracker = tracker();
        tracker.track(event());
        tracker.flush();
        tracker.shutdown();

        assertEquals(1, bodies.size());
        assertEquals(1, errors.size());
        PartialAcceptError error = assertInstanceOf(PartialAcceptError.class, errors.get(0));
        assertEquals("evt-x", error.getRejections().get(0).getEventId());
        assertEquals("license_id is required", error.getRejections().get(0).getReason());
    }

    private Tracker backlogTracker() {
        TrackerOptions options = new TrackerOptions()
            .setEndpoint("http://127.0.0.1:" + server.getAddress().getPort())
            .setFlushIntervalMs(0)
            .setFlushAt(5000)
            .setMaxQueueSize(5000)
            .setRetryCount(0)
            .setOnError(errors::add);
        return new Tracker("dk_test", options);
    }

    @Test
    void flushOfMoreThan500EventsSendsChunksOfAtMost500WithDistinctBatchIds() {
        Tracker tracker = backlogTracker();
        for (int i = 0; i < 1200; i++) tracker.track(event());
        tracker.flush();
        tracker.shutdown();

        assertEquals(3, bodies.size());
        assertEquals(List.of(500, 500, 200), bodies.stream().map(b -> b.path("events").size()).toList());
        assertEquals(3, bodies.stream().map(b -> b.path("batch_id").asText()).distinct().count());
        long distinctEvents = bodies.stream()
            .flatMap(b -> {
                List<String> ids = new ArrayList<>();
                b.path("events").forEach(e -> ids.add(e.path("event_id").asText()));
                return ids.stream();
            })
            .distinct()
            .count();
        assertEquals(1200, distinctEvents);
        assertTrue(errors.isEmpty());
    }

    private List<String> eventIds(JsonNode body) {
        List<String> ids = new ArrayList<>();
        body.path("events").forEach(e -> ids.add(e.path("event_id").asText()));
        return ids;
    }

    @Test
    void aTransientFailureRequeuesThatChunkAndEveryLaterChunkAndSendsNothingMore() {
        statuses = new int[] {202, 503};
        Tracker tracker = backlogTracker();
        for (int i = 0; i < 1200; i++) tracker.track(event());
        tracker.flush();

        assertEquals(2, bodies.size());
        assertEquals(1, errors.size());
        List<String> failedChunk = eventIds(bodies.get(1));

        statuses = new int[] {202};
        bodies.clear();
        tracker.flush();
        tracker.shutdown();

        List<String> resent = new ArrayList<>();
        bodies.forEach(b -> resent.addAll(eventIds(b)));
        assertEquals(700, resent.size());
        assertEquals(failedChunk, resent.subList(0, 500));
    }

    @Test
    void aShutdownDuringAnOutageReportsHowManyEventsItDropped() {
        statuses = new int[] {503};
        Tracker tracker = backlogTracker();
        for (int i = 0; i < 700; i++) tracker.track(event());
        tracker.shutdown();

        assertTrue(errors.stream().anyMatch(e -> e.getMessage().startsWith("Dropped 700 events at shutdown")));
    }

    @Test
    void anInterruptDuringTheBackoffRequeuesTheInFlightChunkToo() throws Exception {
        statuses = new int[] {503};
        TrackerOptions options = new TrackerOptions()
            .setEndpoint("http://127.0.0.1:" + server.getAddress().getPort())
            .setFlushIntervalMs(0)
            .setFlushAt(5000)
            .setRetryCount(2)
            .setOnError(errors::add);
        Tracker tracker = new Tracker("dk_test", options);
        for (int i = 0; i < 700; i++) tracker.track(event());

        Thread flusher = new Thread(tracker::flush);
        flusher.start();
        Thread.sleep(400);
        flusher.interrupt();
        flusher.join(5000);

        statuses = new int[] {202};
        bodies.clear();
        tracker.flush();
        tracker.shutdown();

        List<String> resent = new ArrayList<>();
        bodies.forEach(b -> resent.addAll(eventIds(b)));
        assertEquals(700, resent.size());
    }

    @Test
    void aRequestTimeoutIsRetriedWithTheSameBatchId() {
        statuses = new int[] {408, 202};
        Tracker tracker = tracker();
        tracker.track(event());
        tracker.flush();
        tracker.shutdown();

        assertEquals(2, bodies.size());
        assertEquals(bodies.get(0).path("batch_id").asText(), bodies.get(1).path("batch_id").asText());
        assertTrue(errors.isEmpty());
    }

    @Test
    void aTransientFailureHoldsCountTriggeredFlushes() throws Exception {
        statuses = new int[] {503};
        TrackerOptions options = new TrackerOptions()
            .setEndpoint("http://127.0.0.1:" + server.getAddress().getPort())
            .setFlushIntervalMs(60_000)
            .setFlushAt(2)
            .setRetryCount(0)
            .setOnError(errors::add);
        Tracker tracker = new Tracker("dk_test", options);
        tracker.track(event());
        tracker.track(event());
        Thread.sleep(300);
        assertEquals(1, bodies.size());

        tracker.track(event());
        tracker.track(event());
        Thread.sleep(300);
        assertEquals(1, bodies.size());
        tracker.shutdown();
    }

    @Test
    void anInterruptedFlushStopsAfterTheChunkInProgress() {
        Tracker tracker = backlogTracker();
        for (int i = 0; i < 1200; i++) tracker.track(event());
        Thread.currentThread().interrupt();
        try {
            tracker.flush();
            assertTrue(Thread.currentThread().isInterrupted());
        } finally {
            Thread.interrupted();
        }
        assertEquals(1, bodies.size());

        bodies.clear();
        tracker.flush();
        tracker.shutdown();

        List<String> resent = new ArrayList<>();
        bodies.forEach(b -> resent.addAll(eventIds(b)));
        assertEquals(700, resent.size());
    }

    @Test
    void laterChunksAreStillSentAfterAChunkFailsPermanently() {
        statuses = new int[] {400, 202};
        Tracker tracker = backlogTracker();
        for (int i = 0; i < 700; i++) tracker.track(event());
        tracker.flush();
        tracker.shutdown();

        assertEquals(2, bodies.size());
        assertEquals(1, errors.size());
    }

    @Test
    void clientErrorIsReportedAndDoesNotStopLaterFlushes() {
        statuses = new int[] {400, 202};
        Tracker tracker = tracker();
        tracker.track(event());
        tracker.flush();
        tracker.track(event());
        tracker.flush();
        tracker.shutdown();

        assertEquals(2, bodies.size());
        assertEquals(1, errors.size());
    }

    @Test
    void retryReusesTheBatchId() {
        statuses = new int[] {503, 202};
        Tracker tracker = tracker();
        tracker.track(event());
        tracker.flush();
        tracker.shutdown();

        assertEquals(2, bodies.size());
        assertEquals(bodies.get(0).path("batch_id").asText(), bodies.get(1).path("batch_id").asText());
        assertEquals(
            bodies.get(0).path("events").get(0).path("event_id").asText(),
            bodies.get(1).path("events").get(0).path("event_id").asText());
        assertTrue(errors.isEmpty());
    }

    @Test
    void largeBodiesAreRealGzip() {
        Tracker tracker = tracker();
        for (int i = 0; i < 300; i++) tracker.track(event());
        tracker.flush();
        tracker.shutdown();

        assertEquals(List.of("gzip"), new ArrayList<>(encodings));
        assertEquals(300, bodies.get(0).path("events").size());
    }

    @Test
    void throwingOnErrorHandlerDoesNotKillThePeriodicFlush() throws Exception {
        statuses = new int[] {400, 202};
        TrackerOptions options = new TrackerOptions()
            .setEndpoint("http://127.0.0.1:" + server.getAddress().getPort())
            .setFlushIntervalMs(50)
            .setFlushAt(1000)
            .setRetryCount(0)
            .setOnError(e -> { throw new IllegalStateException("handler failure"); });
        Tracker tracker = new Tracker("dk_test", options);

        tracker.track(event());
        awaitBodies(1);
        tracker.track(event());
        awaitBodies(2);
        boolean secondFlushArrived = bodies.size() >= 2;
        tracker.shutdown();

        assertTrue(secondFlushArrived, "periodic flush stopped after onError threw");
    }

    @Test
    void malformedPartialAcceptBodyIsReportedWithoutResend() {
        statuses = new int[] {207};
        responseBody = "{\"accepted\":\"abc\",\"rejected\":null,\"rejections\":[1,\"x\",{\"event_id\":5},null]}";
        Tracker tracker = tracker();
        tracker.track(event());
        tracker.flush();
        tracker.shutdown();

        assertEquals(1, bodies.size());
        assertEquals(1, errors.size());
        assertInstanceOf(PartialAcceptError.class, errors.get(0));
    }

    @Test
    void rateLimitedBatchWaitsForRetryAfterAndRetriesTheSameBatch() {
        statuses = new int[] {429, 202};
        retryAfter = "2";
        Tracker tracker = tracker();
        tracker.track(event());
        long started = System.nanoTime();
        tracker.flush();
        long elapsedMs = (System.nanoTime() - started) / 1_000_000;
        tracker.shutdown();

        assertEquals(2, bodies.size());
        assertTrue(elapsedMs >= 1900, "retried after " + elapsedMs + "ms, before the 2s Retry-After");
        assertEquals(bodies.get(0).path("batch_id").asText(), bodies.get(1).path("batch_id").asText());
        assertTrue(errors.isEmpty());
    }

    @Test
    void inFlightUnavailableBatchWaitsForRetryAfterAndRetriesTheSameBatch() {
        statuses = new int[] {503, 202};
        retryAfter = "2";
        Tracker tracker = tracker();
        tracker.track(event());
        long started = System.nanoTime();
        tracker.flush();
        long elapsedMs = (System.nanoTime() - started) / 1_000_000;
        tracker.shutdown();

        assertEquals(2, bodies.size());
        assertTrue(elapsedMs >= 1900, "retried after " + elapsedMs + "ms, before the 2s Retry-After");
        assertEquals(bodies.get(0).path("batch_id").asText(), bodies.get(1).path("batch_id").asText());
        assertTrue(errors.isEmpty());
    }

    @Test
    void retryAfterIsClampedAndGarbageIsIgnored() {
        assertEquals(2000, Tracker.parseRetryAfterMs("2"));
        assertEquals(30_000, Tracker.parseRetryAfterMs("86400"));
        assertEquals(0, Tracker.parseRetryAfterMs("garbage"));
        assertEquals(0, Tracker.parseRetryAfterMs(null));
    }

    @Test
    void serverTextIsSanitizedAndTruncated() {
        String dirty = "line1\nline2\u001b[31m\u009b31m" + "x".repeat(2000);
        String cleaned = Tracker.sanitize(dirty);
        assertFalse(cleaned.contains("\n"));
        assertFalse(cleaned.contains("\u001b"));
        assertFalse(cleaned.contains("\u009b"));
        assertTrue(cleaned.length() <= 520);
    }

    private void awaitBodies(int count) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 5000;
        while (bodies.size() < count && System.currentTimeMillis() < deadline) Thread.sleep(20);
    }
}
