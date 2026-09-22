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
}

public class Tracker : IDisposable
{
    private readonly string _apiKey;
    private readonly TrackerOptions _options;
    private readonly HttpClient _httpClient;
    private readonly List<TrackEvent> _buffer = new();
    private readonly object _lock = new();
    private readonly Timer? _flushTimer;
    private readonly JsonSerializerOptions _jsonOptions;
    private bool _disposed;

    public Tracker(string apiKey, TrackerOptions? options = null)
    {
        _apiKey = Environment.GetEnvironmentVariable("DOOW_TRACK_API_KEY") ?? apiKey;
        _options = options ?? new TrackerOptions();

        if (string.IsNullOrEmpty(_apiKey) || !_apiKey.StartsWith("dk_"))
        {
            throw new DoowError("Invalid API key format. Must start with 'dk_'.");
        }

        _httpClient = new HttpClient
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
            _buffer.Add(finalEvent);

            if (_buffer.Count >= _options.FlushAt)
            {
                _ = FlushAsync();
            }
        }
    }

    public async Task FlushAsync()
    {
        List<TrackEvent> batch;
        lock (_lock)
        {
            if (_buffer.Count == 0) return;
            batch = new List<TrackEvent>(_buffer);
            _buffer.Clear();
        }

        var payload = new { events = batch };
        var json = JsonSerializer.Serialize(payload, _jsonOptions);
        var url = $"{_options.Endpoint.TrimEnd('/')}/telemetry/events";

        for (int attempt = 0; attempt <= _options.RetryCount; attempt++)
        {
            try
            {
                HttpContent content;
                var jsonBytes = Encoding.UTF8.GetBytes(json);

                if (!_options.DisableCompression && jsonBytes.Length > 1024)
                {
                    using var memoryStream = new MemoryStream();
                    using (var gzipStream = new GZipStream(memoryStream, CompressionMode.Compress))
                    {
                        gzipStream.Write(jsonBytes);
                    }
                    content = new ByteArrayContent(memoryStream.ToArray());
                    content.Headers.ContentType = new("application/json");
                    content.Headers.Add("Content-Encoding", "gzip");
                }
                else
                {
                    content = new StringContent(json, Encoding.UTF8, "application/json");
                }

                var response = await _httpClient.PostAsync(url, content);

                if (response.IsSuccessStatusCode)
                {
                    if (_options.Debug)
                    {
                        Console.Error.WriteLine($"[doow-track] Flushed {batch.Count} events");
                    }
                    return;
                }

                if ((int)response.StatusCode >= 500 && attempt < _options.RetryCount)
                {
                    await Task.Delay((int)Math.Pow(2, attempt) * 1000);
                    continue;
                }

                var errorBody = await response.Content.ReadAsStringAsync();
                throw new DoowError($"API error: {errorBody}", (int)response.StatusCode);
            }
            catch (HttpRequestException e) when (attempt < _options.RetryCount)
            {
                if (_options.Debug)
                {
                    Console.Error.WriteLine($"[doow-track] Retry {attempt + 1}/{_options.RetryCount}: {e.Message}");
                }
                await Task.Delay((int)Math.Pow(2, attempt) * 1000);
            }
            catch (Exception e) when (e is not DoowError)
            {
                _options.OnError?.Invoke(e);
                if (_options.Debug)
                {
                    Console.Error.WriteLine($"[doow-track] Error: {e.Message}");
                }
                return;
            }
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
