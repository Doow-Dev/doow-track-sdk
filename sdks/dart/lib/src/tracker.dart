import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:archive/archive.dart';
import 'types.dart';
import 'errors.dart';

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
  });
}

class Tracker {
  final String _apiKey;
  final TrackerOptions _options;
  final List<Map<String, dynamic>> _queue = [];
  Timer? _flushTimer;
  bool _shutdown = false;

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

    _queue.add(data);
    _log('Queued event: ${event.metric}');

    if (_queue.length >= _options.flushAt) {
      flush();
    }
  }

  Future<void> flush() async {
    if (_queue.isEmpty || _shutdown) return;

    final batch = List<Map<String, dynamic>>.from(_queue);
    _queue.clear();

    _log('Flushing ${batch.length} events');

    try {
      await _sendWithRetry(batch);
    } catch (e) {
      _options.onError?.call(DoowError(e.toString()));
      _log('Flush failed: $e');
    }
  }

  Future<void> _sendWithRetry(List<Map<String, dynamic>> batch) async {
    final payload = jsonEncode({'events': batch});
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

    for (var attempt = 0; attempt <= _options.retryCount; attempt++) {
      try {
        final response = await http
            .post(
              Uri.parse('${_options.endpoint}/telemetry/events'),
              headers: headers,
              body: body,
            )
            .timeout(_options.timeout);

        if (response.statusCode >= 200 && response.statusCode < 300) {
          _log('Batch sent successfully');
          return;
        }

        if (response.statusCode == 429) {
          final retryAfter = response.headers['retry-after'];
          final delay = retryAfter != null
              ? Duration(seconds: int.tryParse(retryAfter) ?? 1)
              : Duration(milliseconds: 100 * (1 << attempt));
          await Future.delayed(delay);
          continue;
        }

        if (response.statusCode >= 500) {
          await Future.delayed(Duration(milliseconds: 100 * (1 << attempt)));
          continue;
        }

        throw DoowError('HTTP ${response.statusCode}: ${response.body}',
            statusCode: response.statusCode);
      } on TimeoutException {
        if (attempt == _options.retryCount) rethrow;
        await Future.delayed(Duration(milliseconds: 100 * (1 << attempt)));
      }
    }
  }

  Future<void> shutdown() async {
    _shutdown = true;
    _flushTimer?.cancel();
    await flush();
  }

  void _log(String message) {
    if (_options.debug) {
      print('[DoowTrack] $message');
    }
  }
}
