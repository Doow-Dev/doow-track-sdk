package co.doow.track.tracker

import co.doow.track.PartialAcceptError
import co.doow.track.types.MetricTupleHint
import co.doow.track.types.TrackEvent
import com.sun.net.httpserver.HttpServer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList
import java.util.zip.GZIPInputStream
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class TrackerProtocolTest {
    private lateinit var server: HttpServer
    private val bodies = CopyOnWriteArrayList<JsonObject>()
    private val encodings = CopyOnWriteArrayList<String?>()
    private val errors = CopyOnWriteArrayList<Exception>()
    @Volatile private var statuses = intArrayOf(202)
    @Volatile private var responseBody = "{}"
    @Volatile private var retryAfter: String? = null

    @BeforeTest
    fun start() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/telemetry/events") { exchange ->
            var raw = exchange.requestBody.readBytes()
            val encoding = exchange.requestHeaders.getFirst("Content-Encoding")
            encodings.add(encoding)
            if (encoding == "gzip") raw = GZIPInputStream(raw.inputStream()).readBytes()
            bodies.add(Json.parseToJsonElement(String(raw)).jsonObject)
            val status = statuses[minOf(bodies.size - 1, statuses.size - 1)]
            val out = responseBody.toByteArray()
            if ((status == 429 || status == 503) && retryAfter != null) exchange.responseHeaders.add("Retry-After", retryAfter)
            exchange.sendResponseHeaders(status, out.size.toLong())
            exchange.responseBody.write(out)
            exchange.close()
        }
        server.start()
    }

    @AfterTest
    fun stop() = server.stop(0)

    private fun tracker() = Tracker(
        "dk_test",
        TrackerOptions(
            endpoint = "http://127.0.0.1:${server.address.port}",
            flushIntervalMs = 0,
            flushAt = 1000,
            retryCount = 1,
            onError = { errors.add(it) }
        )
    )

    private fun event() = TrackEvent(
        metric = "api_calls",
        quantity = 1.0,
        licenseId = "lic_1",
        metricTupleHint = MetricTupleHint(appName = "app", licenseName = "lic", metricName = "calls")
    )

    @Test
    fun sendsBatchEnvelopeWithObjectTupleHint() {
        val tracker = tracker()
        tracker.track(event())
        tracker.flush()
        tracker.shutdown()

        assertEquals(1, bodies.size)
        val body = bodies[0]
        assertTrue(body["batch_id"]!!.jsonPrimitive.content.isNotEmpty())
        assertTrue(body["sdk_version"]!!.jsonPrimitive.content.isNotEmpty())
        val e = body["events"]!!.jsonArray[0].jsonObject
        assertTrue(e["event_id"]!!.jsonPrimitive.content.isNotEmpty())
        assertTrue(e["occurred_at"]!!.jsonPrimitive.content.isNotEmpty())
        assertEquals("lic_1", e["license_id"]!!.jsonPrimitive.content)
        assertEquals("sdk", e["source_system"]!!.jsonPrimitive.content)
        val hint = e["measurements"]!!.jsonArray[0].jsonObject["metric_tuple_hint"]!!.jsonObject
        assertEquals("app", hint["app_name"]!!.jsonPrimitive.content)
        assertEquals("lic", hint["license_name"]!!.jsonPrimitive.content)
        assertEquals("calls", hint["metric_name"]!!.jsonPrimitive.content)
        assertTrue(errors.isEmpty())
    }

    @Test
    fun partialAcceptReportsEachRejectionWithoutRetry() {
        statuses = intArrayOf(207)
        responseBody = """{"accepted":1,"rejected":1,"batch_id":"b","rejections":[{"event_id":"evt-x","reason":"license_id is required"}]}"""
        val tracker = tracker()
        tracker.track(event())
        tracker.flush()
        tracker.shutdown()

        assertEquals(1, bodies.size)
        val error = assertIs<PartialAcceptError>(errors.single())
        assertEquals("evt-x", error.rejections.single().eventId)
        assertEquals("license_id is required", error.rejections.single().reason)
    }

    @Test
    fun clientErrorIsReportedAndLaterFlushesStillRun() {
        statuses = intArrayOf(400, 202)
        val tracker = tracker()
        tracker.track(event())
        tracker.flush()
        tracker.track(event())
        tracker.flush()
        tracker.shutdown()

        assertEquals(2, bodies.size)
        assertEquals(1, errors.size)
    }

    @Test
    fun retryReusesTheBatchId() {
        statuses = intArrayOf(503, 202)
        val tracker = tracker()
        tracker.track(event())
        tracker.flush()
        tracker.shutdown()

        assertEquals(2, bodies.size)
        assertEquals(bodies[0]["batch_id"], bodies[1]["batch_id"])
        assertEquals(
            bodies[0]["events"]!!.jsonArray[0].jsonObject["event_id"],
            bodies[1]["events"]!!.jsonArray[0].jsonObject["event_id"]
        )
        assertTrue(errors.isEmpty())
    }

    @Test
    fun largeBodiesAreRealGzip() {
        val tracker = tracker()
        repeat(300) { tracker.track(event()) }
        tracker.flush()
        tracker.shutdown()

        assertEquals(listOf<String?>("gzip"), encodings.toList())
        assertEquals(300, bodies[0]["events"]!!.jsonArray.size)
    }

    @Test
    fun throwingOnErrorHandlerDoesNotKillTheFlushLoop() {
        statuses = intArrayOf(400, 202)
        val tracker = Tracker(
            "dk_test",
            TrackerOptions(
                endpoint = "http://127.0.0.1:${server.address.port}",
                flushIntervalMs = 50,
                flushAt = 1000,
                retryCount = 0,
                onError = { throw IllegalStateException("handler failure") }
            )
        )
        tracker.track(event())
        assertTrue(waitFor { bodies.size >= 1 }, "first periodic flush never arrived")
        tracker.track(event())
        val secondArrived = waitFor { bodies.size >= 2 }
        tracker.shutdown()

        assertTrue(secondArrived, "periodic flush stopped after onError threw")
    }

    private fun waitFor(condition: () -> Boolean): Boolean {
        val deadline = System.currentTimeMillis() + 5000
        while (!condition() && System.currentTimeMillis() < deadline) Thread.sleep(20)
        return condition()
    }

    @Test
    fun malformedPartialAcceptBodyIsReportedNotResent() {
        statuses = intArrayOf(207)
        responseBody = """{"accepted":"abc","rejected":null,"rejections":[1,{"event_id":5}]}"""
        val tracker = tracker()
        tracker.track(event())
        tracker.flush()
        tracker.shutdown()

        assertEquals(1, bodies.size)
        assertIs<PartialAcceptError>(errors.single())
    }

    @Test
    fun rateLimitedBatchWaitsForRetryAfterAndRetriesTheSameBatch() {
        statuses = intArrayOf(429, 202)
        retryAfter = "2"
        val tracker = tracker()
        tracker.track(event())
        val started = System.nanoTime()
        tracker.flush()
        val elapsedMs = (System.nanoTime() - started) / 1_000_000
        tracker.shutdown()

        assertEquals(2, bodies.size)
        assertTrue(elapsedMs >= 1900, "retried after ${elapsedMs}ms, before the 2s Retry-After")
        assertEquals(bodies[0]["batch_id"], bodies[1]["batch_id"])
        assertTrue(errors.isEmpty())
    }

    @Test
    fun inFlightUnavailableBatchWaitsForRetryAfterAndRetriesTheSameBatch() {
        statuses = intArrayOf(503, 202)
        retryAfter = "2"
        val tracker = tracker()
        tracker.track(event())
        val started = System.nanoTime()
        tracker.flush()
        val elapsedMs = (System.nanoTime() - started) / 1_000_000
        tracker.shutdown()

        assertEquals(2, bodies.size)
        assertTrue(elapsedMs >= 1900, "retried after ${elapsedMs}ms, before the 2s Retry-After")
        assertEquals(bodies[0]["batch_id"], bodies[1]["batch_id"])
        assertTrue(errors.isEmpty())
    }

    @Test
    fun retryAfterIsClampedAndGarbageIsIgnored() {
        assertEquals(2000L, Tracker.parseRetryAfterMs("2"))
        assertEquals(30_000L, Tracker.parseRetryAfterMs("86400"))
        assertEquals(0L, Tracker.parseRetryAfterMs("garbage"))
        assertEquals(0L, Tracker.parseRetryAfterMs(null))
    }

    @Test
    fun serverTextIsSanitizedAndTruncated() {
        val cleaned = Tracker.sanitize("line1\nline2\u001b[31m\u009b31m" + "x".repeat(2000))
        assertTrue(!cleaned.contains("\n") && !cleaned.contains("\u001b") && !cleaned.contains("\u009b"))
        assertTrue(cleaned.length <= 520)
    }
}
