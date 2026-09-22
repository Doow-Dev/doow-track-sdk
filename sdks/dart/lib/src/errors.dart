class DoowError implements Exception {
  final String message;
  final int? statusCode;

  DoowError(this.message, {this.statusCode});

  @override
  String toString() => statusCode != null
      ? 'DoowError($statusCode): $message'
      : 'DoowError: $message';
}

class ValidationError extends DoowError {
  ValidationError(String message) : super(message);
}

class AuthError extends DoowError {
  AuthError(String message) : super(message, statusCode: 401);
}

class RateLimitError extends DoowError {
  final Duration? retryAfter;

  RateLimitError(String message, {this.retryAfter})
      : super(message, statusCode: 429);
}
