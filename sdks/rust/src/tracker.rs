//! Telemetry tracker for Doow SDK.

use crate::error::{sanitize_text, DoowError, Rejection, Result};
use crate::types::{EventKind, MetricTupleHint, SerializedEvent, TrackEvent};
use chrono::Utc;
use flate2::write::GzEncoder;
use flate2::Compression;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex, RwLock};
use uuid::Uuid;

const SDK_VERSION: &str = "0.1.0";
const DEFAULT_ENDPOINT: &str = "https://api.doow.co";
const DEFAULT_FLUSH_AT: usize = 20;
const DEFAULT_FLUSH_INTERVAL_MS: u64 = 10_000;
const DEFAULT_MAX_QUEUE_SIZE: usize = 10_000;
const DEFAULT_TIMEOUT_MS: u64 = 10_000;
const DEFAULT_RETRY_COUNT: u32 = 3;

/// Callback invoked for every delivery failure, including partial rejections
#[derive(Clone)]
pub struct ErrorHandler(pub Arc<dyn Fn(&DoowError) + Send + Sync>);

impl std::fmt::Debug for ErrorHandler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ErrorHandler")
    }
}

/// Tracker configuration options
#[derive(Debug, Clone)]
pub struct TrackerOptions {
    pub endpoint: String,
    pub enabled: bool,
    pub debug: bool,
    pub flush_at: usize,
    pub flush_interval_ms: u64,
    pub max_queue_size: usize,
    pub timeout_ms: u64,
    pub retry_count: u32,
    pub disable_compression: bool,
    pub attribution: HashMap<String, serde_json::Value>,
    pub on_error: Option<ErrorHandler>,
}

