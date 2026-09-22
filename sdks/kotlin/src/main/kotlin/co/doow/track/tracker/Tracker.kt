package co.doow.track.tracker

import co.doow.track.DoowError
import co.doow.track.types.TrackEvent
import kotlinx.coroutines.*
import kotlinx.serialization.Serializable
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
    private val buffer = CopyOnWriteArrayList<TrackEvent>()
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
                    flush()
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

        buffer.add(finalEvent)

        if (buffer.size >= options.flushAt) {
            scope.launch { flush() }
        }
    }

    fun flush() {
        if (buffer.isEmpty()) return

        val batch = buffer.toList()
        buffer.clear()

        sendBatch(batch)
    }

    private fun sendBatch(batch: List<TrackEvent>) {
        val url = "${options.endpoint.trimEnd('/')}/telemetry/events"

        repeat(options.retryCount + 1) { attempt ->
            try {
                val payload = EventsPayload(batch)
                var jsonBytes = json.encodeToString(payload).toByteArray()

                val conn = URL(url).openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.connectTimeout = options.timeoutMs
                conn.readTimeout = options.timeoutMs
                conn.setRequestProperty("Authorization", "Bearer $apiKey")
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true

                if (!options.disableCompression && jsonBytes.size > 1024) {
                    val baos = ByteArrayOutputStream()
                    GZIPOutputStream(baos).use { it.write(jsonBytes) }
                    jsonBytes = baos.toByteArray()
                    conn.setRequestProperty("Content-Encoding", "gzip")
                }

                conn.outputStream.use { it.write(jsonBytes) }

                val status = conn.responseCode
                if (status in 200..299) {
                    log("[doow-track] Flushed ${batch.size} events")
                    return
                }

                if (status >= 500 && attempt < options.retryCount) {
                    Thread.sleep(2.0.pow(attempt).toLong() * 1000)
                    return@repeat
                }

                val errorBody = conn.errorStream?.bufferedReader()?.readText() ?: ""
                throw DoowError("API error: $errorBody", status)

            } catch (e: Exception) {
                if (e is DoowError) throw e
                if (attempt < options.retryCount) {
                    Thread.sleep(2.0.pow(attempt).toLong() * 1000)
                    return@repeat
                }
                options.onError?.invoke(e)
                log("[doow-track] Error: ${e.message}")
            }
        }
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
    private data class EventsPayload(val events: List<TrackEvent>)
}
