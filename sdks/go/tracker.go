package doow

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"
)

const (
	SDKVersion           = "0.1.0"
	defaultEndpoint      = "https://api.doow.co"
	defaultFlushAt       = 20
	defaultFlushInterval = 10 * time.Second
	defaultMaxPayload    = 450 * 1024
	defaultMaxQueueSize  = 10000
	defaultTimeout       = 10 * time.Second
	defaultRetryCount    = 3
	defaultMaxFlushes    = 30
	defaultShutdownTime  = 5 * time.Second
)

func generateUUID() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return hex.EncodeToString(b[:4]) + "-" + hex.EncodeToString(b[4:6]) + "-" +
		hex.EncodeToString(b[6:8]) + "-" + hex.EncodeToString(b[8:10]) + "-" +
		hex.EncodeToString(b[10:])
}

// Tracker handles usage telemetry batching and submission
type Tracker struct {
	apiKey      string
	endpoint    string
	enabled     bool
	attribution map[string]interface{}
	debug       bool
	flushAt     int
	flushInterval time.Duration
	maxPayloadBytes int
	maxQueueSize    int
	timeout         time.Duration
	retryCount      int
	disableCompression bool
	maxConcurrentFlushes int
	shutdownTimeout time.Duration
	onError         func(error)
	beforeSend      func(SerializedEvent) *SerializedEvent
	beforeFlush     func([]SerializedEvent) []SerializedEvent
	offlineStore    OfflineStore

	client     *http.Client
	mu         sync.Mutex
	buffer     []SerializedEvent
	shutdown   chan struct{}
	done       chan struct{}
	flushSem   chan struct{}
	rateLimit  *RateLimit
}

// NewTracker creates a new telemetry tracker
func NewTracker(apiKey string, opts *TrackerOptions) *Tracker {
	if opts == nil {
		opts = &TrackerOptions{}
	}

	// Environment variable overrides
	if envKey := os.Getenv("DOOW_TRACK_API_KEY"); envKey != "" {
		apiKey = envKey
	}
	if envEndpoint := os.Getenv("DOOW_TRACK_ENDPOINT"); envEndpoint != "" {
		opts.Endpoint = envEndpoint
	}
	// Enabled defaults to true unless explicitly set to false or env var disables
	enabled := true
	if os.Getenv("DOOW_TRACK_DISABLED") == "true" {
		enabled = false
	} else if opts.Enabled != nil && !*opts.Enabled {
		enabled = false
	}
	if os.Getenv("DOOW_TRACK_DEBUG") == "true" {
		opts.Debug = true
	}
	if envFlushAt := os.Getenv("DOOW_TRACK_FLUSH_AT"); envFlushAt != "" {
		if n, err := strconv.Atoi(envFlushAt); err == nil && n > 0 {
			opts.FlushAt = n
		}
	}
	if envInterval := os.Getenv("DOOW_TRACK_FLUSH_INTERVAL"); envInterval != "" {
		if n, err := strconv.Atoi(envInterval); err == nil && n > 0 {
			opts.FlushInterval = time.Duration(n) * time.Millisecond
		}
	}

	endpoint := opts.Endpoint
	if endpoint == "" {
		endpoint = defaultEndpoint
	}

	flushAt := opts.FlushAt
	if flushAt == 0 {
		flushAt = defaultFlushAt
	}

	flushInterval := opts.FlushInterval
	if flushInterval == 0 {
		flushInterval = defaultFlushInterval
	}

	maxPayload := opts.MaxPayloadBytes
	if maxPayload == 0 {
		maxPayload = defaultMaxPayload
	}

	maxQueue := opts.MaxQueueSize
	if maxQueue == 0 {
		maxQueue = defaultMaxQueueSize
	}

	timeout := opts.Timeout
	if timeout == 0 {
		timeout = defaultTimeout
	}

	retryCount := opts.RetryCount
	if retryCount == 0 {
		retryCount = defaultRetryCount
	}

	maxFlushes := opts.MaxConcurrentFlushes
	if maxFlushes == 0 {
		maxFlushes = defaultMaxFlushes
	}

	shutdownTimeout := opts.ShutdownTimeout
	if shutdownTimeout == 0 {
		shutdownTimeout = defaultShutdownTime
	}

	onError := opts.OnError
	if onError == nil {
		onError = func(err error) {
			fmt.Fprintf(os.Stderr, "[doow/track] error: %v\n", err)
		}
	}

	t := &Tracker{
		apiKey:               apiKey,
		endpoint:             endpoint,
		enabled:              enabled,
		attribution:          opts.Attribution,
		debug:                opts.Debug,
		flushAt:              flushAt,
		flushInterval:        flushInterval,
		maxPayloadBytes:      maxPayload,
		maxQueueSize:         maxQueue,
		timeout:              timeout,
		retryCount:           retryCount,
		disableCompression:   opts.DisableCompression,
		maxConcurrentFlushes: maxFlushes,
		shutdownTimeout:      shutdownTimeout,
		onError:              onError,
		beforeSend:           opts.BeforeSend,
		beforeFlush:          opts.BeforeFlush,
		offlineStore:         opts.OfflineStore,
		client:               &http.Client{Timeout: timeout},
		buffer:               make([]SerializedEvent, 0, maxQueue),
		shutdown:             make(chan struct{}),
		done:                 make(chan struct{}),
		flushSem:             make(chan struct{}, maxFlushes),
	}

	go t.flushLoop()
	return t
}

