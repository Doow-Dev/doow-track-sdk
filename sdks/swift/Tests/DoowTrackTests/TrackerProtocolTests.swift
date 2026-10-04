import Testing
import Foundation
@testable import DoowTrack

final class StubURLProtocol: URLProtocol {
    static var responder: ((URLRequest) -> (Int, Data))?
    static var headers: [String: String] = [:]
    static var endlessBody = false
    static var bytesServed = 0
    private var stopped = false
    private let stopLock = NSLock()
    static var requests: [(request: URLRequest, body: Data)] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var body = request.httpBody ?? Data()
        if body.isEmpty, let stream = request.httpBodyStream {
            stream.open()
            var buffer = [UInt8](repeating: 0, count: 65536)
            while stream.hasBytesAvailable {
                let n = stream.read(&buffer, maxLength: buffer.count)
                if n <= 0 { break }
                body.append(buffer, count: n)
            }
            stream.close()
        }
        Self.requests.append((request, body))
        let (status, data) = Self.responder?(request) ?? (202, Data())
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: Self.headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if Self.endlessBody {
            let chunk = Data(repeating: UInt8(ascii: "x"), count: 65536)
            DispatchQueue.global().async { [self] in
                while !isStopped && Self.bytesServed < 200_000_000 {
                    Self.bytesServed += chunk.count
                    client?.urlProtocol(self, didLoad: chunk)
                    usleep(500)
                }
            }
            return
        }
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    private var isStopped: Bool {
        stopLock.lock()
        defer { stopLock.unlock() }
        return stopped
    }

    override func stopLoading() {
        stopLock.lock()
        stopped = true
        stopLock.unlock()
    }
}

@Suite(.serialized)
final class TrackerProtocolTests {
    private let session: URLSession
    private var errors: [Error] = []

    init() {
        StubURLProtocol.requests = []
        StubURLProtocol.responder = nil
        StubURLProtocol.headers = [:]
        StubURLProtocol.endlessBody = false
        StubURLProtocol.bytesServed = 0
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        session = URLSession(configuration: config)
    }

    private func makeTracker(retryCount: Int = 2) throws -> Tracker {
        try Tracker("dk_test", options: TrackerOptions(
            endpoint: "https://test.doow.co",
            flushAt: 1000,
            flushIntervalSeconds: 0,
            retryCount: retryCount,
            onError: { [unowned self] in self.errors.append($0) },
            session: session
        ))
    }

    private func track(_ tracker: Tracker, hint: MetricTupleHint? = nil) {
        tracker.track(TrackEvent(metric: "api_calls", quantity: 1, licenseId: "lic_1", metricTupleHint: hint))
    }

