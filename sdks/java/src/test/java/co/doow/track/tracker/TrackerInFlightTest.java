package co.doow.track.tracker;

import co.doow.track.types.TrackEvent;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

class TrackerInFlightTest {
    private HttpServer server;
    private final CountDownLatch requestStarted = new CountDownLatch(1);
    private final AtomicInteger completed = new AtomicInteger();

    @BeforeEach
    void startServer() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/telemetry/events", exchange -> {
            exchange.getRequestBody().readAllBytes();
            requestStarted.countDown();
            try {
                Thread.sleep(400);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            completed.incrementAndGet();
            byte[] out = "{}".getBytes();
            exchange.sendResponseHeaders(202, out.length);
            exchange.getResponseBody().write(out);
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private Tracker eagerTracker() {
        return new Tracker("dk_test", new TrackerOptions()
            .setEndpoint("http://127.0.0.1:" + server.getAddress().getPort())
            .setFlushIntervalMs(0)
            .setFlushAt(1)
            .setRetryCount(0));
    }

    private TrackEvent event() {
        return TrackEvent.builder().metric("api_calls").quantity(1).licenseId("lic_1").build();
    }

    @Test
    void flushWaitsForACountTriggeredSendAlreadyInFlight() throws Exception {
        Tracker tracker = eagerTracker();
        tracker.track(event());
        assertTrue(requestStarted.await(2, TimeUnit.SECONDS));

        tracker.flush();

        assertEquals(1, completed.get());
        tracker.shutdown();
    }

    @Test
    void aFlushCalledFromTheErrorHandlerDoesNotWaitForItsOwnSend() throws Exception {
        server.removeContext("/telemetry/events");
        server.createContext("/telemetry/events", exchange -> {
            exchange.getRequestBody().readAllBytes();
            byte[] out = "{\"message\":\"bad\"}".getBytes();
            exchange.sendResponseHeaders(400, out.length);
            exchange.getResponseBody().write(out);
            exchange.close();
        });
        java.util.concurrent.atomic.AtomicReference<Tracker> holder = new java.util.concurrent.atomic.AtomicReference<>();
        CountDownLatch handlerReturned = new CountDownLatch(1);
        Tracker tracker = new Tracker("dk_test", new TrackerOptions()
            .setEndpoint("http://127.0.0.1:" + server.getAddress().getPort())
            .setFlushIntervalMs(0)
            .setFlushAt(1000)
            .setRetryCount(0)
            .setOnError(error -> {
                holder.get().flush();
                handlerReturned.countDown();
            }));
        holder.set(tracker);
        tracker.track(event());

        long started = System.nanoTime();
        tracker.flush();

        assertTrue(handlerReturned.await(2, TimeUnit.SECONDS));
        assertTrue(TimeUnit.NANOSECONDS.toSeconds(System.nanoTime() - started) < 5);
        tracker.shutdown();
    }

    @Test
    void shutdownWaitsForACountTriggeredSendAlreadyInFlight() throws Exception {
        Tracker tracker = eagerTracker();
        tracker.track(event());
        assertTrue(requestStarted.await(2, TimeUnit.SECONDS));

        tracker.shutdown();

        assertEquals(1, completed.get());
    }
}
