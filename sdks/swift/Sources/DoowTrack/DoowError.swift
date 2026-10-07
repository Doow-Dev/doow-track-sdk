import Foundation

private func isUnsafeScalar(_ scalar: Unicode.Scalar) -> Bool {
    if CharacterSet.controlCharacters.contains(scalar) { return true }
    switch scalar.value {
    case 0x061C, 0x200E, 0x200F, 0x2028, 0x2029, 0x202A...0x202E, 0x2066...0x2069:
        return true
    default:
        return false
    }
}

func sanitizeText(_ text: String) -> String {
    let cleaned = String(text.unicodeScalars.map { scalar in
        isUnsafeScalar(scalar) ? " " : Character(scalar)
    })
    return cleaned.count > 512 ? String(cleaned.prefix(512)) + "..." : cleaned
}

public struct DoowError: Error, LocalizedError {
    public let message: String
    public let statusCode: Int
    public let errorClass: String?

    public init(_ message: String, statusCode: Int = 0, errorClass: String? = nil) {
        self.message = sanitizeText(message)
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

    public init(eventId: String, reason: String) {
        self.eventId = eventId
        self.reason = reason
    }

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
        batchId = sanitizeText(try c.decodeIfPresent(String.self, forKey: .batchId) ?? "")
        rejections = (try c.decodeIfPresent([EventRejection].self, forKey: .rejections) ?? []).map {
            EventRejection(eventId: sanitizeText($0.eventId), reason: sanitizeText($0.reason))
        }
    }

    public var errorDescription: String? {
        let detail = rejections.first.map { " (\($0.eventId): \($0.reason))" } ?? ""
        return "batch \(batchId) partially accepted: \(rejected) rejected\(detail)"
    }
}
