"""Wire protocol tests: batch envelope, tuple hints, and 207 partial acceptance."""

import json
import time

import httpx
import pytest

from doow_track import (
    AsyncTracker,
    PartialAcceptError,
    TrackEvent,
    Tracker,
    TrackerOptions,
)
from doow_track.types import MetricTupleHint

PARTIAL_BODY = {
    "accepted": 1,
    "rejected": 1,
    "batch_id": "b-1",
    "rejections": [{"event_id": "evt-x", "reason": "license_id is required"}],
}


def _event() -> TrackEvent:
    return TrackEvent(
        metric="api_calls",
        quantity=1,
        license_id="lic_1",
        metric_tuple_hint=MetricTupleHint(
            app_name="app", license_name="lic", metric_name="calls"
        ),
    )


def _options(errors: list, **overrides) -> TrackerOptions:
    settings = {"retry_count": 2, **overrides}
    return TrackerOptions(
        endpoint="https://test.doow.co",
        flush_at=1000,
        flush_interval=1000.0,
        on_error=errors.append,
        **settings,
    )


def test_202_batch_has_envelope_and_object_tuple_hint(httpx_mock):
    httpx_mock.add_response(status_code=202, json={"accepted": 1, "rejected": 0})
    errors: list = []
    tracker = Tracker("dk_test", _options(errors))
    tracker.track(_event())
    tracker.flush()
    tracker._shutdown.set()

    request = httpx_mock.get_requests()[0]
    body = json.loads(request.content)
    assert body["batch_id"] and body["sdk_version"]
    event = body["events"][0]
    assert event["event_id"] and event["occurred_at"]
    assert event["license_id"] == "lic_1" and event["source_system"] == "sdk"
    assert event["measurements"][0]["metric_tuple_hint"] == {
        "app_name": "app",
        "license_name": "lic",
        "metric_name": "calls",
    }
    assert errors == []


def test_207_reports_rejections_and_is_not_retried(httpx_mock):
    httpx_mock.add_response(status_code=207, json=PARTIAL_BODY)
    errors: list = []
    tracker = Tracker("dk_test", _options(errors))
    tracker.track(_event())
    tracker.flush()
    tracker._shutdown.set()

    assert len(httpx_mock.get_requests()) == 1
    assert len(errors) == 1 and isinstance(errors[0], PartialAcceptError)
    assert errors[0].rejected == 1
    assert errors[0].rejections == PARTIAL_BODY["rejections"]


@pytest.mark.asyncio
async def test_async_207_reports_rejections_and_is_not_retried(httpx_mock):
    httpx_mock.add_response(status_code=207, json=PARTIAL_BODY)
    errors: list = []
    tracker = AsyncTracker("dk_test", _options(errors))
    await tracker.track(_event())
    await tracker.flush()
    await tracker.shutdown()

    assert len(httpx_mock.get_requests()) == 1
    assert len(errors) == 1 and isinstance(errors[0], PartialAcceptError)


@pytest.mark.asyncio
async def test_async_server_failure_reaches_on_error(httpx_mock):
    httpx_mock.add_response(status_code=500, json={"message": "boom"}, is_reusable=True)
    errors: list = []
    tracker = AsyncTracker("dk_test", _options(errors, retry_count=1))
    await tracker.track(_event())
    await tracker.shutdown()

    assert len(errors) == 1


def test_retry_reuses_batch_and_event_ids(httpx_mock):
    httpx_mock.add_response(status_code=503)
    httpx_mock.add_response(status_code=202, json={"accepted": 1, "rejected": 0})
    errors: list = []
    tracker = Tracker("dk_test", _options(errors, retry_count=1))
    tracker.track(_event())
    tracker.flush()
    tracker._shutdown.set()

    first, second = (json.loads(r.content) for r in httpx_mock.get_requests())
    assert first["batch_id"] == second["batch_id"]
    assert first["events"][0]["event_id"] == second["events"][0]["event_id"]
    assert errors == []


def test_permanent_client_error_is_reported_without_retry(httpx_mock):
    httpx_mock.add_response(status_code=400, json={"message": "bad"})
    errors: list = []
    tracker = Tracker("dk_test", _options(errors, retry_count=3))
    tracker.track(_event())
    tracker.flush()
    tracker._shutdown.set()

    assert len(httpx_mock.get_requests()) == 1
    assert len(errors) == 1


