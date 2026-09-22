package doow

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestTracker_Track(t *testing.T) {
	var received []BatchPayload
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/telemetry/events" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer dk_test_key" {
			t.Errorf("unexpected auth header: %s", r.Header.Get("Authorization"))
		}

		var payload BatchPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode error: %v", err)
		}

		mu.Lock()
		received = append(received, payload)
		mu.Unlock()

		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	tracker := NewTracker("dk_test_key", &TrackerOptions{
		Endpoint:      server.URL,
		FlushAt:       2,
		FlushInterval: 100 * time.Millisecond,
		Debug:         true,
	})

	tracker.Track(TrackEvent{
		Metric:    "api_calls",
		Quantity:  1,
		LicenseID: "lic_123",
	})

	tracker.Track(TrackEvent{
		Metric:    "api_calls",
		Quantity:  2,
		LicenseID: "lic_123",
	})

	// Wait for flush
	time.Sleep(200 * time.Millisecond)
	tracker.Shutdown()

	mu.Lock()
	defer mu.Unlock()

	if len(received) == 0 {
		t.Fatal("expected at least one batch")
	}

	batch := received[0]
	if len(batch.Events) != 2 {
		t.Errorf("expected 2 events, got %d", len(batch.Events))
	}

	if batch.SDKVersion != SDKVersion {
		t.Errorf("expected SDK version %s, got %s", SDKVersion, batch.SDKVersion)
	}
}

func TestTracker_BeforeSend(t *testing.T) {
	var received []BatchPayload
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload BatchPayload
		json.NewDecoder(r.Body).Decode(&payload)
		mu.Lock()
		received = append(received, payload)
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	tracker := NewTracker("dk_test_key", &TrackerOptions{
		Endpoint:      server.URL,
		FlushAt:       10,
		FlushInterval: 50 * time.Millisecond,
		BeforeSend: func(e SerializedEvent) *SerializedEvent {
			// Drop events with quantity 0
			if e.Quantity == 0 {
				return nil
			}
			// Double other quantities
			e.Quantity *= 2
			return &e
		},
	})

	tracker.Track(TrackEvent{Metric: "test", Quantity: 0, LicenseID: "lic_1"})
	tracker.Track(TrackEvent{Metric: "test", Quantity: 5, LicenseID: "lic_1"})

	time.Sleep(100 * time.Millisecond)
	tracker.Shutdown()

	mu.Lock()
	defer mu.Unlock()

	if len(received) == 0 {
		t.Fatal("expected batch")
	}

	if len(received[0].Events) != 1 {
		t.Errorf("expected 1 event (one dropped), got %d", len(received[0].Events))
	}

	if received[0].Events[0].Quantity != 10 {
		t.Errorf("expected quantity 10 (doubled), got %f", received[0].Events[0].Quantity)
	}
}

func TestTracker_Attribution(t *testing.T) {
	var received BatchPayload

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&received)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	tracker := NewTracker("dk_test_key", &TrackerOptions{
		Endpoint:      server.URL,
		FlushAt:       1,
		FlushInterval: time.Hour,
		Attribution: map[string]interface{}{
			"service": "test-service",
			"version": "1.0.0",
		},
	})

	tracker.Track(TrackEvent{
		Metric:    "test",
		Quantity:  1,
		LicenseID: "lic_1",
		Attribution: map[string]interface{}{
			"custom": "value",
		},
	})

	time.Sleep(50 * time.Millisecond)
	tracker.Shutdown()

	if len(received.Events) != 1 {
		t.Fatal("expected 1 event")
	}

	attr := received.Events[0].Attribution
	if attr["service"] != "test-service" {
		t.Errorf("expected service attribution, got %v", attr)
	}
	if attr["custom"] != "value" {
		t.Errorf("expected custom attribution, got %v", attr)
	}
}

func TestTracker_Disabled(t *testing.T) {
	called := false

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	disabled := false
	tracker := NewTracker("dk_test_key", &TrackerOptions{
		Endpoint:      server.URL,
		Enabled:       &disabled,
		FlushAt:       1,
		FlushInterval: 10 * time.Millisecond,
	})

	tracker.Track(TrackEvent{Metric: "test", Quantity: 1, LicenseID: "lic_1"})

	time.Sleep(50 * time.Millisecond)
	tracker.Shutdown()

	if called {
		t.Error("expected no API call when disabled")
	}
}

func TestTracker_Retry(t *testing.T) {
	attempts := 0
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		attempts++
		attempt := attempts
		mu.Unlock()

		if attempt < 3 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	tracker := NewTracker("dk_test_key", &TrackerOptions{
		Endpoint:      server.URL,
		FlushAt:       1,
		FlushInterval: time.Hour,
		RetryCount:    3,
		Timeout:       time.Second,
	})

	tracker.Track(TrackEvent{Metric: "test", Quantity: 1, LicenseID: "lic_1"})

	time.Sleep(2 * time.Second)
	tracker.Shutdown()

	mu.Lock()
	defer mu.Unlock()

	if attempts < 3 {
		t.Errorf("expected at least 3 attempts, got %d", attempts)
	}
}
