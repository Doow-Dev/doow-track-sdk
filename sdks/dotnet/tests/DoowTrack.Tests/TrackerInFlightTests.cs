using System.Net;
using DoowTrack;
using Xunit;

namespace DoowTrack.Tests;

public class TrackerInFlightTests
{
    private sealed class SlowHandler : HttpMessageHandler
    {
        public ManualResetEventSlim Started { get; } = new(false);
        public int Completed;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Started.Set();
            await Task.Delay(400, CancellationToken.None);
            Interlocked.Increment(ref Completed);
            return new HttpResponseMessage(HttpStatusCode.Accepted) { Content = new StringContent("{}") };
        }
    }

    private static Tracker EagerTracker(SlowHandler handler) => new("dk_test", new TrackerOptions
    {
        Endpoint = "https://test.doow.co",
        FlushIntervalMs = 0,
        FlushAt = 1,
        RetryCount = 0,
        HttpHandler = handler,
    });

    private static TrackEvent Event() => new() { Metric = "api_calls", Quantity = 1, LicenseId = "lic_1" };

    [Fact]
    public async Task FlushWaitsForACountTriggeredSendAlreadyInFlight()
    {
        var handler = new SlowHandler();
        var tracker = EagerTracker(handler);
        tracker.Track(Event());
        Assert.True(handler.Started.Wait(TimeSpan.FromSeconds(2)));

        await tracker.FlushAsync();

        Assert.Equal(1, handler.Completed);
    }

    [Fact]
    public async Task ShutdownWaitsForACountTriggeredSendAlreadyInFlight()
    {
        var handler = new SlowHandler();
        var tracker = EagerTracker(handler);
        tracker.Track(Event());
        Assert.True(handler.Started.Wait(TimeSpan.FromSeconds(2)));

        await tracker.ShutdownAsync();

        Assert.Equal(1, handler.Completed);
    }
}
