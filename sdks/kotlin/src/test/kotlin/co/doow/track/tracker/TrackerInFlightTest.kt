package co.doow.track.tracker

import co.doow.track.types.TrackEvent
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TrackerInFlightTest {
    private lateinit var server: HttpServer
    private val requestStarted = CountDownLatch(1)
    private val completed = AtomicInteger()

    @BeforeTest
    fun start() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/telemetry/events") { exchange ->
            exchange.requestBody.readBytes()
            requestStarted.countDown()
            Thread.sleep(400)
            completed.incrementAndGet()
            val out = "{}".toByteArray()
            exchange.sendResponseHeaders(202, out.size.toLong())
            exchange.responseBody.write(out)
            exchange.close()
        }
        server.start()
    }

    @AfterTest
    fun stop() = server.stop(0)

    private fun eagerTracker() = Tracker(
        "dk_test",
        TrackerOptions(
            endpoint = "http://127.0.0.1:${server.address.port}",
            flushIntervalMs = 0,
            flushAt = 1,
            retryCount = 0,
        ),
    )

    private fun event() = TrackEvent(metric = "api_calls", quantity = 1.0, licenseId = "lic_1")

    @Test
    fun flushWaitsForACountTriggeredSendAlreadyInFlight() {
        val tracker = eagerTracker()
        tracker.track(event())
        assertTrue(requestStarted.await(2, TimeUnit.SECONDS))

        tracker.flush()

        assertEquals(1, completed.get())
        tracker.shutdown()
    }

    @Test
    fun shutdownWaitsForACountTriggeredSendAlreadyInFlight() {
        val tracker = eagerTracker()
        tracker.track(event())
        assertTrue(requestStarted.await(2, TimeUnit.SECONDS))

        tracker.shutdown()

        assertEquals(1, completed.get())
    }
}
