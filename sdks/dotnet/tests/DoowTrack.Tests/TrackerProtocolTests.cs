using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.Json;
using DoowTrack;
using Xunit;

namespace DoowTrack.Tests;

public class TrackerProtocolTests
{
    private sealed class StubHandler : HttpMessageHandler
    {
        private readonly Queue<(int Status, string Body)> _responses;
        public List<(JsonElement Body, string? Encoding)> Requests { get; } = new();

        public StubHandler(params (int, string)[] responses) => _responses = new(responses);

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var raw = await request.Content!.ReadAsByteArrayAsync(ct);
            var encoding = request.Content.Headers.ContentEncoding.FirstOrDefault();
            if (encoding == "gzip")
            {
                using var gz = new GZipStream(new MemoryStream(raw), CompressionMode.Decompress);
                using var output = new MemoryStream();
                await gz.CopyToAsync(output, ct);
                raw = output.ToArray();
            }
            Requests.Add((JsonDocument.Parse(raw).RootElement.Clone(), encoding));
            var (status, body) = _responses.Count > 1 ? _responses.Dequeue() : _responses.Peek();
            return new HttpResponseMessage((HttpStatusCode)status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        }
    }

    private sealed class ThrowingHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            throw new InvalidOperationException("handler exploded");
    }

    private static (Tracker Tracker, List<Exception> Errors) Create(StubHandler handler, int retryCount = 1)
    {
        var errors = new List<Exception>();
        var tracker = new Tracker("dk_test", new TrackerOptions
        {
            Endpoint = "https://test.doow.co",
            FlushIntervalMs = 0,
            FlushAt = 1000,
            RetryCount = retryCount,
            OnError = errors.Add,
            HttpHandler = handler,
        });
        return (tracker, errors);
    }

    private static TrackEvent Event() => new()
    {
        Metric = "api_calls",
        Quantity = 1,
        LicenseId = "lic_1",
        MetricTupleHint = new MetricTupleHint { AppName = "app", LicenseName = "lic", MetricName = "calls" },
    };

    [Fact]
    public async Task SendsBatchEnvelopeWithObjectTupleHint()
    {
        var handler = new StubHandler((202, "{}"));
        var (tracker, errors) = Create(handler);
        tracker.Track(Event());
        await tracker.FlushAsync();

        var body = handler.Requests.Single().Body;
        Assert.False(string.IsNullOrEmpty(body.GetProperty("batch_id").GetString()));
        Assert.False(string.IsNullOrEmpty(body.GetProperty("sdk_version").GetString()));
        var evt = body.GetProperty("events")[0];
        Assert.False(string.IsNullOrEmpty(evt.GetProperty("event_id").GetString()));
        Assert.True(evt.TryGetProperty("occurred_at", out _));
        Assert.Equal("lic_1", evt.GetProperty("license_id").GetString());
        Assert.Equal("sdk", evt.GetProperty("source_system").GetString());
        var measurement = evt.GetProperty("measurements")[0];
        Assert.Equal("api_calls", measurement.GetProperty("metric_name").GetString());
        var hint = measurement.GetProperty("metric_tuple_hint");
        Assert.Equal("app", hint.GetProperty("app_name").GetString());
        Assert.Equal("lic", hint.GetProperty("license_name").GetString());
        Assert.Equal("calls", hint.GetProperty("metric_name").GetString());
        Assert.Empty(errors);
    }

    [Fact]
    public async Task PartialAcceptReportsEachRejectionWithoutRetry()
    {
        var handler = new StubHandler((207,
            "{\"accepted\":1,\"rejected\":1,\"batch_id\":\"b\",\"rejections\":[{\"event_id\":\"evt-x\",\"reason\":\"license_id is required\"}]}"));
        var (tracker, errors) = Create(handler);
        tracker.Track(Event());
        await tracker.FlushAsync();

        Assert.Single(handler.Requests);
        var error = Assert.IsType<PartialAcceptError>(Assert.Single(errors));
        Assert.Equal("evt-x", error.Rejections[0].EventId);
        Assert.Equal("license_id is required", error.Rejections[0].Reason);
    }

    [Fact]
    public async Task ClientErrorIsReportedNotThrown()
    {
        var handler = new StubHandler((400, "bad"));
        var (tracker, errors) = Create(handler);
        tracker.Track(Event());
        await tracker.FlushAsync();

        Assert.Single(handler.Requests);
        Assert.Equal(400, Assert.IsType<DoowError>(Assert.Single(errors)).StatusCode);
    }

    [Fact]
    public async Task UnexpectedExceptionsReachOnErrorInsteadOfEscaping()
    {
        var errors = new List<Exception>();
        var tracker = new Tracker("dk_test", new TrackerOptions
        {
            Endpoint = "https://test.doow.co",
            FlushIntervalMs = 0,
            RetryCount = 1,
            OnError = errors.Add,
            HttpHandler = new ThrowingHandler(),
        });
        tracker.Track(Event());
        await tracker.FlushAsync();

        Assert.IsType<InvalidOperationException>(Assert.Single(errors));
    }

    [Fact]
    public async Task RetryReusesTheBatchId()
    {
        var handler = new StubHandler((503, "{}"), (202, "{}"));
        var (tracker, errors) = Create(handler);
        tracker.Track(Event());
        await tracker.FlushAsync();

        Assert.Equal(2, handler.Requests.Count);
        Assert.Equal(
            handler.Requests[0].Body.GetProperty("batch_id").GetString(),
            handler.Requests[1].Body.GetProperty("batch_id").GetString());
        Assert.Equal(
            handler.Requests[0].Body.GetProperty("events")[0].GetProperty("event_id").GetString(),
            handler.Requests[1].Body.GetProperty("events")[0].GetProperty("event_id").GetString());
        Assert.Empty(errors);
    }

    [Fact]
    public async Task LargeBodiesAreRealGzip()
    {
        var handler = new StubHandler((202, "{}"));
        var (tracker, _) = Create(handler);
        for (var i = 0; i < 300; i++) tracker.Track(Event());
        await tracker.FlushAsync();

        var request = handler.Requests.Single();
        Assert.Equal("gzip", request.Encoding);
        Assert.Equal(300, request.Body.GetProperty("events").GetArrayLength());
    }

    [Fact]
    public async Task OccurredAtIsIso8601()
    {
        var handler = new StubHandler((202, "{}"));
        var (tracker, _) = Create(handler);
        tracker.Track(Event());
        await tracker.FlushAsync();

        var occurredAt = handler.Requests.Single().Body.GetProperty("events")[0].GetProperty("occurred_at").GetString();
        Assert.True(DateTimeOffset.TryParse(occurredAt, out _));
        Assert.Matches(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", occurredAt!);
    }

    [Fact]
    public async Task ThrowingOnErrorHandlerDoesNotResendARecordedPartialBatch()
    {
        var handler = new StubHandler((207, "{\"accepted\":0,\"rejected\":1,\"batch_id\":\"b\",\"rejections\":[{\"event_id\":\"e\",\"reason\":\"bad\"}]}"));
        var tracker = new Tracker("dk_test", new TrackerOptions
        {
            Endpoint = "https://test.doow.co",
            FlushIntervalMs = 0,
            RetryCount = 2,
            OnError = _ => throw new InvalidOperationException("handler failure"),
            HttpHandler = handler,
        });
        tracker.Track(Event());
        await tracker.FlushAsync();

        Assert.Single(handler.Requests);
    }

    [Fact]
    public async Task MalformedPartialAcceptBodyIsReportedWithoutResend()
    {
        var handler = new StubHandler((207, "{\"accepted\":\"abc\",\"rejected\":null,\"rejections\":[1,\"x\",{\"event_id\":5}]}"));
        var (tracker, errors) = Create(handler);
        tracker.Track(Event());
        await tracker.FlushAsync();

        Assert.Single(handler.Requests);
        Assert.IsType<PartialAcceptError>(Assert.Single(errors));
    }

    [Fact]
    public void SanitizeStripsControlCharactersAndTruncates()
    {
        var cleaned = Tracker.Sanitize("line1\nline2\u001b[31m" + new string('x', 2000));
        Assert.DoesNotContain('\n', cleaned);
        Assert.DoesNotContain('\u001b', cleaned);
        Assert.True(cleaned.Length <= 520);
    }

    private sealed class RateLimitedThenOkHandler : HttpMessageHandler
    {
        public List<JsonElement> Bodies { get; } = new();

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Bodies.Add(JsonDocument.Parse(await request.Content!.ReadAsByteArrayAsync(ct)).RootElement.Clone());
            if (Bodies.Count == 1)
            {
                var limited = new HttpResponseMessage(HttpStatusCode.TooManyRequests) { Content = new StringContent("{}") };
                limited.Headers.RetryAfter = new System.Net.Http.Headers.RetryConditionHeaderValue(TimeSpan.FromSeconds(2));
                return limited;
            }
            return new HttpResponseMessage(HttpStatusCode.Accepted) { Content = new StringContent("{}") };
        }
    }

    [Fact]
    public async Task RateLimitedBatchWaitsForRetryAfterAndRetriesTheSameBatch()
    {
        var handler = new RateLimitedThenOkHandler();
        var errors = new List<Exception>();
        var tracker = new Tracker("dk_test", new TrackerOptions
        {
            Endpoint = "https://test.doow.co",
            FlushIntervalMs = 0,
            RetryCount = 1,
            OnError = errors.Add,
            HttpHandler = handler,
        });
        tracker.Track(Event());
        var started = DateTime.UtcNow;
        await tracker.FlushAsync();
        var elapsed = DateTime.UtcNow - started;

        Assert.Equal(2, handler.Bodies.Count);
        Assert.True(elapsed >= TimeSpan.FromMilliseconds(1900), $"retried after {elapsed}, before the 2s Retry-After");
        Assert.Equal(
            handler.Bodies[0].GetProperty("batch_id").GetString(),
            handler.Bodies[1].GetProperty("batch_id").GetString());
        Assert.Empty(errors);
    }

    [Fact]
    public void RetryAfterIsClamped()
    {
        var response = new HttpResponseMessage(HttpStatusCode.TooManyRequests);
        response.Headers.RetryAfter = new System.Net.Http.Headers.RetryConditionHeaderValue(TimeSpan.FromHours(24));
        Assert.Equal(TimeSpan.FromSeconds(30), Tracker.ParseRetryAfter(response));

        response.Headers.RetryAfter = new System.Net.Http.Headers.RetryConditionHeaderValue(TimeSpan.FromSeconds(2));
        Assert.Equal(TimeSpan.FromSeconds(2), Tracker.ParseRetryAfter(response));

        Assert.Equal(TimeSpan.Zero, Tracker.ParseRetryAfter(new HttpResponseMessage(HttpStatusCode.TooManyRequests)));
    }

    [Fact]
    public async Task UnserializableAttributionIsReportedNotThrown()
    {
        var handler = new StubHandler((202, "{}"));
        var (tracker, errors) = Create(handler);
        var cyclic = new Dictionary<string, object>();
        cyclic["self"] = cyclic;
        tracker.Track(Event() with { Attribution = cyclic });
        await tracker.FlushAsync();

        Assert.Empty(handler.Requests);
        Assert.Single(errors);
    }

    private sealed class EndlessContent : HttpContent
    {
        public long BytesServed;
        private readonly bool _stallAfterFirstChunk;

        public EndlessContent(bool stallAfterFirstChunk = false) => _stallAfterFirstChunk = stallAfterFirstChunk;

        protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) =>
            throw new NotSupportedException();

        protected override bool TryComputeLength(out long length)
        {
            length = -1;
            return false;
        }

        protected override Task<Stream> CreateContentReadStreamAsync() => Task.FromResult<Stream>(new EndlessStream(this));

        private sealed class EndlessStream : Stream
        {
            private readonly EndlessContent _owner;
            private bool _firstRead = true;

            public EndlessStream(EndlessContent owner) => _owner = owner;

            public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
            {
                if (_owner._stallAfterFirstChunk && !_firstRead)
                {
                    await Task.Delay(Timeout.Infinite, cancellationToken);
                }
                _firstRead = false;
                var count = Math.Min(buffer.Length, 4096);
                buffer.Span[..count].Fill((byte)'x');
                _owner.BytesServed += count;
                return count;
            }

            public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
            public override bool CanRead => true;
            public override bool CanSeek => false;
            public override bool CanWrite => false;
            public override long Length => throw new NotSupportedException();
            public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
            public override void Flush() { }
            public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
            public override void SetLength(long value) => throw new NotSupportedException();
            public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        }
    }

    private sealed class FixedResponseHandler : HttpMessageHandler
    {
        private readonly Func<HttpResponseMessage> _response;
        public int Calls;

        public FixedResponseHandler(Func<HttpResponseMessage> response) => _response = response;

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Calls++;
            return Task.FromResult(_response());
        }
    }

    [Fact]
    public async Task OversizedErrorBodiesStopBeingReadAtTheCap()
    {
        var content = new EndlessContent();
        var handler = new FixedResponseHandler(() => new HttpResponseMessage(HttpStatusCode.BadRequest) { Content = content });
        var errors = new List<Exception>();
        var tracker = new Tracker("dk_test", new TrackerOptions
        {
            Endpoint = "https://test.doow.co",
            FlushIntervalMs = 0,
            RetryCount = 0,
            OnError = errors.Add,
            HttpHandler = handler,
        });
        tracker.Track(Event());
        await tracker.FlushAsync();

        var error = Assert.IsType<DoowError>(Assert.Single(errors));
        Assert.True(error.Message.Length <= 540);
        Assert.InRange(content.BytesServed, 1, (1 << 20) + 8192);
    }

    [Fact]
    public async Task AStalledResponseBodyIsCutOffByTheRequestTimeout()
    {
        var handler = new FixedResponseHandler(
            () => new HttpResponseMessage(HttpStatusCode.BadRequest) { Content = new EndlessContent(stallAfterFirstChunk: true) });
        var errors = new List<Exception>();
        var tracker = new Tracker("dk_test", new TrackerOptions
        {
            Endpoint = "https://test.doow.co",
            FlushIntervalMs = 0,
            RetryCount = 0,
            TimeoutMs = 500,
            OnError = errors.Add,
            HttpHandler = handler,
        });
        tracker.Track(Event());

        var flush = tracker.FlushAsync();
        var finished = await Task.WhenAny(flush, Task.Delay(TimeSpan.FromSeconds(5)));

        Assert.Same(flush, finished);
        Assert.Single(errors);
    }
}
