"""Wire protocol tests: batch envelope, tuple hints, and 207 partial acceptance."""

import json

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
    await tracker.flush()
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
