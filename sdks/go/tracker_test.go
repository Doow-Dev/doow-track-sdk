package doow

import (
	"compress/gzip"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestTracker_FlushSplitsLargeBacklogIntoChunksOfAtMost500(t *testing.T) {
	var mu sync.Mutex
	var payloads []BatchPayload
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload BatchPayload
		json.NewDecoder(r.Body).Decode(&payload)
		mu.Lock()
		payloads = append(payloads, payload)
		mu.Unlock()
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	tracker := NewTracker("dk_test_key", &TrackerOptions{
		Endpoint:           server.URL,
		FlushAt:            5000,
		MaxQueueSize:       5000,
		FlushInterval:      time.Hour,
		DisableCompression: true,
		RetryCount:         0,
	})
	for i := 0; i < 1200; i++ {
		tracker.Track(TrackEvent{Metric: "api_calls", Quantity: 1, LicenseID: "lic_1"})
	}
	if err := tracker.Flush(); err != nil {
		t.Fatalf("flush failed: %v", err)
	}
	tracker.Shutdown()

	mu.Lock()
	defer mu.Unlock()
	if len(payloads) != 3 {
		t.Fatalf("expected 3 requests, got %d", len(payloads))
	}
	batchIDs := map[string]bool{}
	eventIDs := map[string]bool{}
	for i, want := range []int{500, 500, 200} {
		if len(payloads[i].Events) != want {
			t.Fatalf("chunk %d has %d events, want %d", i, len(payloads[i].Events), want)
		}
		batchIDs[payloads[i].BatchID] = true
		for _, e := range payloads[i].Events {
			eventIDs[e.EventID] = true
		}
	}
	if len(batchIDs) != 3 {
		t.Fatalf("expected 3 distinct batch ids, got %d", len(batchIDs))
	}
	if len(eventIDs) != 1200 {
		t.Fatalf("expected 1200 distinct event ids, got %d", len(eventIDs))
	}
}

type memoryOfflineStore struct {
	mu      sync.Mutex
	batches []SerializedBatch
}

func (s *memoryOfflineStore) Push(batch SerializedBatch) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.batches = append(s.batches, batch)
	return nil
}

func (s *memoryOfflineStore) Shift() (*SerializedBatch, error) { return nil, nil }

func (s *memoryOfflineStore) Length() (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.batches), nil
}

func newBacklogTracker(endpoint string, store OfflineStore) *Tracker {
	return NewTracker("dk_test_key", &TrackerOptions{
		Endpoint:           endpoint,
		FlushAt:            5000,
		MaxQueueSize:       5000,
		FlushInterval:      time.Hour,
		DisableCompression: true,
		RetryCount:         0,
		OfflineStore:       store,
	})
}

func TestTracker_TransientFailureRequeuesThatChunkAndEveryLaterChunk(t *testing.T) {
	var mu sync.Mutex
	var payloads []BatchPayload
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload BatchPayload
		json.NewDecoder(r.Body).Decode(&payload)
		mu.Lock()
		payloads = append(payloads, payload)
		call := len(payloads)
		mu.Unlock()
		if call >= 2 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	tracker := newBacklogTracker(server.URL, nil)
	for i := 0; i < 1200; i++ {
		tracker.Track(TrackEvent{Metric: "api_calls", Quantity: 1, LicenseID: "lic_1"})
	}
	if err := tracker.Flush(); err == nil {
		t.Fatalf("expected the transient failure to be returned")
	}

	mu.Lock()
	batchIDs := map[string]bool{}
	for _, p := range payloads {
		batchIDs[p.BatchID] = true
	}
	if len(batchIDs) != 2 {
		t.Fatalf("expected requests for 2 chunks only, got %d", len(batchIDs))
	}
	failedChunk := payloads[1].Events
	mu.Unlock()

	tracker.mu.Lock()
	buffered := append([]SerializedEvent{}, tracker.buffer...)
	tracker.mu.Unlock()
	if len(buffered) != 700 {
		t.Fatalf("expected 700 requeued events, got %d", len(buffered))
	}
	for i := 0; i < 500; i++ {
		if buffered[i].EventID != failedChunk[i].EventID {
			t.Fatalf("requeued event %d is not the failed chunk's event", i)
		}
	}
	tracker.Shutdown()
}

