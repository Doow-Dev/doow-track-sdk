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
        onError: ((Error) -> Void)? = nil
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
    }
}

public class Tracker {
    private let apiKey: String
    private let options: TrackerOptions
    private var buffer: [TrackEvent] = []
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

        buffer.append(finalEvent)

        if buffer.count >= options.flushAt {
            DispatchQueue.global().async { [weak self] in
                self?.flush()
            }
        }
    }

    public func flush() {
        var batch: [TrackEvent]

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

    private func sendBatch(_ batch: [TrackEvent]) {
        let url = URL(string: "\(options.endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/telemetry/events")!

        for attempt in 0...options.retryCount {
            do {
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.timeoutInterval = options.timeoutSeconds
                request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")

                let payload = ["events": batch]
                var jsonData = try encoder.encode(payload)

                if !options.disableCompression && jsonData.count > 1024 {
                    if let compressed = try? (jsonData as NSData).compressed(using: .zlib) as Data {
                        jsonData = compressed
                        request.setValue("gzip", forHTTPHeaderField: "Content-Encoding")
                    }
                }

                request.httpBody = jsonData

                let semaphore = DispatchSemaphore(value: 0)
                var responseData: Data?
                var responseError: Error?
                var httpResponse: HTTPURLResponse?

                let task = URLSession.shared.dataTask(with: request) { data, response, error in
                    responseData = data
                    responseError = error
                    httpResponse = response as? HTTPURLResponse
                    semaphore.signal()
                }
                task.resume()
                semaphore.wait()

                if let error = responseError {
                    throw error
                }

                if let status = httpResponse?.statusCode {
                    if status >= 200 && status < 300 {
                        log("[doow-track] Flushed \(batch.count) events")
                        return
                    }

                    if status >= 500 && attempt < options.retryCount {
                        Thread.sleep(forTimeInterval: pow(2, Double(attempt)))
                        continue
                    }

                    let errorBody = responseData.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                    throw DoowError("API error: \(errorBody)", statusCode: status)
                }
            } catch {
                if attempt < options.retryCount {
                    Thread.sleep(forTimeInterval: pow(2, Double(attempt)))
                    continue
                }
                options.onError?(error)
                log("[doow-track] Error: \(error.localizedDescription)")
            }
        }
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