def _backlog_options(errors: list, **overrides) -> TrackerOptions:
    return TrackerOptions(
        endpoint="https://test.doow.co",
        flush_at=5000,
        flush_interval=1000.0,
        on_error=errors.append,
        retry_count=0,
        **overrides,
    )


def _chunk_summary(httpx_mock):
    bodies = [json.loads(r.content) for r in httpx_mock.get_requests()]
    sizes = [len(b["events"]) for b in bodies]
    batch_ids = {b["batch_id"] for b in bodies}
    event_ids = [e["event_id"] for b in bodies for e in b["events"]]
    return sizes, batch_ids, event_ids


def test_flush_of_more_than_500_events_sends_chunks_of_at_most_500(httpx_mock):
    httpx_mock.add_response(status_code=202, json={"accepted": 500, "rejected": 0}, is_reusable=True)
    errors: list = []
    tracker = Tracker("dk_test", _backlog_options(errors, disable_compression=True))
    for _ in range(1200):
        tracker.track(_event())
    tracker.flush()
    tracker._shutdown.set()

    sizes, batch_ids, event_ids = _chunk_summary(httpx_mock)
    assert sizes == [500, 500, 200]
    assert len(batch_ids) == 3
    assert len(set(event_ids)) == 1200
    assert errors == []


@pytest.mark.asyncio
async def test_async_flush_of_more_than_500_events_sends_chunks_of_at_most_500(httpx_mock):
    httpx_mock.add_response(status_code=202, json={"accepted": 500, "rejected": 0}, is_reusable=True)
    errors: list = []
    tracker = AsyncTracker("dk_test", _backlog_options(errors, disable_compression=True))
    for _ in range(1200):
        await tracker.track(_event())
    await tracker.flush()
    await tracker.shutdown()

    sizes, batch_ids, event_ids = _chunk_summary(httpx_mock)
    assert sizes == [500, 500, 200]
    assert len(batch_ids) == 3
    assert len(set(event_ids)) == 1200
    assert errors == []


def test_transient_failure_requeues_that_chunk_and_every_later_chunk(httpx_mock):
    httpx_mock.add_response(status_code=202, json={"accepted": 500, "rejected": 0})
    httpx_mock.add_response(status_code=503)
    errors: list = []
    tracker = Tracker("dk_test", _backlog_options(errors, disable_compression=True))
    for _ in range(1200):
        tracker.track(_event())
    tracker.flush()
    tracker._shutdown.set()

    requests = httpx_mock.get_requests()
    assert len(requests) == 2
    assert len(errors) == 1
    failed_chunk = [e["event_id"] for e in json.loads(requests[1].content)["events"]]
    assert len(tracker._buffer) == 700
    assert [e.event_id for e in tracker._buffer[:500]] == failed_chunk
    assert tracker._hold_until > time.monotonic()


def test_shutdown_stores_every_chunk_when_an_offline_store_is_set(httpx_mock):
    class Store:
        def __init__(self):
            self.pushed: list = []

        def push(self, item):
            self.pushed.append(item)

        def shift(self):
            return None

    store = Store()
    httpx_mock.add_response(status_code=503, is_reusable=True)
    errors: list = []
    tracker = Tracker(
        "dk_test",
        _backlog_options(errors, disable_compression=True, offline_store=store),
    )
    for _ in range(1200):
        tracker.track(_event())
    tracker._shutdown.set()
    tracker.flush()

    assert len(store.pushed) == 3
    assert tracker._buffer == []


def test_a_chunk_saved_to_the_offline_store_is_not_requeued_again(httpx_mock):
    class Store:
        def __init__(self):
            self.pushed: list = []

        def push(self, item):
            self.pushed.append(item)

        def shift(self):
            return None

    store = Store()
    httpx_mock.add_response(status_code=503)
    errors: list = []
    tracker = Tracker(
        "dk_test",
        _backlog_options(errors, disable_compression=True, offline_store=store),
    )
    for _ in range(1200):
        tracker.track(_event())
    tracker.flush()
    tracker._shutdown.set()

    assert len(httpx_mock.get_requests()) == 1
    assert len(store.pushed) == 1
    assert len(tracker._buffer) == 700


def test_a_transient_failure_holds_count_triggered_flushes(httpx_mock):
    import time

    errors: list = []
    options = _backlog_options(errors, disable_compression=True)
    options.flush_at = 2
    tracker = Tracker("dk_test", options)
    tracker._hold_until = time.monotonic() + 100
    tracker.track(_event())
    tracker.track(_event())
    time.sleep(0.1)
    tracker._shutdown.set()

    assert httpx_mock.get_requests() == []
    assert len(tracker._buffer) == 2


