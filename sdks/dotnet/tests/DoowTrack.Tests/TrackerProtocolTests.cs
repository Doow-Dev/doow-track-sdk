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
}
