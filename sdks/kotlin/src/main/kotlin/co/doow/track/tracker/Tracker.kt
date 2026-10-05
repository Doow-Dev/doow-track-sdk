package co.doow.track.tracker

import co.doow.track.DoowError
import co.doow.track.PartialAcceptError
import co.doow.track.types.TrackEvent
import kotlinx.coroutines.*
import co.doow.track.types.EventKind
import co.doow.track.types.MetricTupleHint
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import java.util.UUID
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList
import java.util.zip.GZIPOutputStream
import kotlin.math.pow

data class TrackerOptions(
    val endpoint: String = System.getenv("DOOW_TRACK_ENDPOINT") ?: "https://api.doow.co",
    val enabled: Boolean = System.getenv("DOOW_TRACK_DISABLED") != "true",
    val debug: Boolean = System.getenv("DOOW_TRACK_DEBUG") == "true",
    val flushAt: Int = 20,
    val flushIntervalMs: Long = 10000,
    val maxQueueSize: Int = 10000,
    val timeoutMs: Int = 10000,
    val retryCount: Int = 3,
    val disableCompression: Boolean = false,
    val attribution: Map<String, Any>? = null,
    val onError: ((Exception) -> Unit)? = null
)

class Tracker(
    apiKey: String,
    private val options: TrackerOptions = TrackerOptions()
) : AutoCloseable {
    private val apiKey = System.getenv("DOOW_TRACK_API_KEY") ?: apiKey
    private val buffer = CopyOnWriteArrayList<Pending>()
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = false }
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var flushJob: Job? = null
    @Volatile private var closed = false

    init {
        require(this.apiKey.startsWith("dk_")) { "Invalid API key format. Must start with 'dk_'." }

        if (options.flushIntervalMs > 0) {
            flushJob = scope.launch {
                while (isActive) {
                    delay(options.flushIntervalMs)
                    try {
                        flush()
                    } catch (e: Exception) {
                        log("[doow-track] Flush loop error: ${e.message}")
                    }
                }
            }
        }
    }

    fun track(event: TrackEvent) {
        if (!options.enabled || closed) return

        val finalEvent = event.copy(
            timestamp = event.timestamp ?: Instant.now().toString()
        )

        if (buffer.size >= options.maxQueueSize) {
            log("[doow-track] Queue full, dropping event")
            return
        }

        buffer.add(Pending(UUID.randomUUID().toString(), finalEvent))

        if (buffer.size >= options.flushAt) {
            scope.launch { flush() }
        }
    }

    fun flush() {
        if (buffer.isEmpty()) return

        val batch = synchronized(buffer) {
            val drained = buffer.toList()
            buffer.removeAll(drained.toSet())
            drained
        }
        if (batch.isEmpty()) return

        batch.chunked(MAX_BATCH_EVENTS).forEach { sendBatch(it) }
    }

    internal data class Pending(val eventId: String, val event: TrackEvent)

    private fun sendBatch(batch: List<Pending>) {
        val url = "${options.endpoint.trimEnd('/')}/telemetry/events"
        val batchId = UUID.randomUUID().toString()

        var body = json.encodeToString(buildPayload(batchId, batch)).toByteArray()
        var gzipped = false
        if (!options.disableCompression && body.size > 1024) {
            val baos = ByteArrayOutputStream()
            GZIPOutputStream(baos).use { it.write(body) }
            body = baos.toByteArray()
            gzipped = true
        }

        for (attempt in 0..options.retryCount) {
            val lastAttempt = attempt >= options.retryCount
            try {
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.connectTimeout = options.timeoutMs
                conn.readTimeout = options.timeoutMs
                conn.setRequestProperty("Authorization", "Bearer $apiKey")
                conn.setRequestProperty("Content-Type", "application/json")
                if (gzipped) conn.setRequestProperty("Content-Encoding", "gzip")
                conn.doOutput = true
                conn.outputStream.use { it.write(body) }

                val status = conn.responseCode

                if (status == 207) {
                    report(parsePartialAccept(readBounded(conn.inputStream.bufferedReader()), batchId))
                    return
                }

                if (status in 200..299) {
                    log("[doow-track] Flushed ${batch.size} events")
                    return
                }

                if ((status == 429 || status >= 500) && !lastAttempt) {
                    val backoff = 2.0.pow(attempt).toLong() * 1000
                    val serverDelay = if (status == 429 || status == 503) parseRetryAfterMs(conn.getHeaderField("Retry-After")) else 0L
                    Thread.sleep(maxOf(backoff, serverDelay))
                    continue
                }

                val errorBody = conn.errorStream?.bufferedReader()?.let { readBounded(it) } ?: ""
                report(DoowError("API error: ${sanitize(errorBody)}", status))
                return
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
                return
            } catch (e: Exception) {
                if (lastAttempt) {
                    report(e)
                    return
                }
                Thread.sleep(2.0.pow(attempt).toLong() * 1000)
            }
        }
    }

    private fun parsePartialAccept(body: String, fallbackBatchId: String): PartialAcceptError {
        val root: JsonObject = try {
            json.parseToJsonElement(body) as? JsonObject ?: JsonObject(emptyMap())
        } catch (e: Exception) {
            JsonObject(emptyMap())
        }
        val rejections = (root["rejections"] as? kotlinx.serialization.json.JsonArray).orEmpty().mapNotNull {
            val r = it as? JsonObject ?: return@mapNotNull null
            PartialAcceptError.Rejection(
                sanitize((r["event_id"] as? JsonPrimitive)?.content ?: "unknown"),
                sanitize((r["reason"] as? JsonPrimitive)?.content ?: "")
            )
        }
        return PartialAcceptError(
            accepted = (root["accepted"] as? JsonPrimitive)?.intOrNull ?: 0,
            rejected = (root["rejected"] as? JsonPrimitive)?.intOrNull ?: 0,
            batchId = sanitize((root["batch_id"] as? JsonPrimitive)?.content ?: fallbackBatchId),
            rejections = rejections
        )
    }

    private fun report(error: Exception) {
        try {
            options.onError?.invoke(error)
        } catch (e: Exception) {
            log("[doow-track] onError handler threw: ${e.message}")
        }
        log("[doow-track] Error: ${error.message}")
    }

    fun shutdown() {
        closed = true
        flushJob?.cancel()
        flush()
        scope.cancel()
    }

    override fun close() = shutdown()

    private fun log(message: String) {
        if (options.debug) System.err.println(message)
    }

    @Serializable
    internal data class WireMeasurement(
        @SerialName("metric_name") val metricName: String,
        val quantity: Double,
        @SerialName("metric_tuple_hint") val metricTupleHint: MetricTupleHint? = null
    )

    @OptIn(ExperimentalSerializationApi::class)
    @Serializable
    internal data class WireEvent(
        @SerialName("event_id") val eventId: String,
        @SerialName("license_id") val licenseId: String,
        @SerialName("occurred_at") val occurredAt: String,
        @SerialName("source_system") val sourceSystem: String,
        @EncodeDefault val kind: EventKind,
        val unit: String? = null,
        val attribution: Map<String, JsonElement>? = null,
        val metadata: Map<String, JsonElement>? = null,
        val measurements: List<WireMeasurement>
    )

    @Serializable
    internal data class WireBatch(
        @SerialName("batch_id") val batchId: String,
        @SerialName("sdk_version") val sdkVersion: String,
        val events: List<WireEvent>
    )

    internal companion object {
        const val SDK_VERSION = "0.1.0"
        private const val MAX_RETRY_AFTER_MS = 30_000L
        private const val MAX_ERROR_TEXT = 512
        private const val MAX_BODY_CHARS = 1 shl 20
        private const val MAX_BATCH_EVENTS = 500

        fun parseRetryAfterMs(header: String?): Long {
            val value = header?.trim().orEmpty()
            if (value.isEmpty()) return 0
            val ms = value.toDoubleOrNull()?.let { (it * 1000).toLong() }
                ?: try {
                    java.time.Duration.between(
                        java.time.Instant.now(),
                        java.time.ZonedDateTime.parse(value, java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME).toInstant()
                    ).toMillis()
                } catch (e: java.time.format.DateTimeParseException) {
                    return 0
                }
            return ms.coerceIn(0, MAX_RETRY_AFTER_MS)
        }

        fun sanitize(text: String): String {
            val cleaned = text.replace(Regex("\\p{Cc}"), " ")
            return if (cleaned.length > MAX_ERROR_TEXT) cleaned.take(MAX_ERROR_TEXT) + "..." else cleaned
        }

        fun readBounded(reader: java.io.Reader): String {
            val sb = StringBuilder()
            val buf = CharArray(1024)
            while (sb.length < MAX_BODY_CHARS) {
                val n = reader.read(buf)
                if (n == -1) break
                sb.append(buf, 0, n)
            }
            return sb.toString()
        }

        fun buildPayload(batchId: String, batch: List<Pending>) = WireBatch(
            batchId = batchId,
            sdkVersion = SDK_VERSION,
            events = batch.map { (eventId, e) ->
                WireEvent(
                    eventId = eventId,
                    licenseId = e.licenseId,
                    occurredAt = e.timestamp ?: Instant.now().toString(),
                    sourceSystem = e.sourceSystem?.takeIf { it.isNotBlank() } ?: "sdk",
                    kind = e.kind,
                    unit = e.unit,
                    attribution = e.attribution,
                    metadata = e.metadata,
                    measurements = listOf(WireMeasurement(e.metric, e.quantity, e.metricTupleHint))
                )
            }
        )
    }
}
