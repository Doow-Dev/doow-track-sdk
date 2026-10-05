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

final class BoundedResponseCollector {
    private let limit: Int
    private let onComplete: () -> Void
    private var truncated = false
    private var timedOut = false
    private(set) var data = Data()
    private(set) var response: HTTPURLResponse?
    private(set) var error: Error?

    init(limit: Int, onComplete: @escaping () -> Void) {
        self.limit = limit
        self.onComplete = onComplete
    }

    func received(_ response: URLResponse) {
        self.response = response as? HTTPURLResponse
    }

    func received(_ chunk: Data, from task: URLSessionTask) {
        let room = limit - data.count
        if chunk.count >= room {
            data.append(chunk.prefix(max(room, 0)))
            truncated = true
            task.cancel()
        } else {
            data.append(chunk)
        }
    }

    func timeOut() {
        timedOut = true
    }

    func completed(with failure: Error?) {
        if timedOut {
            error = URLError(.timedOut)
        } else if !(truncated && (failure as NSError?)?.code == NSURLErrorCancelled) {
            error = failure
        }
        onComplete()
    }
}

/// Foundation on Linux ignores per-task delegates, so callbacks are routed from one session delegate.
final class BoundedResponseSession: NSObject, URLSessionDataDelegate {
    private let lock = NSLock()
    private var collectors: [Int: BoundedResponseCollector] = [:]
    private(set) var session: URLSession!

    init(configuration: URLSessionConfiguration) {
        super.init()
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }

    func register(_ collector: BoundedResponseCollector, for task: URLSessionTask) {
        lock.lock()
        collectors[task.taskIdentifier] = collector
        lock.unlock()
    }

    func unregister(_ task: URLSessionTask) {
        lock.lock()
        collectors[task.taskIdentifier] = nil
        lock.unlock()
    }

    private func collector(for task: URLSessionTask) -> BoundedResponseCollector? {
        lock.lock()
        defer { lock.unlock() }
        return collectors[task.taskIdentifier]
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        collector(for: dataTask)?.received(response)
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        collector(for: dataTask)?.received(data, from: dataTask)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        collector(for: task)?.completed(with: error)
    }
}

struct BufferedEvent {
    let eventId: String
    let event: TrackEvent
}

let doowSdkVersion = "0.1.0"
let maxResponseBytes = 1 << 20
let responseGraceSeconds: Double = 5
let maxRetryAfterSeconds: Double = 30

func parseRetryAfter(_ header: String?) -> Double {
    guard let value = header?.trimmingCharacters(in: .whitespaces), !value.isEmpty else { return 0 }
    var seconds: Double
    if let numeric = Double(value) {
        seconds = numeric
    } else {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "GMT")
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        guard let date = formatter.date(from: value) else { return 0 }
        seconds = date.timeIntervalSinceNow
    }
    if !seconds.isFinite || seconds < 0 { return 0 }
    return min(seconds, maxRetryAfterSeconds)
}

public class Tracker {
    static let maxBatchEvents = 500

    private let apiKey: String
    private let options: TrackerOptions
    private var buffer: [BufferedEvent] = []
    private let lock = NSLock()
    private let encoder: JSONEncoder
    private var flushTimer: Timer?
    private var isClosed = false
    private var holdUntil: TimeInterval = 0
    private let responseSession: BoundedResponseSession

    public init(_ apiKey: String, options: TrackerOptions = TrackerOptions()) throws {
        let key = ProcessInfo.processInfo.environment["DOOW_TRACK_API_KEY"] ?? apiKey
        guard key.hasPrefix("dk_") else {
            throw DoowError("Invalid API key format. Must start with 'dk_'.")
        }
        self.apiKey = key
        self.options = options
        self.responseSession = BoundedResponseSession(configuration: options.session.configuration)

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

        if buffer.count >= options.flushAt && ProcessInfo.processInfo.systemUptime >= holdUntil {
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

        var start = 0
        while start < batch.count {
            let end = min(start + Tracker.maxBatchEvents, batch.count)
            if sendBatch(Array(batch[start..<end])) {
                requeue(Array(batch[start...]))
                break
            }
            start = end
        }
    }

    private func requeue(_ events: [BufferedEvent]) {
        lock.lock()
        defer { lock.unlock() }
        guard !isClosed, !events.isEmpty else { return }
        buffer = events + buffer
        if buffer.count > options.maxQueueSize {
            buffer.removeLast(buffer.count - options.maxQueueSize)
        }
        holdUntil = ProcessInfo.processInfo.systemUptime + options.flushIntervalSeconds
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
                    sourceSystem: e.sourceSystem.flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 } ?? "sdk",
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

    private func sendBatch(_ batch: [BufferedEvent]) -> Bool {
        let url = URL(string: "\(options.endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/telemetry/events")!
        let batchId = UUID().uuidString.lowercased()

        var body: Data
        var contentEncoding: String?
        do {
            body = try encoder.encode(Tracker.makeBatch(batchId: batchId, events: batch))
        } catch {
            report(error)
            return false
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

            let (responseData, httpResponse, responseError) = perform(request)

            if let error = responseError {
                if isLastAttempt {
                    report(error)
                    return true
                }
                Thread.sleep(forTimeInterval: pow(2, Double(attempt)))
                continue
            }

            guard let status = httpResponse?.statusCode else { return false }

            let boundedData = responseData.map { Data($0.prefix(maxResponseBytes)) }

            if status == 207 {
                let partial = boundedData.flatMap { try? JSONDecoder().decode(PartialAcceptError.self, from: $0) }
                    ?? PartialAcceptError(accepted: 0, rejected: 0, batchId: batchId, rejections: [])
                report(partial)
                return false
            }

            if status >= 200 && status < 300 {
                log("[doow-track] Flushed \(batch.count) events")
                return false
            }

            if (status == 408 || status == 429 || status >= 500) && !isLastAttempt {
                var delay = pow(2, Double(attempt))
                if status == 429 || status == 503 {
                    delay = max(delay, parseRetryAfter(httpResponse?.value(forHTTPHeaderField: "Retry-After")))
                }
                Thread.sleep(forTimeInterval: delay)
                continue
            }

            let errorBody = boundedData.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            report(DoowError("API error: \(sanitizeText(errorBody))", statusCode: status))
            return status == 408 || status == 429 || status >= 500
        }
        return false
    }

    private func perform(_ request: URLRequest) -> (Data?, HTTPURLResponse?, Error?) {
        let semaphore = DispatchSemaphore(value: 0)
        let collector = BoundedResponseCollector(limit: maxResponseBytes) { semaphore.signal() }
        let task = responseSession.session.dataTask(with: request)
        responseSession.register(collector, for: task)
        task.resume()
        if semaphore.wait(timeout: .now() + options.timeoutSeconds + responseGraceSeconds) == .timedOut {
            collector.timeOut()
            task.cancel()
            semaphore.wait()
        }
        responseSession.unregister(task)
        return (collector.data, collector.response, collector.error)
    }

    private func report(_ error: Error) {
        options.onError?(error)
        log("[doow-track] Error: \(error.localizedDescription)")
    }

    public func shutdown() {
        isClosed = true
        flushTimer?.invalidate()
        flush()
        responseSession.session.finishTasksAndInvalidate()
    }

    private func log(_ message: String) {
        if options.debug {
            fputs("\(message)\n", stderr)
        }
    }
}
