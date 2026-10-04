import Foundation

public struct DoowError: Error, LocalizedError {
    public let message: String
    public let statusCode: Int
    public let errorClass: String?

    public init(_ message: String, statusCode: Int = 0, errorClass: String? = nil) {
        self.message = message
        self.statusCode = statusCode
        self.errorClass = errorClass
    }

    public var errorDescription: String? { message }

    public var isNotFound: Bool { statusCode == 404 }
    public var isUnauthorized: Bool { statusCode == 401 }
    public var isForbidden: Bool { statusCode == 403 }
    public var isRateLimited: Bool { statusCode == 429 }
    public var isServerError: Bool { statusCode >= 500 }
}

public struct EventRejection: Codable, Equatable {
    public let eventId: String
    public let reason: String

    enum CodingKeys: String, CodingKey {
        case eventId = "event_id"
        case reason
    }
}

public struct PartialAcceptError: Error, LocalizedError, Decodable {
    public let accepted: Int
    public let rejected: Int
    public let batchId: String
    public let rejections: [EventRejection]

    enum CodingKeys: String, CodingKey {
        case accepted, rejected, rejections
        case batchId = "batch_id"
    }

    public init(accepted: Int, rejected: Int, batchId: String, rejections: [EventRejection]) {
        self.accepted = accepted
        self.rejected = rejected
        self.batchId = batchId
        self.rejections = rejections
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        accepted = try c.decodeIfPresent(Int.self, forKey: .accepted) ?? 0
        rejected = try c.decodeIfPresent(Int.self, forKey: .rejected) ?? 0
        batchId = try c.decodeIfPresent(String.self, forKey: .batchId) ?? ""
        rejections = try c.decodeIfPresent([EventRejection].self, forKey: .rejections) ?? []
    }

    public var errorDescription: String? {
        let detail = rejections.first.map { " (\($0.eventId): \($0.reason))" } ?? ""
        return "batch \(batchId) partially accepted: \(rejected) rejected\(detail)"
    }
}
