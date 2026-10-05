using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace DoowTrack;

public class TrackerOptions
{
    public string Endpoint { get; init; } = "https://api.doow.co";
    public bool Enabled { get; init; } = true;
    public bool Debug { get; init; } = false;
    public int FlushAt { get; init; } = 20;
    public int FlushIntervalMs { get; init; } = 10000;
    public int MaxQueueSize { get; init; } = 10000;
    public int TimeoutMs { get; init; } = 10000;
    public int RetryCount { get; init; } = 3;
    public bool DisableCompression { get; init; } = false;
    public Dictionary<string, object>? Attribution { get; init; }
    public Action<Exception>? OnError { get; init; }
    public HttpMessageHandler? HttpHandler { get; init; }
}

public class Tracker : IDisposable
{
    private readonly string _apiKey;
    private readonly TrackerOptions _options;
    private readonly HttpClient _httpClient;
    private const string SdkVersion = "0.1.1";
    private const int MaxBatchEvents = 500;

    private readonly List<Pending> _buffer = new();
    private readonly object _lock = new();
    private readonly Timer? _flushTimer;
    private readonly JsonSerializerOptions _jsonOptions;
    private bool _disposed;
    private DateTime _holdUntil = DateTime.MinValue;

    public Tracker(string apiKey, TrackerOptions? options = null)
    {
        _apiKey = Environment.GetEnvironmentVariable("DOOW_TRACK_API_KEY") ?? apiKey;
        _options = options ?? new TrackerOptions();

        if (string.IsNullOrEmpty(_apiKey) || !_apiKey.StartsWith("dk_"))
        {
            throw new DoowError("Invalid API key format. Must start with 'dk_'.");
        }

        _httpClient = new HttpClient(_options.HttpHandler ?? new HttpClientHandler())
        {
            Timeout = TimeSpan.FromMilliseconds(_options.TimeoutMs)
        };
        _httpClient.DefaultRequestHeaders.Add("Authorization", $"Bearer {_apiKey}");

        _jsonOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };
        _jsonOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseUpper));

        if (_options.FlushIntervalMs > 0)
        {
            _flushTimer = new Timer(_ => _ = FlushAsync(), null, _options.FlushIntervalMs, _options.FlushIntervalMs);
        }
    }

    public void Track(TrackEvent evt)
    {
        if (!_options.Enabled) return;

        var finalEvent = evt with
        {
            Timestamp = evt.Timestamp ?? DateTimeOffset.UtcNow,
            Attribution = MergeAttribution(evt.Attribution)
        };

        lock (_lock)
        {
            if (_buffer.Count >= _options.MaxQueueSize)
            {
                if (_options.Debug)
                {
                    Console.Error.WriteLine("[doow-track] Queue full, dropping event");
                }
                return;
            }
            _buffer.Add(new Pending(Guid.NewGuid().ToString(), finalEvent));

            if (_buffer.Count >= _options.FlushAt && DateTime.UtcNow >= _holdUntil)
            {
                _ = FlushAsync();
            }
        }
    }

    internal record Pending(string EventId, TrackEvent Event);

    internal static object BuildPayload(string batchId, IEnumerable<Pending> batch) => new
    {
        batch_id = batchId,
        sdk_version = SdkVersion,
        events = batch.Select(p => new WireEvent
        {
            EventId = p.EventId,
            LicenseId = p.Event.LicenseId,
            OccurredAt = p.Event.Timestamp ?? DateTimeOffset.UtcNow,
            SourceSystem = string.IsNullOrWhiteSpace(p.Event.SourceSystem) ? "sdk" : p.Event.SourceSystem,
            Kind = p.Event.Kind,
            Unit = p.Event.Unit,
            Attribution = p.Event.Attribution,
            Metadata = p.Event.Metadata,
            Measurements = new[]
            {
                new WireMeasurement
                {
                    MetricName = p.Event.Metric,
                    Quantity = p.Event.Quantity,
                    MetricTupleHint = p.Event.MetricTupleHint,
                }
            }
        }).ToList()
    };

    internal record WireMeasurement
    {
        public required string MetricName { get; init; }
        public double Quantity { get; init; }
        public MetricTupleHint? MetricTupleHint { get; init; }
    }

    internal record WireEvent
    {
        public required string EventId { get; init; }
        public required string LicenseId { get; init; }
        public DateTimeOffset OccurredAt { get; init; }
        public required string SourceSystem { get; init; }
        public EventKind Kind { get; init; }
        public string? Unit { get; init; }
        public Dictionary<string, object>? Attribution { get; init; }
        public Dictionary<string, object>? Metadata { get; init; }
        public required WireMeasurement[] Measurements { get; init; }
    }

    public async Task FlushAsync()
    {
        List<Pending> pending;
        lock (_lock)
        {
            if (_buffer.Count == 0) return;
            pending = new List<Pending>(_buffer);
            _buffer.Clear();
        }

        for (var start = 0; start < pending.Count; start += MaxBatchEvents)
        {
            var retryLater = await SendBatchAsync(pending.GetRange(start, Math.Min(MaxBatchEvents, pending.Count - start)));
            if (retryLater)
            {
                Requeue(pending.GetRange(start, pending.Count - start));
                _holdUntil = DateTime.UtcNow.AddMilliseconds(_options.FlushIntervalMs);
                return;
            }
        }
    }

    private void Requeue(List<Pending> events)
    {
        if (_disposed || events.Count == 0) return;
        lock (_lock)
        {
            _buffer.InsertRange(0, events);
            if (_buffer.Count > _options.MaxQueueSize)
            {
                _buffer.RemoveRange(_options.MaxQueueSize, _buffer.Count - _options.MaxQueueSize);
            }
        }
    }

    private async Task<bool> SendBatchAsync(List<Pending> batch)
    {
        var batchId = Guid.NewGuid().ToString();
        byte[] body;
        bool gzipped;
        try
        {
            var jsonBytes = JsonSerializer.SerializeToUtf8Bytes(BuildPayload(batchId, batch), _jsonOptions);
            gzipped = !_options.DisableCompression && jsonBytes.Length > 1024;
            body = jsonBytes;
            if (gzipped)
            {
                using var memoryStream = new MemoryStream();
                using (var gzipStream = new GZipStream(memoryStream, CompressionMode.Compress))
                {
                    gzipStream.Write(jsonBytes);
                }
                body = memoryStream.ToArray();
            }
        }
        catch (Exception e)
        {
            Report(e);
            return false;
        }

        var url = $"{_options.Endpoint.TrimEnd('/')}/telemetry/events";

        for (int attempt = 0; attempt <= _options.RetryCount; attempt++)
        {
            var lastAttempt = attempt >= _options.RetryCount;
            try
            {
                var content = new ByteArrayContent(body);
                content.Headers.ContentType = new("application/json");
                if (gzipped) content.Headers.Add("Content-Encoding", "gzip");

                using var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = content };
                using var attemptTimeout = new CancellationTokenSource(TimeSpan.FromMilliseconds(_options.TimeoutMs));
                using var response = await _httpClient.SendAsync(
                    request,
                    HttpCompletionOption.ResponseHeadersRead,
                    attemptTimeout.Token);
                var status = (int)response.StatusCode;
                string responseBody;
                try
                {
                    responseBody = await ReadBoundedAsync(response, attemptTimeout.Token);
                }
                catch (Exception readFailure) when (readFailure is IOException or HttpRequestException or OperationCanceledException)
                {
                    responseBody = string.Empty;
                }

                if (status == 207)
                {
                    Report(ParsePartialAccept(responseBody, batchId));
                    return false;
                }

                if (response.IsSuccessStatusCode)
                {
                    if (_options.Debug)
                    {
                        Console.Error.WriteLine($"[doow-track] Flushed {batch.Count} events");
                    }
                    return false;
                }

                if ((status == 429 || status >= 500) && !lastAttempt)
                {
                    var backoff = TimeSpan.FromSeconds(Math.Pow(2, attempt));
                    if (status is 429 or 503) backoff = TimeSpan.FromTicks(Math.Max(backoff.Ticks, ParseRetryAfter(response).Ticks));
                    await Task.Delay(backoff);
                    continue;
                }

                Report(new DoowError($"API error: {Sanitize(responseBody)}", status));
                return status == 429 || status >= 500;
            }
            catch (Exception e) when (e is not HttpRequestException and not TaskCanceledException)
            {
                Report(e);
                return false;
            }
            catch (Exception e)
            {
                if (lastAttempt)
                {
                    Report(e);
                    return true;
                }
                if (_options.Debug)
                {
                    Console.Error.WriteLine($"[doow-track] Retry {attempt + 1}/{_options.RetryCount}: {e.Message}");
                }
                await Task.Delay((int)Math.Pow(2, attempt) * 1000);
            }
        }

        return false;
    }

    private static PartialAcceptError ParsePartialAccept(string body, string fallbackBatchId)
    {
        int accepted = 0, rejected = 0;
        var batchId = fallbackBatchId;
        var rejections = new List<EventRejection>();
        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            if (root.TryGetProperty("accepted", out var a) && a.TryGetInt32(out var ai)) accepted = ai;
            if (root.TryGetProperty("rejected", out var r) && r.TryGetInt32(out var ri)) rejected = ri;
            if (root.TryGetProperty("batch_id", out var b) && b.ValueKind == JsonValueKind.String) batchId = Sanitize(b.GetString()!);
            if (root.TryGetProperty("rejections", out var list) && list.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in list.EnumerateArray())
                {
                    rejections.Add(new EventRejection(
                        Sanitize(item.TryGetProperty("event_id", out var id) ? AsText(id, "unknown") : "unknown"),
                        Sanitize(item.TryGetProperty("reason", out var reason) ? AsText(reason, "") : "")));
                }
            }
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException)
        {
        }
        return new PartialAcceptError(accepted, rejected, batchId, rejections);
    }

    private static string AsText(JsonElement element, string fallback) =>
        element.ValueKind == JsonValueKind.Null ? fallback : element.ToString();

    private const int MaxBodyChars = 1 << 20;
    private const int MaxErrorText = 512;
    private static readonly TimeSpan MaxRetryAfter = TimeSpan.FromSeconds(30);

    internal static async Task<string> ReadBoundedAsync(HttpResponseMessage response, CancellationToken cancellation)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(cancellation);
        using var reader = new StreamReader(stream, Encoding.UTF8);
        var buffer = new char[4096];
        var text = new StringBuilder();
        while (text.Length < MaxBodyChars)
        {
            var read = await reader.ReadAsync(buffer.AsMemory(0, Math.Min(buffer.Length, MaxBodyChars - text.Length)), cancellation);
            if (read == 0) break;
            text.Append(buffer, 0, read);
        }
        return text.ToString();
    }

    internal static string Sanitize(string? text)
    {
        if (string.IsNullOrEmpty(text)) return string.Empty;
        var cleaned = string.Create(text.Length, text, (span, source) =>
        {
            for (var i = 0; i < source.Length; i++) span[i] = char.IsControl(source[i]) ? ' ' : source[i];
        });
        return cleaned.Length > MaxErrorText ? cleaned[..MaxErrorText] + "..." : cleaned;
    }

    internal static TimeSpan ParseRetryAfter(HttpResponseMessage response)
    {
        var header = response.Headers.RetryAfter;
        TimeSpan delay;
        if (header?.Delta is { } delta) delay = delta;
        else if (header?.Date is { } date) delay = date - DateTimeOffset.UtcNow;
        else return TimeSpan.Zero;
        if (delay < TimeSpan.Zero) return TimeSpan.Zero;
        return delay > MaxRetryAfter ? MaxRetryAfter : delay;
    }

    private void Report(Exception error)
    {
        try
        {
            _options.OnError?.Invoke(error);
        }
        catch (Exception handlerError)
        {
            if (_options.Debug)
            {
                Console.Error.WriteLine($"[doow-track] OnError handler threw: {handlerError.Message}");
            }
        }
        if (_options.Debug)
        {
            Console.Error.WriteLine($"[doow-track] Error: {error.Message}");
        }
    }

    public async Task ShutdownAsync()
    {
        _flushTimer?.Dispose();
        await FlushAsync();
    }

    public void Shutdown()
    {
        ShutdownAsync().GetAwaiter().GetResult();
    }

    private Dictionary<string, object>? MergeAttribution(Dictionary<string, object>? eventAttribution)
    {
        if (_options.Attribution == null && eventAttribution == null) return null;
        if (_options.Attribution == null) return eventAttribution;
        if (eventAttribution == null) return _options.Attribution;

        var merged = new Dictionary<string, object>(_options.Attribution);
        foreach (var kvp in eventAttribution)
        {
            merged[kvp.Key] = kvp.Value;
        }
        return merged;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _flushTimer?.Dispose();
        _httpClient.Dispose();
        GC.SuppressFinalize(this);
    }
}
