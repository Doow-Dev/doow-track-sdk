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
}