func TestTracker_ChunkSavedToTheOfflineStoreIsNotRequeuedAgain(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	store := &memoryOfflineStore{}
	tracker := newBacklogTracker(server.URL, store)
	for i := 0; i < 1200; i++ {
		tracker.Track(TrackEvent{Metric: "api_calls", Quantity: 1, LicenseID: "lic_1"})
	}
	tracker.Flush()

	if n, _ := store.Length(); n != 1 {
		t.Fatalf("expected 1 stored batch, got %d", n)
	}
	tracker.mu.Lock()
	buffered := len(tracker.buffer)
	tracker.mu.Unlock()
	if buffered != 700 {
		t.Fatalf("expected 700 requeued events, got %d", buffered)
	}
}

func TestTracker_TransientFailureHoldsCountTriggeredFlushes(t *testing.T) {
	var mu sync.Mutex
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		calls++
		mu.Unlock()
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	tracker := NewTracker("dk_test_key", &TrackerOptions{
		Endpoint:      server.URL,
		FlushAt:       2,
		FlushInterval: time.Hour,
		RetryCount:    0,
	})
	tracker.holdUntil.Store(time.Now().Add(time.Hour).UnixNano())
	tracker.Track(TrackEvent{Metric: "api_calls", Quantity: 1, LicenseID: "lic_1"})
	tracker.Track(TrackEvent{Metric: "api_calls", Quantity: 1, LicenseID: "lic_1"})
	time.Sleep(100 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	if calls != 0 {
		t.Fatalf("expected the hold to block the count-triggered flush, got %d requests", calls)
	}
}

func TestTracker_FlushKeepsSendingLaterChunksAfterAFailedChunk(t *testing.T) {
	var mu sync.Mutex
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		calls++
		call := calls
		mu.Unlock()
		if call == 1 {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	tracker := NewTracker("dk_test_key", &TrackerOptions{
		Endpoint:           server.URL,
		FlushAt:            5000,
		MaxQueueSize:       5000,
		FlushInterval:      time.Hour,
		DisableCompression: true,
		RetryCount:         0,
	})
	for i := 0; i < 700; i++ {
		tracker.Track(TrackEvent{Metric: "api_calls", Quantity: 1, LicenseID: "lic_1"})
	}
	if err := tracker.Flush(); err == nil {
		t.Fatalf("expected the first chunk's error to be returned")
	}
	tracker.Shutdown()

	mu.Lock()
	defer mu.Unlock()
	if calls != 2 {
		t.Fatalf("expected 2 requests, got %d", calls)
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

func TestTracker_ShutdownTwiceDoesNotPanicAndLateTracksAreDropped(t *testing.T) {
	var mu sync.Mutex
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		requests++
		mu.Unlock()
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	tracker := NewTracker("dk_test_key", &TrackerOptions{Endpoint: server.URL, FlushAt: 1000, FlushInterval: time.Hour})
	tracker.Shutdown()
	tracker.Shutdown()
	tracker.Track(TrackEvent{Metric: "api_calls", Quantity: 1, LicenseID: "lic_1"})
	tracker.Flush()

	mu.Lock()
	defer mu.Unlock()
	if requests != 0 {
		t.Fatalf("a late Track after Shutdown must be dropped, got %d requests", requests)
	}
}

func TestTracker_PanickingErrorHandlerDoesNotCrashOrResend(t *testing.T) {
	var mu sync.Mutex
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		calls++
		mu.Unlock()
		w.WriteHeader(http.StatusMultiStatus)
		w.Write([]byte(`{"accepted":0,"rejected":1,"batch_id":"b","rejections":[{"event_id":"e","reason":"bad"}]}`))
	}))
	defer server.Close()

	tracker := NewTracker("dk_test_key", &TrackerOptions{
		Endpoint:      server.URL,
		FlushAt:       1000,
		FlushInterval: time.Hour,
		RetryCount:    3,
		OnError:       func(err error) { panic("handler failure") },
	})
	tracker.Track(TrackEvent{Metric: "api_calls", Quantity: 1, LicenseID: "lic_1"})
	tracker.Shutdown()

	mu.Lock()
	defer mu.Unlock()
	if calls != 1 {
		t.Fatalf("expected one request, got %d", calls)
	}
}

func TestTracker_MalformedPartialAcceptBodyIsReportedWithoutResend(t *testing.T) {
	var mu sync.Mutex
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		calls++
		mu.Unlock()
		w.WriteHeader(http.StatusMultiStatus)
		w.Write([]byte(`{"accepted":"abc","rejected":null,"rejections":[1,"x"]}`))
	}))
	defer server.Close()

	var errs []error
	tracker := NewTracker("dk_test_key", &TrackerOptions{
		Endpoint:      server.URL,
		FlushAt:       1000,
		FlushInterval: time.Hour,
		RetryCount:    3,
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
	if calls != 1 || len(errs) != 1 {
		t.Fatalf("expected 1 request and 1 error, got %d and %d", calls, len(errs))
	}
	if _, ok := errs[0].(*PartialAcceptError); !ok {
		t.Fatalf("expected *PartialAcceptError, got %T", errs[0])
	}
}

func TestSanitizeText(t *testing.T) {
	cleaned := sanitizeText("line1\nline2\x1b[31m" + strings.Repeat("x", 2000))
	if strings.ContainsAny(cleaned, "\n\x1b") || len([]rune(cleaned)) > 520 {
		t.Fatalf("not sanitized: %q", cleaned[:40])
	}
}

func TestTracker_RateLimitedBatchWaitsForRetryAfterAndRetriesTheSameBatch(t *testing.T) {
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
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	tracker := NewTracker("dk_test_key", &TrackerOptions{
		Endpoint:      server.URL,
		FlushAt:       1000,
		FlushInterval: time.Hour,
		RetryCount:    1,
	})
	tracker.Track(TrackEvent{Metric: "api_calls", Quantity: 1, LicenseID: "lic_1"})
	started := time.Now()
	tracker.Shutdown()
	elapsed := time.Since(started)

	mu.Lock()
	defer mu.Unlock()
	if len(payloads) != 2 {
		t.Fatalf("expected 2 attempts, got %d", len(payloads))
	}
	if elapsed < 900*time.Millisecond {
		t.Fatalf("retry came after %v, before the 1s Retry-After", elapsed)
	}
	if payloads[0].BatchID != payloads[1].BatchID {
		t.Fatalf("batch id changed across the rate-limited retry")
	}
}

func TestTracker_InFlightUnavailableBatchWaitsForRetryAfterAndRetriesTheSameBatch(t *testing.T) {
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
			w.Header().Set("Retry-After", "1")
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
		RetryCount:    1,
	})
	tracker.Track(TrackEvent{Metric: "api_calls", Quantity: 1, LicenseID: "lic_1"})
	started := time.Now()
	tracker.Shutdown()
	elapsed := time.Since(started)

	mu.Lock()
	defer mu.Unlock()
	if len(payloads) != 2 {
		t.Fatalf("expected 2 attempts, got %d", len(payloads))
	}
	if elapsed < 900*time.Millisecond {
		t.Fatalf("retry came after %v, before the 1s Retry-After", elapsed)
	}
	if payloads[0].BatchID != payloads[1].BatchID {
		t.Fatalf("batch id changed across the rate-limited retry")
	}
}
