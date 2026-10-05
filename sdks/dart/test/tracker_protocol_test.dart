import 'dart:convert';

import 'package:doow_track/doow_track.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';

TrackEvent sampleEvent() => TrackEvent(
      metric: 'api_calls',
      quantity: 1,
      licenseId: 'lic_1',
      metricTupleHint: MetricTupleHint(
        appName: 'app',
        licenseName: 'lic',
        metricName: 'calls',
      ),
    );

Tracker trackerFor(MockClient client, List<DoowError> errors, {int retries = 2}) =>
    Tracker(
      'dk_test',
      TrackerOptions(
        flushInterval: const Duration(hours: 1),
        flushAt: 1000,
        retryCount: retries,
        onError: errors.add,
        httpClient: client,
      ),
    );

void main() {
  test('202 sends the batch envelope with an object tuple hint', () async {
    final bodies = <Map<String, dynamic>>[];
    final client = MockClient((request) async {
      bodies.add(jsonDecode(request.body) as Map<String, dynamic>);
      return http.Response('{"accepted":1,"rejected":0}', 202);
    });
    final errors = <DoowError>[];
    final tracker = trackerFor(client, errors);

    tracker.track(sampleEvent());
    await tracker.flush();
    await tracker.shutdown();

    final body = bodies.single;
    expect(body['batch_id'], isNotEmpty);
    expect(body['sdk_version'], isNotEmpty);
    final event = (body['events'] as List).single as Map<String, dynamic>;
    expect(event['event_id'], isNotEmpty);
    expect(event['occurred_at'], isNotEmpty);
    expect(event['license_id'], 'lic_1');
    expect(event['source_system'], 'sdk');
    final measurement = (event['measurements'] as List).single as Map<String, dynamic>;
    expect(measurement['metric_name'], 'api_calls');
    expect(measurement['metric_tuple_hint'],
        {'app_name': 'app', 'license_name': 'lic', 'metric_name': 'calls'});
    expect(errors, isEmpty);
  });

  test('207 reports every rejection and is not retried', () async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      return http.Response(
        jsonEncode({
          'accepted': 1,
          'rejected': 1,
          'batch_id': 'b',
          'rejections': [
            {'event_id': 'evt-x', 'reason': 'license_id is required'}
          ],
        }),
        207,
      );
    });
    final errors = <DoowError>[];
    final tracker = trackerFor(client, errors);

    tracker.track(sampleEvent());
    await tracker.flush();
    await tracker.shutdown();

    expect(calls, 1);
    final partial = errors.single as PartialAcceptError;
    expect(partial.rejections.single.eventId, 'evt-x');
    expect(partial.rejections.single.reason, 'license_id is required');
  });

  test('shutdown before the timer fires still posts queued events', () async {
    var posted = 0;
    final client = MockClient((request) async {
      posted += ((jsonDecode(request.body) as Map)['events'] as List).length;
      return http.Response('', 202);
    });
    final tracker = trackerFor(client, <DoowError>[]);

    tracker.track(sampleEvent());
    tracker.track(sampleEvent());
    await tracker.shutdown();

    expect(posted, 2);
  });

  Tracker backlogTracker(MockClient client, List<DoowError> errors) => Tracker(
        'dk_test',
        TrackerOptions(
          flushInterval: const Duration(hours: 1),
          flushAt: 5000,
          maxQueueSize: 5000,
          retryCount: 0,
          disableCompression: true,
          onError: errors.add,
          httpClient: client,
        ),
      );

  test('a flush of more than 500 events sends chunks of at most 500 with distinct batch ids', () async {
    final bodies = <Map<String, dynamic>>[];
    final client = MockClient((request) async {
      bodies.add(jsonDecode(request.body) as Map<String, dynamic>);
      return http.Response('', 202);
    });
    final errors = <DoowError>[];
    final tracker = backlogTracker(client, errors);

    for (var i = 0; i < 1200; i++) {
      tracker.track(sampleEvent());
    }
    await tracker.flush();
    await tracker.shutdown();

    expect(bodies.map((b) => (b['events'] as List).length).toList(), [500, 500, 200]);
    expect(bodies.map((b) => b['batch_id']).toSet().length, 3);
    final eventIds = bodies
        .expand((b) => (b['events'] as List).map((e) => (e as Map)['event_id']))
        .toSet();
    expect(eventIds.length, 1200);
    expect(errors, isEmpty);
  });

  test('a transient failure requeues that chunk and every later chunk and sends nothing more', () async {
    final bodies = <Map<String, dynamic>>[];
    var healthy = false;
    final client = MockClient((request) async {
      bodies.add(jsonDecode(request.body) as Map<String, dynamic>);
      if (healthy || bodies.length == 1) return http.Response('', 202);
      return http.Response('down', 503);
    });
    final errors = <DoowError>[];
    final tracker = backlogTracker(client, errors);

    for (var i = 0; i < 1200; i++) {
      tracker.track(sampleEvent());
    }
    await tracker.flush();

    expect(bodies.length, 2);
    expect(errors.length, 1);
    final failedChunk = (bodies[1]['events'] as List)
        .map((e) => (e as Map)['event_id'])
        .toList();

    healthy = true;
    bodies.clear();
    await tracker.flush();

    final resent = bodies
        .expand((b) => (b['events'] as List).map((e) => (e as Map)['event_id']))
        .toList();
    expect(resent.length, 700);
    expect(resent.take(500).toList(), failedChunk);
  });

  test('an event that cannot be serialized is reported and dropped instead of being requeued forever', () async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      return http.Response('', 202);
    });
    final errors = <DoowError>[];
    final tracker = backlogTracker(client, errors);

    tracker.track(TrackEvent(
      metric: 'api_calls',
      quantity: 1,
      licenseId: 'lic_1',
      metadata: {'at': Object()},
    ));
    await tracker.flush();
    await tracker.flush();

    expect(errors.length, 1);
    expect(calls, 0);
  });

  test('a transient failure holds count-triggered flushes until the next interval', () async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      return http.Response('down', 503);
    });
    final tracker = Tracker(
      'dk_test',
      TrackerOptions(
        flushInterval: const Duration(hours: 1),
        flushAt: 2,
        retryCount: 0,
        disableCompression: true,
        httpClient: client,
      ),
    );

    tracker.track(sampleEvent());
    tracker.track(sampleEvent());
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(calls, 1);

    tracker.track(sampleEvent());
    tracker.track(sampleEvent());
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(calls, 1);
  });

  test('later chunks are still sent after a chunk fails permanently', () async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      return calls == 1 ? http.Response('bad', 400) : http.Response('', 202);
    });
    final errors = <DoowError>[];
    final tracker = backlogTracker(client, errors);

    for (var i = 0; i < 700; i++) {
      tracker.track(sampleEvent());
    }
    await tracker.flush();
    await tracker.shutdown();

    expect(calls, 2);
    expect(errors.length, 1);
  });

  test('retries reuse the same batch id', () async {
    final ids = <String>[];
    final eventIds = <String>[];
    var calls = 0;
    final client = MockClient((request) async {
      final decoded = jsonDecode(request.body) as Map;
      ids.add(decoded['batch_id'] as String);
      eventIds.add(((decoded['events'] as List).first as Map)['event_id'] as String);
      calls++;
      return http.Response('', calls == 1 ? 503 : 202);
    });
    final tracker = trackerFor(client, <DoowError>[]);

    tracker.track(sampleEvent());
    await tracker.shutdown();

    expect(ids.length, 2);
    expect(ids.toSet().length, 1);
    expect(eventIds.length, 2);
    expect(eventIds.toSet().length, 1);
  });

  test('permanent client errors are reported once and not retried', () async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      return http.Response('bad', 400);
    });
    final errors = <DoowError>[];
    final tracker = trackerFor(client, errors, retries: 3);

    tracker.track(sampleEvent());
    await tracker.shutdown();

    expect(calls, 1);
    expect(errors.single.statusCode, 400);
  });

  test('a 429 with Retry-After waits at least that long and retries the same batch', () async {
    final ids = <String>[];
    var calls = 0;
    final client = MockClient((request) async {
      ids.add((jsonDecode(request.body) as Map)['batch_id'] as String);
      calls++;
      return calls == 1
          ? http.Response('', 429, headers: {'retry-after': '1'})
          : http.Response('', 202);
    });
    final errors = <DoowError>[];
    final tracker = trackerFor(client, errors, retries: 1);

    tracker.track(sampleEvent());
    final started = DateTime.now();
    await tracker.flush();
    final elapsed = DateTime.now().difference(started);
    await tracker.shutdown();

    expect(ids.length, 2);
    expect(ids.toSet().length, 1);
    expect(elapsed, greaterThanOrEqualTo(const Duration(milliseconds: 900)));
    expect(errors, isEmpty);
  });

  test('a 503 in-flight response with Retry-After waits at least that long and retries the same batch', () async {
    final ids = <String>[];
    var calls = 0;
    final client = MockClient((request) async {
      ids.add((jsonDecode(request.body) as Map)['batch_id'] as String);
      calls++;
      return calls == 1
          ? http.Response('', 503, headers: {'retry-after': '1'})
          : http.Response('', 202);
    });
    final errors = <DoowError>[];
    final tracker = trackerFor(client, errors, retries: 1);

    tracker.track(sampleEvent());
    final started = DateTime.now();
    await tracker.flush();
    final elapsed = DateTime.now().difference(started);
    await tracker.shutdown();

    expect(ids.length, 2);
    expect(ids.toSet().length, 1);
    expect(elapsed, greaterThanOrEqualTo(const Duration(milliseconds: 900)));
    expect(errors, isEmpty);
  });

  test('Retry-After is clamped and tolerates garbage', () {
    expect(parseRetryAfter('2'), const Duration(seconds: 2));
    expect(parseRetryAfter('86400'), const Duration(seconds: 30));
    expect(parseRetryAfter('garbage'), isNull);
    expect(parseRetryAfter(null), isNull);
  });

  test('a throwing onError handler never causes a resend of a recorded 207 batch', () async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      return http.Response(
        jsonEncode({'accepted': 0, 'rejected': 1, 'batch_id': 'b', 'rejections': [
          {'event_id': 'e1', 'reason': 'bad'}
        ]}),
        207,
      );
    });
    final tracker = Tracker(
      'dk_test',
      TrackerOptions(
        flushInterval: const Duration(hours: 1),
        retryCount: 3,
        onError: (_) => throw StateError('handler failure'),
        httpClient: client,
      ),
    );

    tracker.track(sampleEvent());
    await tracker.shutdown();

    expect(calls, 1);
  });

  test('a malformed 207 body is reported and not resent', () async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      return http.Response(
          jsonEncode({'accepted': 'abc', 'rejected': null, 'rejections': [1, 'x', {'event_id': 5}]}), 207);
    });
    final errors = <DoowError>[];
    final tracker = trackerFor(client, errors, retries: 3);

    tracker.track(sampleEvent());
    await tracker.shutdown();

    expect(calls, 1);
    expect(errors.single, isA<PartialAcceptError>());
  });

  test('server text is sanitized and truncated', () {
    final cleaned = sanitizeText('line1\nline2\x1b[31m\x9b31m${'x' * 2000}');
    expect(cleaned.contains('\n'), isFalse);
    expect(cleaned.contains('\x1b'), isFalse);
    expect(cleaned.contains('\x9b'), isFalse);
    expect(cleaned.length, lessThanOrEqualTo(520));
  });
}
