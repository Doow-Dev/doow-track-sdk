package co.doow.track.management

import co.doow.track.DoowError
import co.doow.track.types.*
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.pow

data class ManagementOptions(
    val endpoint: String = System.getenv("DOOW_TRACK_ENDPOINT") ?: "https://api.doow.co",
    val timeoutMs: Int = 30000,
    val retryCount: Int = 3,
    val debug: Boolean = System.getenv("DOOW_TRACK_DEBUG") == "true"
)

class Management(
    apiKey: String,
    private val options: ManagementOptions = ManagementOptions()
) {
    private val apiKey = System.getenv("DOOW_TRACK_API_KEY") ?: apiKey
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = false }

    val apps = AppsResource(this)
    val contracts = ContractsResource(this)
    val licenses = LicensesResource(this)
    val metrics = MetricsResource(this)
    val expenses = ExpensesResource(this)

    init {
        require(this.apiKey.startsWith("dk_")) { "Invalid API key format. Must start with 'dk_'." }
    }

    internal inline fun <reified T> request(method: String, path: String, body: Any? = null): T {
        val url = "${options.endpoint.trimEnd('/')}/sdk$path"
        log("[doow/management] $method $path")

        repeat(options.retryCount + 1) { attempt ->
            try {
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.requestMethod = method
                conn.connectTimeout = options.timeoutMs
                conn.readTimeout = options.timeoutMs
                conn.setRequestProperty("Authorization", "Bearer $apiKey")
                conn.setRequestProperty("Content-Type", "application/json")

                if (body != null && method != "GET" && method != "DELETE") {
                    conn.doOutput = true
                    val jsonBody = json.encodeToString(body)
                    conn.outputStream.use { it.write(jsonBody.toByteArray()) }
                }

                val status = conn.responseCode

                if (status in 200..299) {
                    val responseBody = conn.inputStream.bufferedReader().readText()
                    return json.decodeFromString(responseBody)
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
                throw DoowError("Request failed: ${e.message}")
            }
        }

        throw DoowError("Max retries exceeded")
    }

    internal fun delete(path: String) {
        val url = "${options.endpoint.trimEnd('/')}/sdk$path"
        log("[doow/management] DELETE $path")

        repeat(options.retryCount + 1) { attempt ->
            try {
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.requestMethod = "DELETE"
                conn.connectTimeout = options.timeoutMs
                conn.readTimeout = options.timeoutMs
                conn.setRequestProperty("Authorization", "Bearer $apiKey")

                val status = conn.responseCode
                if (status in 200..299 || status == 204) return

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
                throw DoowError("Request failed: ${e.message}")
            }
        }
    }

    private fun log(message: String) {
        if (options.debug) System.err.println(message)
    }
}

class AppsResource(private val mgmt: Management) {
    fun list(cursor: String? = null, limit: Int = 50): PaginatedResponse<App> {
        var path = "/apps?limit=$limit"
        if (cursor != null) path += "&cursor=$cursor"
        return mgmt.request("GET", path)
    }

    fun get(id: String): App = mgmt.request("GET", "/apps/$id")

    fun create(input: CreateAppInput): App = mgmt.request("POST", "/apps", input)

    fun delete(id: String) = mgmt.delete("/apps/$id")
}

class ContractsResource(private val mgmt: Management) {
    fun listByApp(appId: String, cursor: String? = null, limit: Int = 50): PaginatedResponse<Contract> {
        var path = "/apps/$appId/contracts?limit=$limit"
        if (cursor != null) path += "&cursor=$cursor"
        return mgmt.request("GET", path)
    }

    fun get(id: String): Contract = mgmt.request("GET", "/contracts/$id")

    fun create(appId: String, input: CreateContractInput): Contract =
        mgmt.request("POST", "/apps/$appId/contracts", input)

    fun delete(id: String) = mgmt.delete("/contracts/$id")
}

class LicensesResource(private val mgmt: Management) {
    fun list(cursor: String? = null, limit: Int = 50): PaginatedResponse<License> {
        var path = "/licenses?limit=$limit"
        if (cursor != null) path += "&cursor=$cursor"
        return mgmt.request("GET", path)
    }

    fun get(id: String): License = mgmt.request("GET", "/licenses/$id")
}

class MetricsResource(private val mgmt: Management) {
    fun listByLicense(licenseId: String, cursor: String? = null, limit: Int = 50): PaginatedResponse<Metric> {
        var path = "/licenses/$licenseId/metrics?limit=$limit"
        if (cursor != null) path += "&cursor=$cursor"
        return mgmt.request("GET", path)
    }

    fun get(id: String): Metric = mgmt.request("GET", "/metrics/$id")

    fun create(licenseId: String, input: CreateMetricInput): Metric =
        mgmt.request("POST", "/licenses/$licenseId/metrics", input)

    fun delete(id: String) = mgmt.delete("/metrics/$id")
}

class ExpensesResource(private val mgmt: Management) {
    fun listByApp(appId: String, cursor: String? = null, limit: Int = 50): PaginatedResponse<Expense> {
        var path = "/apps/$appId/expenses?limit=$limit"
        if (cursor != null) path += "&cursor=$cursor"
        return mgmt.request("GET", path)
    }
}