func (t *Tracker) log(format string, args ...interface{}) {
	if t.debug {
		fmt.Fprintf(os.Stderr, "[doow/track] "+format+"\n", args...)
	}
}

// Track queues a telemetry event for submission
func (t *Tracker) Track(event TrackEvent) {
	if !t.enabled {
		return
	}

	// Generate event ID and timestamp
	now := time.Now().UTC()
	ts := now.Format(time.RFC3339Nano)
	if event.Timestamp != nil {
		ts = event.Timestamp.Format(time.RFC3339Nano)
	}

	// Merge attribution
	attr := event.Attribution
	if t.attribution != nil {
		if attr == nil {
			attr = make(map[string]interface{})
		}
		for k, v := range t.attribution {
			if _, exists := attr[k]; !exists {
				attr[k] = v
			}
		}
	}

	serialized := SerializedEvent{
		TrackEvent: TrackEvent{
			Metric:          event.Metric,
			Quantity:        event.Quantity,
			Unit:            event.Unit,
			LicenseID:       event.LicenseID,
			SourceSystem:    event.SourceSystem,
			MetricTupleHint: event.MetricTupleHint,
			Kind:            event.Kind,
			Attribution:     attr,
			Metadata:        event.Metadata,
		},
		EventID:   generateUUID(),
		Timestamp: ts,
	}

	// BeforeSend hook
	if t.beforeSend != nil {
		result := t.beforeSend(serialized)
		if result == nil {
			t.log("event dropped by beforeSend hook")
			return
		}
		serialized = *result
	}

	t.mu.Lock()
	if len(t.buffer) >= t.maxQueueSize {
		// Drop oldest event
		t.buffer = t.buffer[1:]
		t.log("queue full, dropped oldest event")
	}
	t.buffer = append(t.buffer, serialized)
	shouldFlush := len(t.buffer) >= t.flushAt
	t.mu.Unlock()

	if shouldFlush {
		go t.Flush()
	}
}

// Flush sends all buffered events immediately
func (t *Tracker) Flush() error {
	t.mu.Lock()
	if len(t.buffer) == 0 {
		t.mu.Unlock()
		return nil
	}
	events := t.buffer
	t.buffer = make([]SerializedEvent, 0, t.maxQueueSize)
	t.mu.Unlock()

	// BeforeFlush hook
	if t.beforeFlush != nil {
		events = t.beforeFlush(events)
		if events == nil || len(events) == 0 {
			t.log("batch dropped by beforeFlush hook")
			return nil
		}
	}

	// Rate limiting
	select {
	case t.flushSem <- struct{}{}:
		defer func() { <-t.flushSem }()
	default:
		t.log("too many concurrent flushes, queueing")
		t.flushSem <- struct{}{}
		defer func() { <-t.flushSem }()
	}

	return t.sendBatch(events)
}