@pytest.mark.asyncio
async def test_async_transient_failure_requeues_that_chunk_and_every_later_chunk(httpx_mock):
    httpx_mock.add_response(status_code=202, json={"accepted": 500, "rejected": 0})
    httpx_mock.add_response(status_code=503)
    errors: list = []
    tracker = AsyncTracker("dk_test", _backlog_options(errors, disable_compression=True))
    for _ in range(1200):
        await tracker.track(_event())
    await tracker.flush()

    requests = httpx_mock.get_requests()
    assert len(requests) == 2
    assert len(errors) == 1
    failed_chunk = [e["event_id"] for e in json.loads(requests[1].content)["events"]]
    assert len(tracker._buffer) == 700
    assert [e.event_id for e in tracker._buffer[:500]] == failed_chunk
    tracker._buffer.clear()
    await tracker.shutdown()


@pytest.mark.asyncio
async def test_async_permanent_client_error_is_not_retried(httpx_mock):
    httpx_mock.add_response(status_code=422, json={"message": "bad"})
    errors: list = []
    tracker = AsyncTracker("dk_test", _options(errors, retry_count=3))
    await tracker.track(_event())
    await tracker.flush()
    await tracker.shutdown()

    assert len(httpx_mock.get_requests()) == 1
    assert len(errors) == 1


def test_retry_after_is_clamped_and_tolerates_garbage():
    from doow_track.tracker import MAX_RETRY_AFTER, _retry_after

    assert _retry_after("2") == 2.0
    assert _retry_after("86400") == MAX_RETRY_AFTER
    assert _retry_after("garbage") == 0.0
    assert _retry_after(None) == 0.0


class _MemoryStore:
    def __init__(self, batches):
        self.batches = list(batches)

    def push(self, batch):
        self.batches.append(batch)

    def shift(self):
        return self.batches.pop(0) if self.batches else None

    def length(self):
        return len(self.batches)


def _stored_batch():
    payload = {"batch_id": "stored-1", "sdk_version": "0.1.0", "events": []}
    return {"batch_id": "stored-1", "payload": json.dumps(payload), "timestamp": "2026-10-04T00:00:00Z"}


def test_offline_drain_does_not_requeue_a_207_batch(httpx_mock):
    httpx_mock.add_response(status_code=207, json=PARTIAL_BODY)
    errors: list = []
    store = _MemoryStore([_stored_batch()])
    tracker = Tracker("dk_test", _options(errors))
    tracker._options.offline_store = store
    tracker._drain_offline_store()
    tracker._shutdown.set()

    assert store.batches == []
    assert len(errors) == 1 and isinstance(errors[0], PartialAcceptError)


def test_offline_drain_keeps_a_batch_on_transient_failure(httpx_mock):
    httpx_mock.add_response(status_code=503)
    errors: list = []
    store = _MemoryStore([_stored_batch()])
    tracker = Tracker("dk_test", _options(errors))
    tracker._options.offline_store = store
    tracker._drain_offline_store()
    tracker._shutdown.set()

    assert len(store.batches) == 1


def test_malformed_207_body_is_reported_and_not_resent(httpx_mock):
    httpx_mock.add_response(
        status_code=207,
        json={"accepted": "abc", "rejected": None, "rejections": [1, {"event_id": 5}, "x"]},
    )
    errors: list = []
    tracker = Tracker("dk_test", _options(errors))
    tracker.track(_event())
    tracker.flush()
    tracker._shutdown.set()

    assert len(httpx_mock.get_requests()) == 1
    assert isinstance(errors[0], PartialAcceptError)
    assert errors[0].rejected == 0


def test_throwing_on_error_handler_does_not_cause_a_resend(httpx_mock):
    httpx_mock.add_response(status_code=207, json=PARTIAL_BODY)

    def explode(_error):
        raise RuntimeError("handler failure")

    tracker = Tracker("dk_test", TrackerOptions(
        endpoint="https://test.doow.co", flush_at=1000, flush_interval=1000.0,
        retry_count=2, on_error=explode,
    ))
    tracker.track(_event())
    tracker.flush()
    tracker._shutdown.set()

    assert len(httpx_mock.get_requests()) == 1