impl Default for TrackerOptions {
    fn default() -> Self {
        Self {
            endpoint: std::env::var("DOOW_TRACK_ENDPOINT")
                .unwrap_or_else(|_| DEFAULT_ENDPOINT.to_string()),
            enabled: std::env::var("DOOW_TRACK_DISABLED")
                .map(|v| v != "true")
                .unwrap_or(true),
            debug: std::env::var("DOOW_TRACK_DEBUG")
                .map(|v| v == "true")
                .unwrap_or(false),
            flush_at: std::env::var("DOOW_TRACK_FLUSH_AT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(DEFAULT_FLUSH_AT),
            flush_interval_ms: std::env::var("DOOW_TRACK_FLUSH_INTERVAL")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(DEFAULT_FLUSH_INTERVAL_MS),
            max_queue_size: DEFAULT_MAX_QUEUE_SIZE,
            timeout_ms: DEFAULT_TIMEOUT_MS,
            retry_count: DEFAULT_RETRY_COUNT,
            disable_compression: false,
            attribution: HashMap::new(),
            on_error: None,
        }
    }
}

#[derive(Serialize)]
pub(crate) struct WireMeasurement {
    metric_name: String,
    quantity: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    metric_tuple_hint: Option<MetricTupleHint>,
}

#[derive(Serialize)]
pub(crate) struct WireEvent {
    event_id: String,
    license_id: String,
    occurred_at: String,
    source_system: String,
    kind: EventKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    attribution: Option<HashMap<String, serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<HashMap<String, serde_json::Value>>,
    measurements: Vec<WireMeasurement>,
}

#[derive(Serialize)]
pub(crate) struct BatchPayload {
    batch_id: String,
    sdk_version: String,
    events: Vec<WireEvent>,
}

#[derive(Deserialize)]
struct PartialAcceptBody {
    #[serde(default)]
    accepted: u32,
    #[serde(default)]
    rejected: u32,
    #[serde(default)]
    batch_id: String,
    #[serde(default)]
    rejections: Vec<Rejection>,
}

const MAX_BODY_BYTES: usize = 1 << 20;
const MAX_RETRY_AFTER: Duration = Duration::from_secs(30);

async fn read_capped(mut resp: reqwest::Response) -> Vec<u8> {
    let mut bytes = Vec::new();
    while let Ok(Some(chunk)) = resp.chunk().await {
        let room = MAX_BODY_BYTES - bytes.len();
        bytes.extend_from_slice(&chunk[..chunk.len().min(room)]);
        if bytes.len() >= MAX_BODY_BYTES {
            break;
        }
    }
    bytes
}

pub(crate) fn parse_retry_after(header: Option<&str>) -> Option<Duration> {
    let seconds: f64 = header?.trim().parse().ok()?;
    if !seconds.is_finite() || seconds < 0.0 {
        return None;
    }
    Some(Duration::from_secs_f64(seconds.min(MAX_RETRY_AFTER.as_secs_f64())))
}

pub(crate) fn build_payload(batch_id: &str, events: &[SerializedEvent]) -> BatchPayload {
    BatchPayload {
        batch_id: batch_id.to_string(),
        sdk_version: SDK_VERSION.to_string(),
        events: events
            .iter()
            .map(|e| WireEvent {
                event_id: e.event_id.clone(),
                license_id: e.license_id.clone(),
                occurred_at: e.timestamp.clone(),
                source_system: e
                    .source_system
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .unwrap_or("sdk")
                    .to_string(),
                kind: e.kind.clone(),
                attribution: e.attribution.clone(),
                metadata: e.metadata.clone(),
                measurements: vec![WireMeasurement {
                    metric_name: e.metric.clone(),
                    quantity: e.quantity,
                    metric_tuple_hint: e.metric_tuple_hint.clone(),
                }],
            })
            .collect(),
    }
}

#[derive(Deserialize)]
struct ApiErrorResponse {
    message: Option<String>,
    #[serde(rename = "errorClass")]
    error_class: Option<String>,
}

/// Usage telemetry tracker with batching, compression, and retries
pub struct Tracker {
    api_key: String,
    options: TrackerOptions,
    client: Client,
    buffer: Arc<Mutex<Vec<SerializedEvent>>>,
    shutdown_tx: Option<mpsc::Sender<()>>,
    shutdown_complete: Arc<RwLock<bool>>,
}

impl Tracker {
    /// Create a new tracker
    pub fn new(api_key: impl Into<String>, options: Option<TrackerOptions>) -> Self {
        let api_key = std::env::var("DOOW_TRACK_API_KEY").unwrap_or_else(|_| api_key.into());
        let options = options.unwrap_or_default();

        let client = Client::builder()
            .timeout(Duration::from_millis(options.timeout_ms))
            .build()
            .expect("Failed to create HTTP client");

        let buffer = Arc::new(Mutex::new(Vec::with_capacity(options.max_queue_size)));
        let shutdown_complete = Arc::new(RwLock::new(false));

        let (shutdown_tx, shutdown_rx) = mpsc::channel(1);

        let tracker = Self {
            api_key: api_key.clone(),
            options: options.clone(),
            client: client.clone(),
            buffer: buffer.clone(),
            shutdown_tx: Some(shutdown_tx),
            shutdown_complete: shutdown_complete.clone(),
        };

        // Start flush loop
        if options.enabled {
            let flush_buffer = buffer.clone();
            let flush_options = options.clone();
            let flush_client = client;
            let flush_api_key = api_key;
            let flush_shutdown_complete = shutdown_complete;

            tokio::spawn(async move {
                Self::flush_loop(
                    flush_buffer,
                    flush_options,
                    flush_client,
                    flush_api_key,
                    shutdown_rx,
                    flush_shutdown_complete,
                )
                .await;
            });
        }

        tracker
    }

    fn log(&self, msg: &str) {
        if self.options.debug {
            eprintln!("[doow/track] {}", msg);
        }
    }

