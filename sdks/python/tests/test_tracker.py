"""Tests for Tracker."""

import json
import time
from unittest.mock import MagicMock, patch

import pytest

from doow_track import Tracker, TrackerOptions, TrackEvent, SerializedEvent


def test_tracker_track_queues_events():
    """Test tracking events adds them to buffer."""
    tracker = Tracker("dk_test_key", TrackerOptions(
        endpoint="https://test.doow.co",
        flush_at=100,  # High so we don't auto-flush
        flush_interval=1000.0,
        enabled=True,
    ))

    tracker.track(TrackEvent(metric="api_calls", quantity=1, license_id="lic_123"))
    tracker.track(TrackEvent(metric="api_calls", quantity=2, license_id="lic_123"))

    assert len(tracker._buffer) == 2
    assert tracker._buffer[0].metric == "api_calls"
    assert tracker._buffer[0].quantity == 1
    assert tracker._buffer[1].quantity == 2

    tracker._shutdown.set()


def test_tracker_before_send_drops_events():
    """Test before_send hook can drop events."""
    def before_send(event: SerializedEvent):
        if event.quantity == 0:
            return None
        return event

    tracker = Tracker("dk_test_key", TrackerOptions(
        endpoint="https://test.doow.co",
        flush_at=100,
        flush_interval=1000.0,
        before_send=before_send,
    ))

    tracker.track(TrackEvent(metric="test", quantity=0, license_id="lic_1"))
    tracker.track(TrackEvent(metric="test", quantity=5, license_id="lic_1"))

    assert len(tracker._buffer) == 1
    assert tracker._buffer[0].quantity == 5

    tracker._shutdown.set()


def test_tracker_before_send_modifies_events():
    """Test before_send hook can modify events."""
    def before_send(event: SerializedEvent):
        event.quantity *= 2
        return event

    tracker = Tracker("dk_test_key", TrackerOptions(
        endpoint="https://test.doow.co",
        flush_at=100,
        flush_interval=1000.0,
        before_send=before_send,
    ))

    tracker.track(TrackEvent(metric="test", quantity=5, license_id="lic_1"))

    assert len(tracker._buffer) == 1
    assert tracker._buffer[0].quantity == 10

    tracker._shutdown.set()


def test_tracker_attribution_merged():
    """Test SDK-level attribution is merged with event attribution."""
    tracker = Tracker("dk_test_key", TrackerOptions(
        endpoint="https://test.doow.co",
        flush_at=100,
        flush_interval=1000.0,
        attribution={"service": "test-service", "version": "1.0.0"},
    ))

    tracker.track(TrackEvent(
        metric="test",
        quantity=1,
        license_id="lic_1",
        attribution={"custom": "value"},
    ))

    assert len(tracker._buffer) == 1
    attr = tracker._buffer[0].attribution
    assert attr["service"] == "test-service"
    assert attr["version"] == "1.0.0"
    assert attr["custom"] == "value"

    tracker._shutdown.set()


def test_tracker_disabled_no_events():
    """Test disabled tracker doesn't queue events."""
    tracker = Tracker("dk_test_key", TrackerOptions(
        endpoint="https://test.doow.co",
        enabled=False,
        flush_at=1,
    ))

    tracker.track(TrackEvent(metric="test", quantity=1, license_id="lic_1"))

    assert len(tracker._buffer) == 0

    tracker._shutdown.set()


def test_tracker_context_manager():
    """Test tracker as context manager."""
    with Tracker("dk_test_key", TrackerOptions(
        endpoint="https://test.doow.co",
        flush_at=100,
        flush_interval=1000.0,
    )) as tracker:
        tracker.track(TrackEvent(metric="test", quantity=1, license_id="lic_1"))
        assert len(tracker._buffer) == 1


def test_tracker_event_serialization():
    """Test events are properly serialized."""
    tracker = Tracker("dk_test_key", TrackerOptions(
        endpoint="https://test.doow.co",
        flush_at=100,
        flush_interval=1000.0,
    ))

    tracker.track(TrackEvent(
        metric="api_calls",
        quantity=42,
        license_id="lic_123",
        unit="requests",
        metadata={"key": "value"},
    ))

    event = tracker._buffer[0]
    assert event.event_id is not None
    assert len(event.event_id) == 36  # UUID format
    assert event.timestamp is not None
    assert event.metric == "api_calls"
    assert event.quantity == 42
    assert event.license_id == "lic_123"
    assert event.unit == "requests"
    assert event.metadata == {"key": "value"}

    tracker._shutdown.set()


