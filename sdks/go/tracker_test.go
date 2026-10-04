package doow

import (
	"compress/gzip"
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

func TestTracker_PartialAcceptReportsRejections(t *testing.T) {
	var calls int
	var mu sync.Mutex
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		calls++
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusMultiStatus)
		w.Write([]byte(`{"accepted":1,"rejected":1,"batch_id":"b1","rejections":[{"event_id":"evt-x","reason":"license_id is required"}]}`))
	}))
	defer server.Close()

	var errs []error
	tracker := NewTracker("dk_test_key", &TrackerOptions{
		Endpoint:      server.URL,
		FlushAt:       2,
		FlushInterval: time.Hour,
		RetryCount:    2,
		OnError: func(err error) {
			mu.Lock()
			errs = append(errs, err)
			mu.Unlock()
		},
	})
	tracker.Track(TrackEvent{Metric: "api_calls", Quantity: 1, LicenseID: "lic_1"})
	tracker.Track(TrackEvent{Metric: "api_calls", Quantity: 1, LicenseID: "lic_1"})
	tracker.Shutdown()

	mu.Lock()
	defer mu.Unlock()
	if calls != 1 {
		t.Fatalf("207 must not be retried, got %d requests", calls)
	}
	if len(errs) != 1 {
		t.Fatalf("expected one error, got %d", len(errs))
	}
	partial, ok := errs[0].(*PartialAcceptError)
	if !ok {
		t.Fatalf("expected *PartialAcceptError, got %T", errs[0])
	}
	if partial.Rejected != 1 || len(partial.Rejections) != 1 || partial.Rejections[0].EventID != "evt-x" {
		t.Fatalf("unexpected rejections: %+v", partial)
	}
}

func TestTracker_RetryReusesBatchAndEventIDs(t *testing.T) {
	var mu sync.Mutex
	var payloads []BatchPayload
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload BatchPayload
		json.NewDecoder(r.Body).Decode(&payload)
		mu.Lock()
		payloads = append(payloads, payload)
		attempt := len(payloads)
		mu.Unlock()
		if attempt == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	tracker := NewTracker("dk_test_key", &TrackerOptions{
		Endpoint:      server.URL,
		FlushAt:       1000,
		FlushInterval: time.Hour,
		RetryCount:    2,
	})
	tracker.Track(TrackEvent{Metric: "api_calls", Quantity: 1, LicenseID: "lic_1"})
	tracker.Shutdown()

	mu.Lock()
	defer mu.Unlock()
	if len(payloads) != 2 {
		t.Fatalf("expected 2 attempts, got %d", len(payloads))
	}
	if payloads[0].BatchID == "" || payloads[0].BatchID != payloads[1].BatchID {
		t.Fatalf("batch id changed across retry: %q vs %q", payloads[0].BatchID, payloads[1].BatchID)
	}
	if payloads[0].Events[0].EventID == "" || payloads[0].Events[0].EventID != payloads[1].Events[0].EventID {
		t.Fatalf("event id changed across retry")
	}
}

func TestTracker_Accepts202WithoutError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		w.Write([]byte(`{"accepted":1,"rejected":0,"batch_id":"b"}`))
	}))
	defer server.Close()

	var errs []error
	var mu sync.Mutex
	tracker := NewTracker("dk_test_key", &TrackerOptions{
		Endpoint:      server.URL,
		FlushAt:       1000,
		FlushInterval: time.Hour,
		OnError: func(err error) {
			mu.Lock()
			errs = append(errs, err)
			mu.Unlock()
		},
	})
	tracker.Track(TrackEvent{Metric: "api_calls", Quantity: 1, LicenseID: "lic_1"})
	tracker.Shutdown()

	mu.Lock()
	defer mu.Unlock()
	if len(errs) != 0 {
		t.Fatalf("202 must not report errors, got %v", errs)
	}
}

func TestTracker_LargeBodiesAreRealGzip(t *testing.T) {
	var mu sync.Mutex
	var encoding string
	var events int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reader := r.Body
		if r.Header.Get("Content-Encoding") == "gzip" {
			gz, err := gzip.NewReader(r.Body)
			if err != nil {
				t.Errorf("body is not gzip: %v", err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			reader = gz
		}
		var payload BatchPayload
		json.NewDecoder(reader).Decode(&payload)
		mu.Lock()
		encoding = r.Header.Get("Content-Encoding")
		events = len(payload.Events)
		mu.Unlock()
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	tracker := NewTracker("dk_test_key", &TrackerOptions{
		Endpoint:      server.URL,
		FlushAt:       1000,
		FlushInterval: time.Hour,
	})
	for i := 0; i < 300; i++ {
		tracker.Track(TrackEvent{Metric: "api_calls", Quantity: 1, LicenseID: "lic_1"})
	}
	tracker.Shutdown()

	mu.Lock()
	defer mu.Unlock()
	if encoding != "gzip" || events != 300 {
		t.Fatalf("expected 300 gzip events, got encoding=%q events=%d", encoding, events)
	}
}

func TestTracker_PermanentClientErrorIsNotRetriedOrStored(t *testing.T) {
	var mu sync.Mutex
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		calls++
		mu.Unlock()
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer server.Close()

	store := &memoryStore{}
	var errs []error
	tracker := NewTracker("dk_test_key", &TrackerOptions{
		Endpoint:      server.URL,
		FlushAt:       1000,
		FlushInterval: time.Hour,
		RetryCount:    3,
		OfflineStore:  store,
		OnError: func(err error) {
			mu.Lock()
			errs = append(errs, err)
			mu.Unlock()
		},
	})
	tracker.Track(TrackEvent{Metric: "api_calls", Quantity: 1, LicenseID: "lic_1"})
	tracker.Shutdown()

	mu.Lock()
	defer mu.Unlock()
	if calls != 1 {
		t.Fatalf("400 must not be retried, got %d requests", calls)
	}
	if len(store.batches) != 0 {
		t.Fatalf("permanent failure must not reach the offline store")
	}
	if len(errs) != 1 {
		t.Fatalf("expected one reported error, got %d", len(errs))
	}
}

func TestParseRetryAfter(t *testing.T) {
	if got := parseRetryAfter("2"); got != 2*time.Second {
		t.Fatalf("seconds form: %v", got)
	}
	if got := parseRetryAfter("86400"); got != maxRetryAfter {
		t.Fatalf("must clamp, got %v", got)
	}
	if got := parseRetryAfter("garbage"); got != 0 {
		t.Fatalf("unparseable must be 0, got %v", got)
	}
}

type memoryStore struct {
	mu      sync.Mutex
	batches []SerializedBatch
}

func (m *memoryStore) Push(b SerializedBatch) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.batches = append(m.batches, b)
	return nil
}

func (m *memoryStore) Shift() (*SerializedBatch, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.batches) == 0 {
		return nil, nil
	}
	b := m.batches[0]
	m.batches = m.batches[1:]
	return &b, nil
}

func (m *memoryStore) Length() (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.batches), nil
}
