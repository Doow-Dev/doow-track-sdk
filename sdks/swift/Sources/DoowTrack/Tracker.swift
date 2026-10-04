import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct TrackerOptions {
    public var endpoint: String
    public var enabled: Bool
    public var debug: Bool
    public var flushAt: Int
    public var flushIntervalSeconds: Double
    public var maxQueueSize: Int
    public var timeoutSeconds: Double
    public var retryCount: Int
    public var disableCompression: Bool
    public var attribution: [String: AnyCodable]?
    public var onError: ((Error) -> Void)?
    public var session: URLSession

    public init(
        endpoint: String = "https://api.doow.co",
        enabled: Bool = true,
        debug: Bool = false,
        flushAt: Int = 20,
        flushIntervalSeconds: Double = 10,
        maxQueueSize: Int = 10000,
        timeoutSeconds: Double = 10,
        retryCount: Int = 3,
        disableCompression: Bool = false,
        attribution: [String: AnyCodable]? = nil,
        onError: ((Error) -> Void)? = nil,
        session: URLSession = .shared
    ) {
        self.endpoint = ProcessInfo.processInfo.environment["DOOW_TRACK_ENDPOINT"] ?? endpoint
        self.enabled = ProcessInfo.processInfo.environment["DOOW_TRACK_DISABLED"] != "true" && enabled
        self.debug = ProcessInfo.processInfo.environment["DOOW_TRACK_DEBUG"] == "true" || debug
        self.flushAt = flushAt
        self.flushIntervalSeconds = flushIntervalSeconds
        self.maxQueueSize = maxQueueSize
        self.timeoutSeconds = timeoutSeconds
        self.retryCount = retryCount
        self.disableCompression = disableCompression
        self.attribution = attribution
        self.onError = onError
        self.session = session
    }
}

struct WireMeasurement: Encodable {
    let metricName: String
    let quantity: Double
    let metricTupleHint: MetricTupleHint?

    enum CodingKeys: String, CodingKey {
        case quantity
        case metricName = "metric_name"
        case metricTupleHint = "metric_tuple_hint"
    }
}

struct WireEvent: Encodable {
    let eventId: String
    let licenseId: String
    let occurredAt: Date
    let sourceSystem: String
    let kind: EventKind
    let attribution: [String: AnyCodable]?
    let metadata: [String: AnyCodable]?
    let measurements: [WireMeasurement]

    enum CodingKeys: String, CodingKey {
        case kind, attribution, metadata, measurements
        case eventId = "event_id"
        case licenseId = "license_id"
        case occurredAt = "occurred_at"
        case sourceSystem = "source_system"
    }
}

struct WireBatch: Encodable {
    let batchId: String
    let sdkVersion: String
    let events: [WireEvent]

    enum CodingKeys: String, CodingKey {
        case events
        case batchId = "batch_id"
        case sdkVersion = "sdk_version"
    }
}

struct BufferedEvent {
    let eventId: String
    let event: TrackEvent
}

let doowSdkVersion = "0.1.0"

public class Tracker {
    private let apiKey: String
    private let options: TrackerOptions
    private var buffer: [BufferedEvent] = []
    private let lock = NSLock()
    private let encoder: JSONEncoder
    private var flushTimer: Timer?
    private var isClosed = false

    public init(_ apiKey: String, options: TrackerOptions = TrackerOptions()) throws {
        let key = ProcessInfo.processInfo.environment["DOOW_TRACK_API_KEY"] ?? apiKey
        guard key.hasPrefix("dk_") else {
            throw DoowError("Invalid API key format. Must start with 'dk_'.")
        }
        self.apiKey = key
        self.options = options

        self.encoder = JSONEncoder()
        self.encoder.keyEncodingStrategy = .convertToSnakeCase
        self.encoder.dateEncodingStrategy = .iso8601

        if options.flushIntervalSeconds > 0 {
            DispatchQueue.main.async { [weak self] in
                self?.flushTimer = Timer.scheduledTimer(withTimeInterval: options.flushIntervalSeconds, repeats: true) { [weak self] _ in
                    self?.flush()
                }
            }
        }
    }

