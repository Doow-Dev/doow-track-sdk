using Xunit;
using DoowTrack;

namespace DoowTrack.E2E;

public class E2ETests
{
    private readonly string _apiKey;
    private readonly string _endpoint;

    public E2ETests()
    {
        _apiKey = Environment.GetEnvironmentVariable("DOOW_TRACK_API_KEY")
            ?? throw new Exception("DOOW_TRACK_API_KEY required");
        _endpoint = Environment.GetEnvironmentVariable("DOOW_TRACK_ENDPOINT")
            ?? "https://dev-api.doow.co";
    }

    [Fact]
    public async Task FullWorkflow_CreateTrackCleanup()
    {
        var mgmt = new Management(_apiKey, new ManagementOptions { Endpoint = _endpoint });

        // 1. Create App
        var app = await mgmt.Apps().CreateAsync(new CreateAppInput
        {
            Name = $"DotNet E2E Test {DateTime.UtcNow:yyyyMMddHHmmss}",
            Description = "Automated test"
        });
        Assert.NotNull(app.Id);
        Console.WriteLine($"Created app: {app.Id}");

        try
        {
            // 2. Create Contract with License
            var contract = await mgmt.Contracts().CreateAsync(app.Id, new CreateContractInput
            {
                Title = "Test Contract",
                ContractType = ContractType.PayAsYouGo,
                Licenses = new()
                {
                    new LicenseInput { Name = "Test License", LicenseType = LicenseType.UsageBased }
                }
            });
            Assert.NotNull(contract.Id);
            Assert.NotEmpty(contract.Licenses);
            Console.WriteLine($"Created contract: {contract.Id}");

            var licenseId = contract.Licenses[0].Id;
            Console.WriteLine($"License: {licenseId}");

            // 3. Create Metric
            var metric = await mgmt.Metrics().CreateAsync(licenseId, new CreateMetricInput
            {
                MetricType = "dotnet_e2e_calls"
            });
            Assert.NotNull(metric.Id);
            Console.WriteLine($"Created metric: {metric.Id}");

            // 4. Track Events
            var tracker = new Tracker(_apiKey, new TrackerOptions
            {
                Endpoint = _endpoint,
                Debug = true,
                FlushAt = 1
            });

            for (int i = 1; i <= 3; i++)
            {
                tracker.Track(new TrackEvent
                {
                    Metric = "dotnet_e2e_calls",
                    Quantity = i * 10,
                    LicenseId = licenseId,
                    Unit = "calls"
                });
            }
            await tracker.ShutdownAsync();
            Console.WriteLine("Tracked 3 events");

            // 5. Verify resources
            var fetchedApp = await mgmt.Apps().GetAsync(app.Id);
            Assert.Equal(app.Name, fetchedApp.Name);

            var fetchedContract = await mgmt.Contracts().GetAsync(contract.Id);
            Assert.Equal(contract.Title, fetchedContract.Title);

            var fetchedLicense = await mgmt.Licenses().GetAsync(licenseId);
            Assert.Equal(licenseId, fetchedLicense.Id);

            Console.WriteLine("All resources verified");

            // 6. Cleanup - delete metric first
            await mgmt.Metrics().DeleteAsync(metric.Id);
            Console.WriteLine($"Deleted metric: {metric.Id}");

            // Delete contract
            await mgmt.Contracts().DeleteAsync(contract.Id);
            Console.WriteLine($"Deleted contract: {contract.Id}");
        }
        finally
        {
            // Always cleanup app
            await mgmt.Apps().DeleteAsync(app.Id);
            Console.WriteLine($"Deleted app: {app.Id}");
        }

        Console.WriteLine("E2E test passed!");
    }
}
