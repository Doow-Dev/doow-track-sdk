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
