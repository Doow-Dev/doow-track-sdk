import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:http/http.dart' as http;
import 'package:archive/archive.dart';
import 'types.dart';
import 'errors.dart';

const _maxBatchEvents = 500;

class TrackerOptions {
  final String endpoint;
  final bool enabled;
  final bool debug;
  final int flushAt;
  final Duration flushInterval;
  final int maxQueueSize;
  final Duration timeout;
  final int retryCount;
  final bool disableCompression;
  final Map<String, dynamic>? attribution;
  final void Function(DoowError)? onError;
  final http.Client? httpClient;

  const TrackerOptions({
    this.endpoint = 'https://api.doow.co',
    this.enabled = true,
    this.debug = false,
    this.flushAt = 20,
    this.flushInterval = const Duration(seconds: 10),
    this.maxQueueSize = 10000,
    this.timeout = const Duration(seconds: 10),
    this.retryCount = 3,
    this.disableCompression = false,
    this.attribution,
    this.onError,
    this.httpClient,
  });
}

const _sdkVersion = '0.1.0';
const _maxRetryAfter = Duration(seconds: 30);

Duration? parseRetryAfter(String? header) {
  if (header == null || header.isEmpty) return null;
  final seconds = num.tryParse(header);
  Duration? delay;
  if (seconds != null) {
    delay = Duration(milliseconds: (seconds * 1000).round());
  } else {
    try {
      delay = HttpDate.parse(header).difference(DateTime.now());
    } catch (_) {
      return null;
    }
  }
  if (delay.isNegative) return Duration.zero;
  return delay > _maxRetryAfter ? _maxRetryAfter : delay;
}

String _uuidV4() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-'
      '${hex.substring(16, 20)}-${hex.substring(20)}';
}

Map<String, dynamic> toWireEvent(Map<String, dynamic> data) {
  final hint = data['metric_tuple_hint'];
  return {
    'event_id': data['event_id'] ?? _uuidV4(),
    'license_id': data['license_id'],
    'occurred_at': data['timestamp'],
    'source_system': (data['source_system'] as String?)?.trim().isNotEmpty == true
        ? data['source_system']
        : 'sdk',
    'kind': data['kind'],
    if (data['unit'] != null) 'unit': data['unit'],
    if (data['attribution'] != null) 'attribution': data['attribution'],
    if (data['metadata'] != null) 'metadata': data['metadata'],
    'measurements': [
      {
        'metric_name': data['metric'],
        'quantity': data['quantity'],
        if (hint != null) 'metric_tuple_hint': hint,
      },
    ],
  };
}

class Tracker {
  final String _apiKey;
  final TrackerOptions _options;
  final List<Map<String, dynamic>> _queue = [];
  Timer? _flushTimer;
  bool _shutdown = false;
  DateTime _holdUntil = DateTime.fromMillisecondsSinceEpoch(0);

  Tracker(String apiKey, [TrackerOptions? options])
      : _apiKey = _resolveApiKey(apiKey),
        _options = _resolveOptions(options ?? const TrackerOptions()) {
    if (!_apiKey.startsWith('dk_')) {
      throw ValidationError('API key must start with dk_');
    }
    _startFlushTimer();
  }

  static String _resolveApiKey(String apiKey) {
    return Platform.environment['DOOW_TRACK_API_KEY'] ?? apiKey;
  }

  static TrackerOptions _resolveOptions(TrackerOptions options) {
    final env = Platform.environment;
    return TrackerOptions(
      endpoint: env['DOOW_TRACK_ENDPOINT'] ?? options.endpoint,
      enabled: env['DOOW_TRACK_DISABLED'] != 'true' && options.enabled,
      debug: env['DOOW_TRACK_DEBUG'] == 'true' || options.debug,
      flushAt: options.flushAt,
      flushInterval: options.flushInterval,
      maxQueueSize: options.maxQueueSize,
      timeout: options.timeout,
      retryCount: options.retryCount,
      disableCompression: options.disableCompression,
      attribution: options.attribution,
      onError: options.onError,
      httpClient: options.httpClient,
    );
  }

  void _startFlushTimer() {
    _flushTimer?.cancel();
    _flushTimer = Timer.periodic(_options.flushInterval, (_) => flush());
  }

