import 'dart:async';

import 'package:doow_track/doow_track.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';

class SlowServer {
  final Completer<void> started = Completer<void>();
  int completed = 0;

  MockClient get client => MockClient((request) async {
        if (!started.isCompleted) started.complete();
        await Future<void>.delayed(const Duration(milliseconds: 400));
        completed++;
        return http.Response('{}', 202);
      });
}

Tracker eagerTracker(MockClient client, {void Function(DoowError)? onError}) => Tracker(
      'dk_test',
      TrackerOptions(
        flushInterval: const Duration(hours: 1),
        flushAt: 1,
        retryCount: 0,
        onError: onError,
        httpClient: client,
      ),
    );

TrackEvent event() => TrackEvent(metric: 'api_calls', quantity: 1, licenseId: 'lic_1');

void main() {
  timerCreatedInsideACallbackStillWaitsForOtherSends();

  test('flush waits for a count-triggered send already in flight', () async {
    final server = SlowServer();
    final tracker = eagerTracker(server.client);

    tracker.track(event());
    await server.started.future;
    await tracker.flush();

    expect(server.completed, 1);
    await tracker.shutdown();
  });

  test('shutdown waits for a count-triggered send already in flight', () async {
    final server = SlowServer();
    final tracker = eagerTracker(server.client);

    tracker.track(event());
    await server.started.future;
    await tracker.shutdown();

    expect(server.completed, 1);
  });

  test('a flush called from the error handler does not wait for its own send', () async {
    late Tracker tracker;
    final handlerFinished = Completer<void>();
    final client = MockClient((request) async => http.Response('{"message":"bad"}', 400));
    tracker = eagerTracker(client, onError: (_) {
      tracker.flush().whenComplete(() {
        if (!handlerFinished.isCompleted) handlerFinished.complete();
      });
    });

    tracker.track(event());

    await handlerFinished.future.timeout(const Duration(seconds: 5));
    await tracker.shutdown();
  });
}

void timerCreatedInsideACallbackStillWaitsForOtherSends() {
  test('a timer created inside the error handler still waits for other sends in flight', () async {
    late Tracker tracker;
    var calls = 0;
    var completed = 0;
    var completedWhenFlushReturned = -1;
    final flushReturned = Completer<void>();
    final client = MockClient((request) async {
      calls++;
      if (calls == 1) return http.Response('{"message":"bad"}', 400);
      await Future<void>.delayed(const Duration(milliseconds: 300));
      completed++;
      return http.Response('{}', 202);
    });
    tracker = eagerTracker(client, onError: (_) {
      Timer(const Duration(milliseconds: 50), () async {
        await tracker.flush();
        completedWhenFlushReturned = completed;
        flushReturned.complete();
      });
    });

    tracker.track(event());
    tracker.track(event());
    await flushReturned.future.timeout(const Duration(seconds: 5));

    expect(completedWhenFlushReturned, 1);
    await tracker.shutdown();
  });
}