    fn report(options: &TrackerOptions, error: &DoowError) {
        if options.debug {
            eprintln!("[doow/track] {}", error);
        }
        if let Some(handler) = &options.on_error {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| (handler.0)(error)));
        }
    }

    /// Track a usage event
    pub async fn track(&self, event: TrackEvent) {
        if !self.options.enabled {
            return;
        }

        let timestamp = event
            .timestamp
            .map(|t| t.to_rfc3339())
            .unwrap_or_else(|| Utc::now().to_rfc3339());

        let mut attribution = self.options.attribution.clone();
        if let Some(event_attr) = event.attribution {
            attribution.extend(event_attr);
        }

        let serialized = SerializedEvent {
            event_id: Uuid::new_v4().to_string(),
            metric: event.metric,
            quantity: event.quantity,
            license_id: event.license_id,
            unit: event.unit,
            kind: event.kind,
            timestamp,
            source_system: event.source_system,
            metric_tuple_hint: event.metric_tuple_hint,
            attribution: if attribution.is_empty() {
                None
            } else {
                Some(attribution)
            },
            metadata: event.metadata,
        };

        let mut buffer = self.buffer.lock().await;
        if buffer.len() >= self.options.max_queue_size {
            buffer.remove(0);
            self.log("queue full, dropped oldest event");
        }
        buffer.push(serialized);

        let should_flush = buffer.len() >= self.options.flush_at;
        drop(buffer);

        if should_flush {
            self.flush().await;
        }
    }

    /// Flush all buffered events
    pub async fn flush(&self) {
        let events: Vec<SerializedEvent> = {
            let mut buffer = self.buffer.lock().await;
            if buffer.is_empty() {
                return;
            }
            std::mem::take(&mut *buffer)
        };

        if let Err(e) = self.send_batch(events).await {
            Self::report(&self.options, &e);
        }
    }

    async fn send_batch(&self, events: Vec<SerializedEvent>) -> Result<()> {
        let batch_id = Uuid::new_v4().to_string();

        let payload = build_payload(&batch_id, &events);

        let body = serde_json::to_vec(&payload)?;
        self.log(&format!(
            "sending batch {} with {} events ({} bytes)",
            batch_id,
            events.len(),
            body.len()
        ));

        let mut last_error = None;
        let mut server_delay: Option<Duration> = None;

        for attempt in 0..=self.options.retry_count {
            if attempt > 0 {
                let mut backoff = Duration::from_millis(100 * (1 << (attempt - 1)).min(100));
                if let Some(delay) = server_delay.take() {
                    backoff = backoff.max(delay);
                }
                tokio::time::sleep(backoff).await;
                self.log(&format!("retry attempt {} after {:?}", attempt, backoff));
            }

            match self.do_send(&body).await {
                Ok(()) => {
                    self.log(&format!("batch {} sent successfully", batch_id));
                    return Ok(());
                }
                Err(e) => {
                    if !e.is_retryable() {
                        return Err(e);
                    }
                    server_delay = match &e {
                        DoowError::Api { retry_after, .. } => *retry_after,
                        _ => None,
                    };
                    last_error = Some(e);
                }
            }
        }

        Err(last_error.unwrap_or_else(|| DoowError::Configuration("Unknown error".to_string())))
    }

    async fn do_send(&self, body: &[u8]) -> Result<()> {
        let (req_body, content_encoding) = if !self.options.disable_compression && body.len() > 1024
        {
            let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
            encoder.write_all(body)?;
            (encoder.finish()?, Some("gzip"))
        } else {
            (body.to_vec(), None)
        };

        let mut req = self
            .client
            .post(format!("{}/telemetry/events", self.options.endpoint))
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .header("User-Agent", format!("doow-track-rust/{}", SDK_VERSION));

        if let Some(encoding) = content_encoding {
            req = req.header("Content-Encoding", encoding);
        }

        let resp = req.body(req_body).send().await?;

        let status = resp.status().as_u16();
        let retry_after = parse_retry_after(
            resp.headers().get("retry-after").and_then(|v| v.to_str().ok()),
        );
        let body_bytes = read_capped(resp).await;

        if status == 207 {
            let body: PartialAcceptBody =
                serde_json::from_slice(&body_bytes).unwrap_or(PartialAcceptBody {
                    accepted: 0,
                    rejected: 0,
                    batch_id: String::new(),
                    rejections: Vec::new(),
                });
            return Err(DoowError::PartialAccept {
                accepted: body.accepted,
                rejected: body.rejected,
                batch_id: sanitize_text(&body.batch_id),
                rejections: body
                    .rejections
                    .into_iter()
                    .map(|r| Rejection {
                        event_id: sanitize_text(&r.event_id),
                        reason: sanitize_text(&r.reason),
                    })
                    .collect(),
            });
        }

        if (200..300).contains(&status) {
            return Ok(());
        }

        let error_resp: ApiErrorResponse =
            serde_json::from_slice(&body_bytes).unwrap_or(ApiErrorResponse {
                message: None,
                error_class: None,
            });

        let mut error = DoowError::api(
            status,
            error_resp.message.unwrap_or_else(|| "Unknown error".to_string()),
            error_resp.error_class,
        );
        if let DoowError::Api { retry_after: slot, .. } = &mut error {
            *slot = if status == 429 { retry_after } else { None };
        }
        Err(error)
    }

    async fn flush_loop(
        buffer: Arc<Mutex<Vec<SerializedEvent>>>,
        options: TrackerOptions,
        client: Client,
        api_key: String,
        mut shutdown_rx: mpsc::Receiver<()>,
        shutdown_complete: Arc<RwLock<bool>>,
    ) {
        let interval = Duration::from_millis(options.flush_interval_ms);

        loop {
            tokio::select! {
                _ = tokio::time::sleep(interval) => {
                    let events: Vec<SerializedEvent> = {
                        let mut buf = buffer.lock().await;
                        if buf.is_empty() {
                            continue;
                        }
                        std::mem::take(&mut *buf)
                    };

                    let tracker = Tracker {
                        api_key: api_key.clone(),
                        options: options.clone(),
                        client: client.clone(),
                        buffer: buffer.clone(),
                        shutdown_tx: None,
                        shutdown_complete: shutdown_complete.clone(),
                    };

                    if let Err(e) = tracker.send_batch(events).await {
                        Self::report(&options, &e);
                    }
                }
                _ = shutdown_rx.recv() => {
                    // Final flush
                    let events: Vec<SerializedEvent> = {
                        let mut buf = buffer.lock().await;
                        std::mem::take(&mut *buf)
                    };

                    if !events.is_empty() {
                        let tracker = Tracker {
                            api_key: api_key.clone(),
                            options: options.clone(),
                            client: client.clone(),
                            buffer: buffer.clone(),
                            shutdown_tx: None,
                            shutdown_complete: shutdown_complete.clone(),
                        };
                        if let Err(e) = tracker.send_batch(events).await {
                            Self::report(&options, &e);
                        }
                    }

                    *shutdown_complete.write().await = true;
                    return;
                }
            }
        }
    }

    /// Shutdown the tracker, flushing remaining events
    pub async fn shutdown(&self) {
        if let Some(tx) = &self.shutdown_tx {
            let _ = tx.send(()).await;

            // Wait for shutdown to complete
            loop {
                if *self.shutdown_complete.read().await {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{EventKind, SerializedEvent};
    use std::sync::Mutex as StdMutex;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn event(id: &str) -> SerializedEvent {
        SerializedEvent {
            event_id: id.to_string(),
            metric: "api_calls".to_string(),
            quantity: 1.0,
            license_id: "lic_1".to_string(),
            unit: None,
            kind: EventKind::default(),
            timestamp: "2026-10-04T00:00:00Z".to_string(),
            source_system: None,
            metric_tuple_hint: Some(MetricTupleHint {
                app_name: "app".to_string(),
                license_name: "lic".to_string(),
                metric_name: "calls".to_string(),
            }),
            attribution: None,
            metadata: None,
        }
    }

    #[test]
    fn tuple_hint_serializes_as_object() {
        let json = serde_json::to_value(build_payload("b1", &[event("e1")])).unwrap();
        let hint = &json["events"][0]["measurements"][0]["metric_tuple_hint"];
        assert!(hint.is_object(), "hint must be an object, got {hint}");
        assert_eq!(hint["app_name"], "app");
        assert_eq!(hint["license_name"], "lic");
        assert_eq!(hint["metric_name"], "calls");
        assert_eq!(json["batch_id"], "b1");
        assert_eq!(json["events"][0]["source_system"], "sdk");
    }

    fn tracker_for(server: &MockServer, errors: Arc<StdMutex<Vec<String>>>) -> Tracker {
        let sink = errors.clone();
        Tracker::new(
            "dk_test",
            Some(TrackerOptions {
                endpoint: server.uri(),
                retry_count: 2,
                flush_at: 1000,
                on_error: Some(ErrorHandler(Arc::new(move |e| {
                    if let DoowError::PartialAccept { rejections, .. } = e {
                        for r in rejections {
                            sink.lock().unwrap().push(format!("{}:{}", r.event_id, r.reason));
                        }
                    }
                }))),
                ..Default::default()
            }),
        )
    }

    #[tokio::test]
    async fn accepted_batch_posts_once_and_reports_nothing() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/telemetry/events"))
            .respond_with(ResponseTemplate::new(202).set_body_json(
                serde_json::json!({"accepted": 1, "rejected": 0, "batch_id": "b"}),
            ))
            .expect(1)
            .mount(&server)
            .await;
        let errors = Arc::new(StdMutex::new(Vec::new()));
        let tracker = tracker_for(&server, errors.clone());
        tracker.send_batch(vec![event("e1")]).await.unwrap();
        assert!(errors.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn retry_reuses_batch_and_event_ids() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/telemetry/events"))
            .respond_with(ResponseTemplate::new(503))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/telemetry/events"))
            .respond_with(ResponseTemplate::new(202))
            .mount(&server)
            .await;
        let errors = Arc::new(StdMutex::new(Vec::new()));
        let tracker = tracker_for(&server, errors.clone());
        tracker.send_batch(vec![event("e1")]).await.unwrap();

        let requests = server.received_requests().await.unwrap();
        assert_eq!(requests.len(), 2);
        let first: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
        let second: serde_json::Value = serde_json::from_slice(&requests[1].body).unwrap();
        assert_eq!(first["batch_id"], second["batch_id"]);
        assert_eq!(first["events"][0]["event_id"], second["events"][0]["event_id"]);
    }

    #[tokio::test]
    async fn partial_accept_reports_each_rejection_without_retry() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/telemetry/events"))
            .respond_with(ResponseTemplate::new(207).set_body_json(serde_json::json!({
                "accepted": 1,
                "rejected": 1,
                "batch_id": "b",
                "rejections": [{"event_id": "e2", "reason": "license_id is required"}]
            })))
            .expect(1)
            .mount(&server)
            .await;
        let errors = Arc::new(StdMutex::new(Vec::new()));
        let tracker = tracker_for(&server, errors.clone());
        tracker.track(TrackEvent {
            metric: "m".to_string(),
            quantity: 1.0,
            license_id: "l".to_string(),
            ..Default::default()
        })
        .await;
        tracker.flush().await;
        assert_eq!(
            *errors.lock().unwrap(),
            vec!["e2:license_id is required".to_string()]
        );
    }

    #[test]
    fn absurd_retry_after_values_are_clamped_not_panicking() {
        for header in ["1e30", "1e308", "340282366920938463463374607431768211456", "inf", "NaN", "-5"] {
            let _ = parse_retry_after(Some(header));
        }
        assert_eq!(parse_retry_after(Some("1e30")), Some(MAX_RETRY_AFTER));
    }

    #[tokio::test]
    async fn malformed_partial_accept_body_is_reported_without_resend() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/telemetry/events"))
            .respond_with(ResponseTemplate::new(207).set_body_json(serde_json::json!({
                "accepted": "abc", "rejected": null, "rejections": [1, "x", {"event_id": 5}]
            })))
            .expect(1)
            .mount(&server)
            .await;
        let errors = Arc::new(StdMutex::new(Vec::new()));
        let tracker = tracker_for(&server, errors);
        let result = tracker.send_batch(vec![event("e1")]).await;
        assert!(matches!(result, Err(DoowError::PartialAccept { .. })));
    }

    #[tokio::test]
    async fn oversized_response_bodies_are_truncated_while_streaming() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/telemetry/events"))
            .respond_with(ResponseTemplate::new(400).set_body_string("x".repeat(MAX_BODY_BYTES + 4096)))
            .expect(1)
            .mount(&server)
            .await;
        let errors = Arc::new(StdMutex::new(Vec::new()));
        let tracker = tracker_for(&server, errors);
        let result = tracker.send_batch(vec![event("e1")]).await;
        assert!(matches!(result, Err(DoowError::Api { status: 400, .. })));
    }

    #[test]
    fn blank_source_system_defaults_to_sdk() {
        let mut e = event("e1");
        e.source_system = Some("  ".to_string());
        let json = serde_json::to_value(build_payload("b1", &[e])).unwrap();
        assert_eq!(json["events"][0]["source_system"], "sdk");
    }

    #[test]
    fn retry_after_is_clamped_and_garbage_ignored() {
        assert_eq!(parse_retry_after(Some("2")), Some(Duration::from_secs(2)));
        assert_eq!(parse_retry_after(Some("86400")), Some(MAX_RETRY_AFTER));
        assert_eq!(parse_retry_after(Some("garbage")), None);
        assert_eq!(parse_retry_after(None), None);
    }

    #[test]
    fn server_text_is_sanitized_and_truncated() {
        let cleaned = sanitize_text(&format!("line1\nline2\u{1b}[31m{}", "x".repeat(2000)));
        assert!(!cleaned.contains('\n') && !cleaned.contains('\u{1b}'));
        assert!(cleaned.chars().count() <= 520);
    }

    #[tokio::test]
    async fn permanent_client_error_is_not_retried() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/telemetry/events"))
            .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({"message": "bad"})))
            .expect(1)
            .mount(&server)
            .await;
        let errors = Arc::new(StdMutex::new(Vec::new()));
        let tracker = tracker_for(&server, errors);
        let result = tracker.send_batch(vec![event("e1")]).await;
        assert!(matches!(result, Err(DoowError::Api { status: 400, .. })));
    }

    #[tokio::test]
    async fn rate_limited_batch_waits_for_retry_after_and_retries_the_same_batch() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/telemetry/events"))
            .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "1"))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/telemetry/events"))
            .respond_with(ResponseTemplate::new(202))
            .mount(&server)
            .await;
        let errors = Arc::new(StdMutex::new(Vec::new()));
        let tracker = tracker_for(&server, errors);

        let started = std::time::Instant::now();
        tracker.send_batch(vec![event("e1")]).await.unwrap();

        assert!(started.elapsed() >= Duration::from_millis(900));
        let requests = server.received_requests().await.unwrap();
        assert_eq!(requests.len(), 2);
        let first: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
        let second: serde_json::Value = serde_json::from_slice(&requests[1].body).unwrap();
        assert_eq!(first["batch_id"], second["batch_id"]);
    }

    #[test]
    fn every_5xx_and_408_is_retryable_but_other_4xx_is_not() {
        for status in [408u16, 429, 500, 502, 503, 504, 520, 522, 524] {
            assert!(DoowError::api(status, "x", None).is_retryable(), "{status}");
        }
        for status in [400u16, 401, 403, 404, 413, 422] {
            assert!(!DoowError::api(status, "x", None).is_retryable(), "{status}");
        }
    }

    #[tokio::test]
    async fn a_panicking_error_handler_does_not_unwind_into_the_caller() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/telemetry/events"))
            .respond_with(ResponseTemplate::new(207).set_body_json(serde_json::json!({
                "accepted": 0, "rejected": 1, "batch_id": "b",
                "rejections": [{"event_id": "e", "reason": "bad"}]
            })))
            .expect(1)
            .mount(&server)
            .await;
        let tracker = Tracker::new(
            "dk_test",
            Some(TrackerOptions {
                endpoint: server.uri(),
                retry_count: 2,
                flush_at: 1000,
                on_error: Some(ErrorHandler(Arc::new(|_| panic!("handler failure")))),
                ..Default::default()
            }),
        );
        tracker
            .track(TrackEvent {
                metric: "m".to_string(),
                quantity: 1.0,
                license_id: "l".to_string(),
                ..Default::default()
            })
            .await;
        tracker.flush().await;
    }
}