func (t *Tracker) sendBatch(events []SerializedEvent) error {
	batchID := generateUUID()

	// Convert to wire format
	wireEvents := make([]WireEvent, len(events))
	for i, e := range events {
		sourceSystem := e.SourceSystem
		if sourceSystem == "" {
			sourceSystem = "sdk"
		}
		wireEvents[i] = WireEvent{
			SerializedEvent: e,
			OccurredAt:      e.Timestamp,
			SourceSystem:    sourceSystem,
			Measurements: []WireMeasurement{{
				MetricName:      e.Metric,
				Quantity:        e.Quantity,
				MetricTupleHint: e.MetricTupleHint,
			}},
		}
	}

	payload := BatchPayload{
		BatchID:    batchID,
		SDKVersion: SDKVersion,
		Events:     wireEvents,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		t.onError(fmt.Errorf("marshal batch: %w", err))
		return err
	}

	t.log("sending batch %s with %d events (%d bytes)", batchID, len(events), len(body))

	// Retry with exponential backoff
	var lastErr error
	for attempt := 0; attempt <= t.retryCount; attempt++ {
		if attempt > 0 {
			backoff := time.Duration(1<<uint(attempt-1)) * 100 * time.Millisecond
			if backoff > 10*time.Second {
				backoff = 10 * time.Second
			}
			time.Sleep(backoff)
			t.log("retry attempt %d after %v", attempt, backoff)
		}

		err := t.doSend(body)
		if err == nil {
			t.log("batch %s sent successfully", batchID)
			return nil
		}

		lastErr = err

		// Check if retryable
		if apiErr, ok := err.(*APIError); ok {
			if apiErr.Status == 401 || apiErr.Status == 403 {
				t.onError(err)
				return err // Not retryable
			}
			if apiErr.Status == 429 {
				// Rate limited - wait longer
				time.Sleep(5 * time.Second)
			}
		}
	}

	// All retries failed - try offline store
	if t.offlineStore != nil {
		payloadStr := string(body)
		batch := SerializedBatch{
			BatchID:   batchID,
			Payload:   payloadStr,
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		}
		if err := t.offlineStore.Push(batch); err != nil {
			t.onError(fmt.Errorf("offline store push: %w", err))
		} else {
			t.log("batch %s saved to offline store", batchID)
		}
	}

	t.onError(lastErr)
	return lastErr
}

func (t *Tracker) doSend(body []byte) error {
	ctx, cancel := context.WithTimeout(context.Background(), t.timeout)
	defer cancel()

	var reqBody []byte
	var contentEncoding string

	if !t.disableCompression && len(body) > 1024 {
		var buf bytes.Buffer
		gz := gzip.NewWriter(&buf)
		if _, err := gz.Write(body); err == nil {
			gz.Close()
			reqBody = buf.Bytes()
			contentEncoding = "gzip"
		} else {
			reqBody = body
		}
	} else {
		reqBody = body
	}

	req, err := http.NewRequestWithContext(ctx, "POST", t.endpoint+"/telemetry/events", bytes.NewReader(reqBody))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+t.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "doow-track-go/"+SDKVersion)
	if contentEncoding != "" {
		req.Header.Set("Content-Encoding", contentEncoding)
	}

	resp, err := t.client.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	// Parse rate limit headers
	if limit := resp.Header.Get("X-RateLimit-Limit"); limit != "" {
		t.rateLimit = &RateLimit{}
		t.rateLimit.Limit, _ = strconv.Atoi(limit)
		if remaining := resp.Header.Get("X-RateLimit-Remaining"); remaining != "" {
			t.rateLimit.Remaining, _ = strconv.Atoi(remaining)
		}
		if reset := resp.Header.Get("X-RateLimit-Reset"); reset != "" {
			if ts, err := strconv.ParseInt(reset, 10, 64); err == nil {
				t.rateLimit.Reset = time.Unix(ts, 0)
			}
		}
	}

	if resp.StatusCode >= 400 {
		var apiErr APIError
		if err := json.NewDecoder(resp.Body).Decode(&apiErr); err != nil {
			apiErr = APIError{Status: resp.StatusCode, Message: resp.Status}
		}
		apiErr.Status = resp.StatusCode
		return &apiErr
	}

	return nil
}

func (t *Tracker) flushLoop() {
	ticker := time.NewTicker(t.flushInterval)
	defer ticker.Stop()
	defer close(t.done)

	// Try to drain offline store on startup
	if t.offlineStore != nil {
		go t.drainOfflineStore()
	}

	for {
		select {
		case <-ticker.C:
			if err := t.Flush(); err != nil {
				t.log("periodic flush error: %v", err)
			}
		case <-t.shutdown:
			t.Flush()
			return
		}
	}
}

func (t *Tracker) drainOfflineStore() {
	for {
		batch, err := t.offlineStore.Shift()
		if err != nil || batch == nil {
			return
		}

		var payload BatchPayload
		if err := json.Unmarshal([]byte(batch.Payload), &payload); err != nil {
			t.log("failed to unmarshal offline batch: %v", err)
			continue
		}

		body, _ := json.Marshal(payload)
		if err := t.doSend(body); err != nil {
			// Put it back
			t.offlineStore.Push(*batch)
			return
		}
		t.log("drained offline batch %s", batch.BatchID)
	}
}

// Shutdown flushes remaining events and stops the tracker
func (t *Tracker) Shutdown() error {
	close(t.shutdown)

	select {
	case <-t.done:
		return nil
	case <-time.After(t.shutdownTimeout):
		return fmt.Errorf("shutdown timeout after %v", t.shutdownTimeout)
	}
}

// GetRateLimit returns the last known rate limit info
func (t *Tracker) GetRateLimit() *RateLimit {
	return t.rateLimit
}
