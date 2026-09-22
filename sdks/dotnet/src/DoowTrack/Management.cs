using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace DoowTrack;

public class ManagementOptions
{
    public string Endpoint { get; init; } = "https://api.doow.co";
    public int TimeoutMs { get; init; } = 30000;
    public int RetryCount { get; init; } = 3;
}

public class Management : IDisposable
{
    private readonly string _apiKey;
    private readonly ManagementOptions _options;
    private readonly HttpClient _httpClient;
    private readonly JsonSerializerOptions _jsonOptions;

    public Management(string apiKey, ManagementOptions? options = null)
    {
        _apiKey = Environment.GetEnvironmentVariable("DOOW_TRACK_API_KEY") ?? apiKey;
        _options = options ?? new ManagementOptions();

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
    }

    public AppsResource Apps() => new(this);
    public ContractsResource Contracts() => new(this);
    public LicensesResource Licenses() => new(this);
    public MetricsResource Metrics() => new(this);
    public ExpensesResource Expenses() => new(this);

    internal async Task<T> RequestAsync<T>(HttpMethod method, string path, object? body = null)
    {
        var url = $"{_options.Endpoint.TrimEnd('/')}/sdk{path}";

        for (int attempt = 0; attempt <= _options.RetryCount; attempt++)
        {
            try
            {
                var request = new HttpRequestMessage(method, url);

                if (body != null)
                {
                    var json = JsonSerializer.Serialize(body, _jsonOptions);
                    request.Content = new StringContent(json, Encoding.UTF8, "application/json");
                }

                var response = await _httpClient.SendAsync(request);

                if (response.IsSuccessStatusCode)
                {
                    var content = await response.Content.ReadAsStringAsync();
                    return JsonSerializer.Deserialize<T>(content, _jsonOptions)!;
                }

                if ((int)response.StatusCode >= 500 && attempt < _options.RetryCount)
                {
                    await Task.Delay((int)Math.Pow(2, attempt) * 1000);
                    continue;
                }

                var errorBody = await response.Content.ReadAsStringAsync();
                throw new DoowError($"API error: {errorBody}", (int)response.StatusCode);
            }
            catch (HttpRequestException) when (attempt < _options.RetryCount)
            {
                await Task.Delay((int)Math.Pow(2, attempt) * 1000);
            }
        }

        throw new DoowError("Max retries exceeded");
    }

    internal async Task DeleteAsync(string path)
    {
        var url = $"{_options.Endpoint.TrimEnd('/')}/sdk{path}";

        for (int attempt = 0; attempt <= _options.RetryCount; attempt++)
        {
            try
            {
                var response = await _httpClient.DeleteAsync(url);

                if (response.IsSuccessStatusCode || response.StatusCode == System.Net.HttpStatusCode.NoContent)
                {
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
            catch (HttpRequestException) when (attempt < _options.RetryCount)
            {
                await Task.Delay((int)Math.Pow(2, attempt) * 1000);
            }
        }
    }

    public void Dispose()
    {
        _httpClient.Dispose();
        GC.SuppressFinalize(this);
    }
}

public class AppsResource
{
    private readonly Management _mgmt;
    internal AppsResource(Management mgmt) => _mgmt = mgmt;

    public async Task<PaginatedResponse<App>> ListAsync(string? cursor = null, int limit = 50)
    {
        var path = $"/apps?limit={limit}";
        if (!string.IsNullOrEmpty(cursor)) path += $"&cursor={cursor}";
        return await _mgmt.RequestAsync<PaginatedResponse<App>>(HttpMethod.Get, path);
    }

    public async Task<App> GetAsync(string id) =>
        await _mgmt.RequestAsync<App>(HttpMethod.Get, $"/apps/{id}");

    public async Task<App> CreateAsync(CreateAppInput input) =>
        await _mgmt.RequestAsync<App>(HttpMethod.Post, "/apps", input);

    public async Task<App> UpdateAsync(string id, UpdateAppInput input) =>
        await _mgmt.RequestAsync<App>(HttpMethod.Patch, $"/apps/{id}", input);

    public async Task DeleteAsync(string id) =>
        await _mgmt.DeleteAsync($"/apps/{id}");
}

public class ContractsResource
{
    private readonly Management _mgmt;
    internal ContractsResource(Management mgmt) => _mgmt = mgmt;

    public async Task<PaginatedResponse<Contract>> ListAsync(string appId, string? cursor = null, int limit = 50)
    {
        var path = $"/apps/{appId}/contracts?limit={limit}";
        if (!string.IsNullOrEmpty(cursor)) path += $"&cursor={cursor}";
        return await _mgmt.RequestAsync<PaginatedResponse<Contract>>(HttpMethod.Get, path);
    }

    public async Task<Contract> GetAsync(string id) =>
        await _mgmt.RequestAsync<Contract>(HttpMethod.Get, $"/contracts/{id}");

    public async Task<Contract> CreateAsync(string appId, CreateContractInput input) =>
        await _mgmt.RequestAsync<Contract>(HttpMethod.Post, $"/apps/{appId}/contracts", input);

    public async Task DeleteAsync(string id) =>
        await _mgmt.DeleteAsync($"/contracts/{id}");
}

public class LicensesResource
{
    private readonly Management _mgmt;
    internal LicensesResource(Management mgmt) => _mgmt = mgmt;

    public async Task<PaginatedResponse<License>> ListAsync(string? cursor = null, int limit = 50)
    {
        var path = $"/licenses?limit={limit}";
        if (!string.IsNullOrEmpty(cursor)) path += $"&cursor={cursor}";
        return await _mgmt.RequestAsync<PaginatedResponse<License>>(HttpMethod.Get, path);
    }

    public async Task<License> GetAsync(string id) =>
        await _mgmt.RequestAsync<License>(HttpMethod.Get, $"/licenses/{id}");
}

public class MetricsResource
{
    private readonly Management _mgmt;
    internal MetricsResource(Management mgmt) => _mgmt = mgmt;

    public async Task<PaginatedResponse<Metric>> ListAsync(string licenseId, string? cursor = null, int limit = 50)
    {
        var path = $"/licenses/{licenseId}/metrics?limit={limit}";
        if (!string.IsNullOrEmpty(cursor)) path += $"&cursor={cursor}";
        return await _mgmt.RequestAsync<PaginatedResponse<Metric>>(HttpMethod.Get, path);
    }

    public async Task<Metric> GetAsync(string id) =>
        await _mgmt.RequestAsync<Metric>(HttpMethod.Get, $"/metrics/{id}");

    public async Task<Metric> CreateAsync(string licenseId, CreateMetricInput input) =>
        await _mgmt.RequestAsync<Metric>(HttpMethod.Post, $"/licenses/{licenseId}/metrics", input);

    public async Task DeleteAsync(string id) =>
        await _mgmt.DeleteAsync($"/metrics/{id}");
}

public class ExpensesResource
{
    private readonly Management _mgmt;
    internal ExpensesResource(Management mgmt) => _mgmt = mgmt;

    public async Task<PaginatedResponse<Expense>> ListAsync(string appId, string? cursor = null, int limit = 50)
    {
        var path = $"/apps/{appId}/expenses?limit={limit}";
        if (!string.IsNullOrEmpty(cursor)) path += $"&cursor={cursor}";
        return await _mgmt.RequestAsync<PaginatedResponse<Expense>>(HttpMethod.Get, path);
    }
}
