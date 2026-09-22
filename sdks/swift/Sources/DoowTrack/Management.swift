import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct ManagementOptions {
    public var endpoint: String
    public var timeoutSeconds: Double
    public var retryCount: Int
    public var debug: Bool

    public init(
        endpoint: String = "https://api.doow.co",
        timeoutSeconds: Double = 30,
        retryCount: Int = 3,
        debug: Bool = false
    ) {
        self.endpoint = ProcessInfo.processInfo.environment["DOOW_TRACK_ENDPOINT"] ?? endpoint
        self.debug = ProcessInfo.processInfo.environment["DOOW_TRACK_DEBUG"] == "true" || debug
        self.timeoutSeconds = timeoutSeconds
        self.retryCount = retryCount
    }
}

public class Management {
    private let apiKey: String
    private let options: ManagementOptions
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public lazy var apps = AppsResource(self)
    public lazy var contracts = ContractsResource(self)
    public lazy var licenses = LicensesResource(self)
    public lazy var metrics = MetricsResource(self)
    public lazy var expenses = ExpensesResource(self)

    public init(_ apiKey: String, options: ManagementOptions = ManagementOptions()) throws {
        let key = ProcessInfo.processInfo.environment["DOOW_TRACK_API_KEY"] ?? apiKey
        guard key.hasPrefix("dk_") else {
            throw DoowError("Invalid API key format. Must start with 'dk_'.")
        }
        self.apiKey = key
        self.options = options

        self.encoder = JSONEncoder()
        self.encoder.keyEncodingStrategy = .convertToSnakeCase
        self.encoder.dateEncodingStrategy = .iso8601

        self.decoder = JSONDecoder()
        self.decoder.keyDecodingStrategy = .convertFromSnakeCase
        self.decoder.dateDecodingStrategy = .iso8601
    }

    func request<T: Decodable>(_ method: String, _ path: String, body: Encodable? = nil) throws -> T {
        let url = URL(string: "\(options.endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/sdk\(path)")!
        log("[doow/management] \(method) \(path)")

        for attempt in 0...options.retryCount {
            var request = URLRequest(url: url)
            request.httpMethod = method
            request.timeoutInterval = options.timeoutSeconds
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")

            if let body = body, method != "GET" && method != "DELETE" {
                request.httpBody = try encoder.encode(AnyEncodable(body))
            }

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
                if attempt < options.retryCount {
                    Thread.sleep(forTimeInterval: pow(2, Double(attempt)))
                    continue
                }
                throw DoowError("Request failed: \(error.localizedDescription)")
            }

            if let status = httpResponse?.statusCode {
                if status >= 200 && status < 300 {
                    if let data = responseData, !data.isEmpty {
                        return try decoder.decode(T.self, from: data)
                    }
                    throw DoowError("Empty response")
                }

                if status >= 500 && attempt < options.retryCount {
                    Thread.sleep(forTimeInterval: pow(2, Double(attempt)))
                    continue
                }

                let errorBody = responseData.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                throw DoowError("API error: \(errorBody)", statusCode: status)
            }
        }

        throw DoowError("Max retries exceeded")
    }

    func delete(_ path: String) throws {
        let _: EmptyResponse = try request("DELETE", path)
    }

    private func log(_ message: String) {
        if options.debug {
            fputs("\(message)\n", stderr)
        }
    }
}

struct EmptyResponse: Decodable {}

struct AnyEncodable: Encodable {
    let value: Encodable

    init(_ value: Encodable) {
        self.value = value
    }

    func encode(to encoder: Encoder) throws {
        try value.encode(to: encoder)
    }
}

public class AppsResource {
    private let mgmt: Management

    init(_ mgmt: Management) { self.mgmt = mgmt }

    public func list(cursor: String? = nil, limit: Int = 50) throws -> PaginatedResponse<App> {
        var path = "/apps?limit=\(limit)"
        if let cursor = cursor { path += "&cursor=\(cursor)" }
        return try mgmt.request("GET", path)
    }

    public func get(_ id: String) throws -> App {
        return try mgmt.request("GET", "/apps/\(id)")
    }

    public func create(_ input: CreateAppInput) throws -> App {
        return try mgmt.request("POST", "/apps", body: input)
    }

    public func delete(_ id: String) throws {
        try mgmt.delete("/apps/\(id)")
    }
}

public class ContractsResource {
    private let mgmt: Management

    init(_ mgmt: Management) { self.mgmt = mgmt }

    public func listByApp(_ appId: String, cursor: String? = nil, limit: Int = 50) throws -> PaginatedResponse<Contract> {
        var path = "/apps/\(appId)/contracts?limit=\(limit)"
        if let cursor = cursor { path += "&cursor=\(cursor)" }
        return try mgmt.request("GET", path)
    }

    public func get(_ id: String) throws -> Contract {
        return try mgmt.request("GET", "/contracts/\(id)")
    }

    public func create(_ appId: String, _ input: CreateContractInput) throws -> Contract {
        return try mgmt.request("POST", "/apps/\(appId)/contracts", body: input)
    }

    public func delete(_ id: String) throws {
        try mgmt.delete("/contracts/\(id)")
    }
}

public class LicensesResource {
    private let mgmt: Management

    init(_ mgmt: Management) { self.mgmt = mgmt }

    public func list(cursor: String? = nil, limit: Int = 50) throws -> PaginatedResponse<License> {
        var path = "/licenses?limit=\(limit)"
        if let cursor = cursor { path += "&cursor=\(cursor)" }
        return try mgmt.request("GET", path)
    }

    public func get(_ id: String) throws -> License {
        return try mgmt.request("GET", "/licenses/\(id)")
    }
}

public class MetricsResource {
    private let mgmt: Management

    init(_ mgmt: Management) { self.mgmt = mgmt }

    public func listByLicense(_ licenseId: String, cursor: String? = nil, limit: Int = 50) throws -> PaginatedResponse<Metric> {
        var path = "/licenses/\(licenseId)/metrics?limit=\(limit)"
        if let cursor = cursor { path += "&cursor=\(cursor)" }
        return try mgmt.request("GET", path)
    }

    public func get(_ id: String) throws -> Metric {
        return try mgmt.request("GET", "/metrics/\(id)")
    }

    public func create(_ licenseId: String, _ input: CreateMetricInput) throws -> Metric {
        return try mgmt.request("POST", "/licenses/\(licenseId)/metrics", body: input)
    }

    public func delete(_ id: String) throws {
        try mgmt.delete("/metrics/\(id)")
    }
}

public class ExpensesResource {
    private let mgmt: Management

    init(_ mgmt: Management) { self.mgmt = mgmt }

    public func listByApp(_ appId: String, cursor: String? = nil, limit: Int = 50) throws -> PaginatedResponse<Expense> {
        var path = "/apps/\(appId)/expenses?limit=\(limit)"
        if let cursor = cursor { path += "&cursor=\(cursor)" }
        return try mgmt.request("GET", path)
    }
}
