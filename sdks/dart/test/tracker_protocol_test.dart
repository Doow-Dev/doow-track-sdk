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

  test('retries reuse the same batch id', () async {
    final ids = <String>[];
    var calls = 0;
    final client = MockClient((request) async {
      ids.add((jsonDecode(request.body) as Map)['batch_id'] as String);
      calls++;
      return http.Response('', calls == 1 ? 503 : 202);
    });
    final tracker = trackerFor(client, <DoowError>[]);

    tracker.track(sampleEvent());
    await tracker.shutdown();

    expect(ids.length, 2);
    expect(ids.toSet().length, 1);
  });
}