    public func track(_ event: TrackEvent) {
        guard options.enabled, !isClosed else { return }

        var finalEvent = event
        finalEvent.timestamp = event.timestamp ?? Date()
        if let defaultAttribution = options.attribution {
            var merged = defaultAttribution
            if let eventAttribution = event.attribution {
                for (key, value) in eventAttribution {
                    merged[key] = value
                }
            }
            finalEvent.attribution = merged
        }

        lock.lock()
        defer { lock.unlock() }

        guard buffer.count < options.maxQueueSize else {
            log("[doow-track] Queue full, dropping event")
            return
        }

        buffer.append(BufferedEvent(eventId: UUID().uuidString.lowercased(), event: finalEvent))

        if buffer.count >= options.flushAt {
            DispatchQueue.global().async { [weak self] in
                self?.flush()
            }
        }
    }

    public func flush() {
        var batch: [BufferedEvent]

        lock.lock()
        guard !buffer.isEmpty else {
            lock.unlock()
            return
        }
        batch = buffer
        buffer.removeAll()
        lock.unlock()

        sendBatch(batch)
    }

    static func makeBatch(batchId: String, events: [BufferedEvent]) -> WireBatch {
        WireBatch(
            batchId: batchId,
            sdkVersion: doowSdkVersion,
            events: events.map { buffered in
                let e = buffered.event
                return WireEvent(
                    eventId: buffered.eventId,
                    licenseId: e.licenseId,
                    occurredAt: e.timestamp ?? Date(),
                    sourceSystem: e.sourceSystem ?? "sdk",
                    kind: e.kind,
                    attribution: e.attribution,
                    metadata: e.metadata,
                    measurements: [
                        WireMeasurement(metricName: e.metric, quantity: e.quantity, metricTupleHint: e.metricTupleHint)
                    ]
                )
            }
        )
    }

    private func sendBatch(_ batch: [BufferedEvent]) {
        let url = URL(string: "\(options.endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/telemetry/events")!
        let batchId = UUID().uuidString.lowercased()

        var body: Data
        var contentEncoding: String?
        do {
            body = try encoder.encode(Tracker.makeBatch(batchId: batchId, events: batch))
        } catch {
            report(error)
            return
        }
        if !options.disableCompression && body.count > 1024, let gzipped = Gzip.encode(body) {
            body = gzipped
            contentEncoding = "gzip"
        }

        for attempt in 0...options.retryCount {
            let isLastAttempt = attempt >= options.retryCount
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.timeoutInterval = options.timeoutSeconds
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if let contentEncoding = contentEncoding {
                request.setValue(contentEncoding, forHTTPHeaderField: "Content-Encoding")
            }
            request.httpBody = body

            let semaphore = DispatchSemaphore(value: 0)
            var responseData: Data?
            var responseError: Error?
            var httpResponse: HTTPURLResponse?

            options.session.dataTask(with: request) { data, response, error in
                responseData = data
                responseError = error
                httpResponse = response as? HTTPURLResponse
                semaphore.signal()
            }.resume()
            semaphore.wait()

            if let error = responseError {
                if isLastAttempt {
                    report(error)
                    return
                }
                Thread.sleep(forTimeInterval: pow(2, Double(attempt)))
                continue
            }

            guard let status = httpResponse?.statusCode else { return }

            if status == 207 {
                let partial = responseData.flatMap { try? JSONDecoder().decode(PartialAcceptError.self, from: $0) }
                    ?? PartialAcceptError(accepted: 0, rejected: 0, batchId: batchId, rejections: [])
                report(partial)
                return
            }

            if status >= 200 && status < 300 {
                log("[doow-track] Flushed \(batch.count) events")
                return
            }

            if (status == 429 || status >= 500) && !isLastAttempt {
                Thread.sleep(forTimeInterval: pow(2, Double(attempt)))
                continue
            }

            let errorBody = responseData.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            report(DoowError("API error: \(errorBody)", statusCode: status))
            return
        }
    }

    private func report(_ error: Error) {
        options.onError?(error)
        log("[doow-track] Error: \(error.localizedDescription)")
    }

    public func shutdown() {
        isClosed = true
        flushTimer?.invalidate()
        flush()
    }

    private func log(_ message: String) {
        if options.debug {
            fputs("\(message)\n", stderr)
        }
    }
}