  void track(TrackEvent event) {
    if (!_options.enabled || _shutdown) return;

    if (_queue.length >= _options.maxQueueSize) {
      _log('Queue full, dropping event');
      return;
    }

    final data = event.toJson();
    if (_options.attribution != null) {
      final merged = {...?data['attribution'], ..._options.attribution!};
      data['attribution'] = merged;
    }

    _queue.add(toWireEvent({...data, 'event_id': _uuidV4()}));
    _log('Queued event: ${event.metric}');

    if (_queue.length >= _options.flushAt &&
        !DateTime.now().isBefore(_holdUntil)) {
      flush();
    }
  }

  Future<void> flush() async {
    if (_queue.isEmpty) return;

    final batch = List<Map<String, dynamic>>.from(_queue);
    _queue.clear();

    _log('Flushing ${batch.length} events');

    for (var start = 0; start < batch.length; start += _maxBatchEvents) {
      try {
        await _sendWithRetry(
            batch.sublist(start, min(start + _maxBatchEvents, batch.length)));
      } catch (e) {
        _notify(e is DoowError ? e : DoowError(sanitizeText(e)));
        _log('Flush failed: $e');
        if (_isTransient(e)) {
          _requeue(batch.sublist(start));
          _holdUntil = DateTime.now().add(_options.flushInterval);
          return;
        }
      }
    }
  }

  bool _isTransient(Object error) {
    if (error is! DoowError) return true;
    final status = error.statusCode ?? 0;
    return status == 429 || status >= 500;
  }

  void _requeue(List<Map<String, dynamic>> events) {
    if (_shutdown) return;
    _queue.insertAll(0, events);
    if (_queue.length > _options.maxQueueSize) {
      _queue.removeRange(_options.maxQueueSize, _queue.length);
    }
  }

  Future<void> _sendWithRetry(List<Map<String, dynamic>> batch) async {
    final batchId = _uuidV4();
    final String payload;
    try {
      payload = jsonEncode({
        'batch_id': batchId,
        'sdk_version': _sdkVersion,
        'events': batch,
      });
    } catch (e) {
      throw ValidationError('Could not serialize events: ${sanitizeText(e)}');
    }
    final bytes = utf8.encode(payload);

    List<int> body;
    Map<String, String> headers = {
      'Authorization': 'Bearer $_apiKey',
      'Content-Type': 'application/json',
    };

    if (!_options.disableCompression && bytes.length > 1024) {
      body = GZipEncoder().encode(bytes)!;
      headers['Content-Encoding'] = 'gzip';
    } else {
      body = bytes;
    }

    final client = _options.httpClient;
    final uri = Uri.parse('${_options.endpoint}/telemetry/events');

    for (var attempt = 0; attempt <= _options.retryCount; attempt++) {
      final isLastAttempt = attempt == _options.retryCount;
      try {
        final response = await (client != null
                ? client.post(uri, headers: headers, body: body)
                : http.post(uri, headers: headers, body: body))
            .timeout(_options.timeout);

        if (response.statusCode == 207) {
          _notify(PartialAcceptError.fromBody(response.body, batchId));
          return;
        }

        if (response.statusCode >= 200 && response.statusCode < 300) {
          _log('Batch sent successfully');
          return;
        }

        if (response.statusCode == 429 || response.statusCode >= 500) {
          if (isLastAttempt) {
            throw DoowError('HTTP ${response.statusCode} after ${attempt + 1} attempts',
                statusCode: response.statusCode);
          }
          final retryAfter =
              (response.statusCode == 429 || response.statusCode == 503)
                  ? response.headers['retry-after']
                  : null;
          final delay = parseRetryAfter(retryAfter) ??
              Duration(milliseconds: 100 * (1 << attempt));
          await Future.delayed(delay);
          continue;
        }

        throw DoowError('HTTP ${response.statusCode}: ${sanitizeText(response.body)}',
            statusCode: response.statusCode);
      } on DoowError {
        rethrow;
      } catch (_) {
        if (isLastAttempt) rethrow;
        await Future.delayed(Duration(milliseconds: 100 * (1 << attempt)));
      }
    }
  }

  Future<void> shutdown() async {
    _flushTimer?.cancel();
    await flush();
    _shutdown = true;
  }

  void _notify(DoowError error) {
    try {
      _options.onError?.call(error);
    } catch (_) {}
  }

  void _log(String message) {
    if (_options.debug) {
      print('[DoowTrack] $message');
    }
  }
}
