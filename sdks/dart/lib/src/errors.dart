import 'dart:convert';

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

class EventRejection {
  final String eventId;
  final String reason;

  const EventRejection(this.eventId, this.reason);
}

class PartialAcceptError extends DoowError {
  final int accepted;
  final int rejected;
  final String batchId;
  final List<EventRejection> rejections;

  PartialAcceptError({
    required this.accepted,
    required this.rejected,
    required this.batchId,
    required this.rejections,
  }) : super(
          'batch $batchId partially accepted: $rejected rejected'
          '${rejections.isEmpty ? '' : ' (${rejections.first.eventId}: ${rejections.first.reason})'}',
          statusCode: 207,
        );

  factory PartialAcceptError.fromBody(String body, String fallbackBatchId) {
    Map<String, dynamic> data = const {};
    try {
      final decoded = jsonDecode(body);
      if (decoded is Map<String, dynamic>) data = decoded;
    } catch (_) {}
    final raw = data['rejections'];
    final rejections = raw is List
        ? raw
            .whereType<Map>()
            .map((r) => EventRejection('${r['event_id']}', '${r['reason']}'))
            .toList()
        : <EventRejection>[];
    return PartialAcceptError(
      accepted: (data['accepted'] as num?)?.toInt() ?? 0,
      rejected: (data['rejected'] as num?)?.toInt() ?? 0,
      batchId: (data['batch_id'] as String?) ?? fallbackBatchId,
      rejections: rejections,
    );
  }
}