    private func json(_ data: Data) throws -> [String: Any] {
        try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    @Test func batchEnvelopeAndObjectTupleHint() throws {
        let tracker = try makeTracker()
        track(tracker, hint: MetricTupleHint(appName: "app", licenseName: "lic", metricName: "calls"))
        tracker.flush()

        #expect(StubURLProtocol.requests.count == 1)
        let body = try json(StubURLProtocol.requests[0].body)
        #expect(body["batch_id"] != nil)
        #expect(body["sdk_version"] != nil)
        let event = try #require((body["events"] as? [[String: Any]])?.first)
        #expect(event["event_id"] != nil)
        #expect(event["occurred_at"] != nil)
        #expect(event["license_id"] as? String == "lic_1")
        #expect(event["source_system"] as? String == "sdk")
        let measurement = try #require((event["measurements"] as? [[String: Any]])?.first)
        #expect(measurement["metric_name"] as? String == "api_calls")
        let hint = measurement["metric_tuple_hint"] as? [String: String]
        #expect(hint == ["app_name": "app", "license_name": "lic", "metric_name": "calls"])
        #expect(errors.isEmpty)
    }

    @Test func blankSourceSystemDefaultsToSdk() throws {
        let tracker = try makeTracker()
        tracker.track(TrackEvent(metric: "api_calls", quantity: 1, licenseId: "lic_1", sourceSystem: " "))
        tracker.flush()

        let body = try json(StubURLProtocol.requests[0].body)
        let event = try #require((body["events"] as? [[String: Any]])?.first)
        #expect(event["source_system"] as? String == "sdk")
    }

    @Test func partialAcceptReportsRejectionsWithoutRetry() throws {
        StubURLProtocol.responder = { _ in
            (207, Data(#"{"accepted":1,"rejected":1,"batch_id":"b","rejections":[{"event_id":"evt-x","reason":"license_id is required"}]}"#.utf8))
        }
        let tracker = try makeTracker()
        track(tracker)
        tracker.flush()

        #expect(StubURLProtocol.requests.count == 1)
        let partial = try #require(errors.first as? PartialAcceptError)
        #expect(partial.rejections == [EventRejection(eventId: "evt-x", reason: "license_id is required")])
    }

    @Test func clientErrorIsReportedWithoutRetry() throws {
        StubURLProtocol.responder = { _ in (401, Data("no".utf8)) }
        let tracker = try makeTracker()
        track(tracker)
        tracker.flush()

        #expect(StubURLProtocol.requests.count == 1)
        #expect((errors.first as? DoowError)?.statusCode == 401)
    }

    @Test func retryKeepsBatchId() throws {
        var calls = 0
        StubURLProtocol.responder = { _ in
            calls += 1
            return (calls == 1 ? 503 : 202, Data())
        }
        let tracker = try makeTracker()
        track(tracker)
        tracker.flush()

        #expect(StubURLProtocol.requests.count == 2)
        let ids = try StubURLProtocol.requests.map { try json($0.body)["batch_id"] as? String }
        #expect(Set(ids).count == 1)
        let eventIds = try StubURLProtocol.requests.map { request -> String? in
            let events = try json(request.body)["events"] as? [[String: Any]]
            return events?.first?["event_id"] as? String
        }
        #expect(eventIds.count == 2)
        #expect(Set(eventIds).count == 1)
    }

    @Test func malformedPartialAcceptBodyIsReportedWithoutResend() throws {
        StubURLProtocol.responder = { _ in
            (207, Data(#"{"accepted":"abc","rejected":null,"rejections":[1,"x",{"event_id":5}]}"#.utf8))
        }
        let tracker = try makeTracker()
        track(tracker)
        tracker.flush()

        #expect(StubURLProtocol.requests.count == 1)
        #expect(errors.first is PartialAcceptError)
    }

    @Test func oversizedErrorBodiesStopBeingReadAtTheCap() throws {
        StubURLProtocol.endlessBody = true
        StubURLProtocol.responder = { _ in (400, Data()) }
        let tracker = try makeTracker()
        track(tracker)
        tracker.flush()

        let error = try #require(errors.first as? DoowError)
        #expect(error.statusCode == 400)
        #expect(error.message.count <= 540)
        #expect(StubURLProtocol.bytesServed >= 1 << 20)
        #expect(StubURLProtocol.bytesServed <= 8_000_000)
    }

    @Test(arguments: [429, 503]) func throttledBatchWaitsForRetryAfterAndRetriesTheSameBatch(firstStatus: Int) throws {
        var calls = 0
        StubURLProtocol.headers = ["Retry-After": "2"]
        StubURLProtocol.responder = { _ in
            calls += 1
            return (calls == 1 ? firstStatus : 202, Data())
        }
        let tracker = try makeTracker()
        track(tracker)
        let started = Date()
        tracker.flush()
        let elapsed = Date().timeIntervalSince(started)

        #expect(StubURLProtocol.requests.count == 2)
        #expect(elapsed >= 1.9)
        let ids = try StubURLProtocol.requests.map { try json($0.body)["batch_id"] as? String }
        #expect(Set(ids).count == 1)
        #expect(errors.isEmpty)
    }

    @Test func retryAfterIsClampedAndGarbageIgnored() {
        #expect(parseRetryAfter("2") == 2)
        #expect(parseRetryAfter("86400") == 30)
        #expect(parseRetryAfter("garbage") == 0)
        #expect(parseRetryAfter(nil) == 0)
    }

    @Test func serverTextIsSanitizedAndTruncated() {
        let cleaned = sanitizeText("line1\nline2\u{1b}[31m" + String(repeating: "x", count: 2000))
        #expect(!cleaned.contains("\n"))
        #expect(!cleaned.contains("\u{1b}"))
        #expect(cleaned.count <= 520)
    }

    #if canImport(Compression)
    @Test func gzipBodyIsAValidGzipStream() throws {
        let tracker = try makeTracker()
        for _ in 0..<200 { track(tracker) }
        tracker.flush()

        let sent = StubURLProtocol.requests[0]
        #expect(sent.request.value(forHTTPHeaderField: "Content-Encoding") == "gzip")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/gunzip")
        process.arguments = ["-c"]
        let input = Pipe(), output = Pipe()
        process.standardInput = input
        process.standardOutput = output
        try process.run()
        input.fileHandleForWriting.write(sent.body)
        input.fileHandleForWriting.closeFile()
        let decoded = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        #expect(process.terminationStatus == 0)
        #expect((try json(decoded)["events"] as? [Any])?.count == 200)
    }
    #endif
}