def test_transport_errors_are_wrapped_so_the_request_is_not_exposed(httpx_mock):
    httpx_mock.add_exception(httpx.ConnectError("boom"), is_reusable=True)
    errors: list = []
    tracker = Tracker("dk_test", _options(errors, retry_count=1))
    tracker.track(_event())
    tracker.flush()
    tracker._shutdown.set()

    assert len(errors) == 1
    assert not hasattr(errors[0], "request")
    assert "Authorization" not in str(errors[0]) and "dk_test" not in str(errors[0])


def test_large_body_is_a_real_gzip_stream(httpx_mock):
    import gzip as gzip_module

    httpx_mock.add_response(status_code=202)
    errors: list = []
    tracker = Tracker("dk_test", _options(errors))
    for _ in range(300):
        tracker.track(_event())
    tracker.flush()
    tracker._shutdown.set()

    request = httpx_mock.get_requests()[0]
    assert request.headers["Content-Encoding"] == "gzip"
    assert len(json.loads(gzip_module.decompress(request.content))["events"]) == 300


def test_server_text_is_sanitized_and_truncated():
    from doow_track.errors import APIError

    error = APIError(status=500, message="line1\nline2\x1b[31m\x9b31m" + "x" * 2000)
    assert "\n" not in error.message and "\x1b" not in error.message and "\x9b" not in error.message
    assert len(error.message) <= 520


def test_rate_limited_batch_waits_for_retry_after_and_retries_the_same_batch(httpx_mock):
    import time

    httpx_mock.add_response(status_code=429, headers={"Retry-After": "1"})
    httpx_mock.add_response(status_code=202, json={"accepted": 1, "rejected": 0})
    errors: list = []
    tracker = Tracker("dk_test", _options(errors, retry_count=1))
    tracker.track(_event())
    started = time.monotonic()
    tracker.flush()
    elapsed = time.monotonic() - started
    tracker._shutdown.set()

    first, second = (json.loads(r.content) for r in httpx_mock.get_requests())
    assert elapsed >= 0.9
    assert first["batch_id"] == second["batch_id"]
    assert errors == []


def test_in_flight_unavailable_batch_waits_for_retry_after_and_retries_the_same_batch(httpx_mock):
    import time

    httpx_mock.add_response(status_code=503, headers={"Retry-After": "1"})
    httpx_mock.add_response(status_code=202, json={"accepted": 1, "rejected": 0})
    errors: list = []
    tracker = Tracker("dk_test", _options(errors, retry_count=1))
    tracker.track(_event())
    started = time.monotonic()
    tracker.flush()
    elapsed = time.monotonic() - started
    tracker._shutdown.set()

    first, second = (json.loads(r.content) for r in httpx_mock.get_requests())
    assert elapsed >= 0.9
    assert first["batch_id"] == second["batch_id"]
    assert errors == []


@pytest.mark.asyncio
async def test_async_rate_limited_batch_waits_for_retry_after(httpx_mock):
    import time

    httpx_mock.add_response(status_code=429, headers={"Retry-After": "1"})
    httpx_mock.add_response(status_code=202, json={"accepted": 1, "rejected": 0})
    errors: list = []
    tracker = AsyncTracker("dk_test", _options(errors, retry_count=1))
    await tracker.track(_event())
    started = time.monotonic()
    await tracker.flush()
    elapsed = time.monotonic() - started
    await tracker.shutdown()

    requests = httpx_mock.get_requests()
    assert len(requests) == 2
    assert elapsed >= 0.9
    assert json.loads(requests[0].content)["batch_id"] == json.loads(requests[1].content)["batch_id"]
    assert errors == []



@pytest.mark.asyncio
async def test_async_in_flight_unavailable_batch_waits_for_retry_after(httpx_mock):
    import time

    httpx_mock.add_response(status_code=503, headers={"Retry-After": "1"})
    httpx_mock.add_response(status_code=202, json={"accepted": 1, "rejected": 0})
    errors: list = []
    tracker = AsyncTracker("dk_test", _options(errors, retry_count=1))
    await tracker.track(_event())
    started = time.monotonic()
    await tracker.flush()
    elapsed = time.monotonic() - started
    await tracker.shutdown()

    requests = httpx_mock.get_requests()
    assert len(requests) == 2
    assert elapsed >= 0.9
    assert json.loads(requests[0].content)["batch_id"] == json.loads(requests[1].content)["batch_id"]
    assert errors == []