def test_tracker_queue_overflow():
    """Test queue drops oldest event when full."""
    tracker = Tracker("dk_test_key", TrackerOptions(
        endpoint="https://test.doow.co",
        flush_at=100,
        flush_interval=1000.0,
        max_queue_size=3,
    ))

    for i in range(5):
        tracker.track(TrackEvent(metric="test", quantity=i, license_id="lic_1"))

    assert len(tracker._buffer) == 3
    # Oldest events (0, 1) should be dropped
    assert tracker._buffer[0].quantity == 2
    assert tracker._buffer[1].quantity == 3
    assert tracker._buffer[2].quantity == 4

    tracker._shutdown.set()


def _slow_tracker(release_after: float):
    import threading

    sent = []
    started = threading.Event()
    tracker = Tracker("dk_test_key", TrackerOptions(
        endpoint="https://test.doow.co",
        flush_at=1,
        flush_interval=1000.0,
    ))

    def slow_send(body):
        started.set()
        time.sleep(release_after)
        sent.append(body)
        return None

    tracker._do_send = slow_send
    return tracker, sent, started


def test_flush_waits_for_a_background_flush_already_sending():
    tracker, sent, started = _slow_tracker(0.3)

    tracker.track(TrackEvent(metric="api_calls", quantity=1, license_id="lic_1"))
    assert started.wait(timeout=2.0)

    tracker.flush()

    assert len(sent) == 1
    tracker.shutdown()


def test_shutdown_waits_for_a_background_flush_already_sending():
    tracker, sent, started = _slow_tracker(0.3)

    tracker.track(TrackEvent(metric="api_calls", quantity=1, license_id="lic_1"))
    assert started.wait(timeout=2.0)

    tracker.shutdown()

    assert len(sent) == 1


def test_flush_called_from_a_callback_on_the_sending_thread_does_not_wait_for_itself():
    holder = {}

    def before_flush(events):
        holder["tracker"].flush()
        return events

    tracker = Tracker("dk_test_key", TrackerOptions(
        endpoint="https://test.doow.co",
        flush_at=100,
        flush_interval=1000.0,
        shutdown_timeout=5.0,
        before_flush=before_flush,
    ))
    holder["tracker"] = tracker
    tracker._do_send = lambda body: None

    tracker.track(TrackEvent(metric="api_calls", quantity=1, license_id="lic_1"))
    started = time.monotonic()
    tracker.flush()

    assert time.monotonic() - started < 1.0
    tracker.shutdown()


def test_a_nested_flush_inside_a_callback_keeps_the_sending_thread_marked():
    holder = {}

    def before_flush(events):
        tracker = holder["tracker"]
        if not holder.get("nested"):
            holder["nested"] = True
            tracker.track(TrackEvent(metric="api_calls", quantity=2, license_id="lic_1"))
            tracker.flush()
            tracker.flush()
        return events

    tracker = Tracker("dk_test_key", TrackerOptions(
        endpoint="https://test.doow.co",
        flush_at=100,
        flush_interval=1000.0,
        shutdown_timeout=5.0,
        before_flush=before_flush,
    ))
    holder["tracker"] = tracker
    tracker._do_send = lambda body: None

    tracker.track(TrackEvent(metric="api_calls", quantity=1, license_id="lic_1"))
    started = time.monotonic()
    tracker.flush()

    assert time.monotonic() - started < 1.0
    tracker.shutdown()


async def _slow_async_tracker():
    import asyncio

    from doow_track import AsyncTracker
    from doow_track.tracker import _DELIVERED

    sent = []
    started = asyncio.Event()
    tracker = AsyncTracker("dk_test_key", TrackerOptions(
        endpoint="https://test.doow.co",
        flush_at=1,
        flush_interval=1000.0,
    ))

    async def slow_send(events):
        started.set()
        await asyncio.sleep(0.3)
        sent.append(len(events))
        return _DELIVERED

    tracker._send_batch = slow_send
    return tracker, sent, started


@pytest.mark.asyncio
async def test_async_flush_waits_for_a_count_triggered_send_already_in_flight():
    import asyncio

    tracker, sent, started = await _slow_async_tracker()

    await tracker.track(TrackEvent(metric="api_calls", quantity=1, license_id="lic_1"))
    await asyncio.wait_for(started.wait(), timeout=2.0)
    await tracker.flush()

    assert sent == [1]
    await tracker.shutdown()


@pytest.mark.asyncio
async def test_async_shutdown_waits_for_a_count_triggered_send_already_in_flight():
    import asyncio

    tracker, sent, started = await _slow_async_tracker()

    await tracker.track(TrackEvent(metric="api_calls", quantity=1, license_id="lic_1"))
    await asyncio.wait_for(started.wait(), timeout=2.0)
    await tracker.shutdown()

    assert sent == [1]
