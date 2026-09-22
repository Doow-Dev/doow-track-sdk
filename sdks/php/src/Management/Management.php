<?php

declare(strict_types=1);

namespace Doow\Track\Management;

use Doow\Track\DoowError;
use Doow\Track\App;
use Doow\Track\Contract;
use Doow\Track\License;
use Doow\Track\Metric;
use Doow\Track\Expense;
use Doow\Track\PaginatedResponse;
use GuzzleHttp\Client;

class ManagementOptions
{
    public function __construct(
        public string $endpoint = 'https://api.doow.co',
        public int $timeoutMs = 30000,
        public bool $debug = false,
    ) {
        if ($env = getenv('DOOW_TRACK_ENDPOINT')) {
            $this->endpoint = $env;
        }
    }
}

class Management
{
    private const SDK_VERSION = '0.1.0';

    private string $apiKey;
    private ManagementOptions $options;
    private Client $client;

    public function __construct(string $apiKey, ?ManagementOptions $options = null)
    {
        $this->apiKey = getenv('DOOW_TRACK_API_KEY') ?: $apiKey;
        $this->options = $options ?? new ManagementOptions();

        $this->client = new Client([
            'timeout' => $this->options->timeoutMs / 1000,
        ]);
    }

    private function log(string $message): void
    {
        if ($this->options->debug) {
            fwrite(STDERR, "[doow/management] {$message}\n");
        }
    }

    private function request(string $method, string $path, ?array $body = null): array
    {
        $this->log("{$method} {$path}");

        $options = [
            'headers' => [
                'Authorization' => "Bearer {$this->apiKey}",
                'Content-Type' => 'application/json',
                'User-Agent' => 'doow-track-php/' . self::SDK_VERSION,
            ],
            'http_errors' => false,
        ];

        if ($body !== null) {
            $options['json'] = $body;
        }

        $response = $this->client->request(
            $method,
            "{$this->options->endpoint}{$path}",
            $options
        );

        $statusCode = $response->getStatusCode();
        $contents = $response->getBody()->getContents();

        if ($statusCode >= 400) {
            $data = json_decode($contents, true) ?? [];
            throw new DoowError(
                status: $statusCode,
                message: $data['message'] ?? 'Unknown error',
                errorClass: $data['errorClass'] ?? null,
                details: $data,
            );
        }

        if ($statusCode === 204 || empty($contents)) {
            return [];
        }

        return json_decode($contents, true) ?? [];
    }

    public function apps(): AppsResource
    {
        return new AppsResource($this);
    }

    public function contracts(): ContractsResource
    {
        return new ContractsResource($this);
    }

    public function licenses(): LicensesResource
    {
        return new LicensesResource($this);
    }

    public function metrics(): MetricsResource
    {
        return new MetricsResource($this);
    }

    public function expenses(): ExpensesResource
    {
        return new ExpensesResource($this);
    }

    public function get(string $path): array
    {
        return $this->request('GET', $path);
    }

    public function post(string $path, array $body): array
    {
        return $this->request('POST', $path, $body);
    }

    public function patch(string $path, array $body): array
    {
        return $this->request('PATCH', $path, $body);
    }

    public function delete(string $path): void
    {
        $this->request('DELETE', $path);
    }
}

class AppsResource
{
    public function __construct(private Management $client) {}

    public function list(int $limit = 25, ?string $cursor = null): PaginatedResponse
    {
        $query = "?limit={$limit}";
        if ($cursor) {
            $query .= "&cursor={$cursor}";
        }
        $data = $this->client->get("/sdk/apps{$query}");
        return new PaginatedResponse(
            data: array_map(fn($a) => App::fromArray($a), $data['data'] ?? []),
            nextCursor: $data['next_cursor'] ?? null,
            hasMore: $data['has_more'] ?? false,
        );
    }

    public function get(string $appId): App
    {
        $data = $this->client->get("/sdk/apps/{$appId}");
        return App::fromArray($data);
    }

    public function create(array $input): App
    {
        $data = $this->client->post('/sdk/apps', $input);
        return App::fromArray($data);
    }

    public function update(string $appId, array $input): App
    {
        $data = $this->client->patch("/sdk/apps/{$appId}", $input);
        return App::fromArray($data);
    }

    public function delete(string $appId): void
    {
        $this->client->delete("/sdk/apps/{$appId}");
    }
}

class ContractsResource
{
    public function __construct(private Management $client) {}

    public function list(string $appId, int $limit = 25, ?string $cursor = null): PaginatedResponse
    {
        $query = "?limit={$limit}";
        if ($cursor) {
            $query .= "&cursor={$cursor}";
        }
        $data = $this->client->get("/sdk/apps/{$appId}/contracts{$query}");
        return new PaginatedResponse(
            data: array_map(fn($c) => Contract::fromArray($c), $data['data'] ?? []),
            nextCursor: $data['next_cursor'] ?? null,
            hasMore: $data['has_more'] ?? false,
        );
    }

    public function get(string $contractId): Contract
    {
        $data = $this->client->get("/sdk/contracts/{$contractId}");
        return Contract::fromArray($data);
    }

    public function create(string $appId, array $input): Contract
    {
        $data = $this->client->post("/sdk/apps/{$appId}/contracts", $input);
        return Contract::fromArray($data);
    }

    public function update(string $contractId, array $input): Contract
    {
        $data = $this->client->patch("/sdk/contracts/{$contractId}", $input);
        return Contract::fromArray($data);
    }

    public function delete(string $contractId): void
    {
        $this->client->delete("/sdk/contracts/{$contractId}");
    }
}

class LicensesResource
{
    public function __construct(private Management $client) {}

    public function list(string $contractId, int $limit = 25, ?string $cursor = null): PaginatedResponse
    {
        $query = "?limit={$limit}";
        if ($cursor) {
            $query .= "&cursor={$cursor}";
        }
        $data = $this->client->get("/sdk/contracts/{$contractId}/licenses{$query}");
        return new PaginatedResponse(
            data: array_map(fn($l) => License::fromArray($l), $data['data'] ?? []),
            nextCursor: $data['next_cursor'] ?? null,
            hasMore: $data['has_more'] ?? false,
        );
    }

    public function get(string $licenseId): License
    {
        $data = $this->client->get("/sdk/licenses/{$licenseId}");
        return License::fromArray($data);
    }

    public function update(string $licenseId, array $input): License
    {
        $data = $this->client->patch("/sdk/licenses/{$licenseId}", $input);
        return License::fromArray($data);
    }

    public function delete(string $licenseId): void
    {
        $this->client->delete("/sdk/licenses/{$licenseId}");
    }
}

class MetricsResource
{
    public function __construct(private Management $client) {}

    public function list(string $licenseId, int $limit = 25, ?string $cursor = null): PaginatedResponse
    {
        $query = "?limit={$limit}";
        if ($cursor) {
            $query .= "&cursor={$cursor}";
        }
        $data = $this->client->get("/sdk/licenses/{$licenseId}/metrics{$query}");
        return new PaginatedResponse(
            data: array_map(fn($m) => Metric::fromArray($m), $data['data'] ?? []),
            nextCursor: $data['next_cursor'] ?? null,
            hasMore: $data['has_more'] ?? false,
        );
    }

    public function get(string $metricId): Metric
    {
        $data = $this->client->get("/sdk/metrics/{$metricId}");
        return Metric::fromArray($data);
    }

    public function create(string $licenseId, array $input): Metric
    {
        $data = $this->client->post("/sdk/licenses/{$licenseId}/metrics", $input);
        return Metric::fromArray($data);
    }

    public function update(string $metricId, array $input): Metric
    {
        $data = $this->client->patch("/sdk/metrics/{$metricId}", $input);
        return Metric::fromArray($data);
    }

    public function delete(string $metricId): void
    {
        $this->client->delete("/sdk/metrics/{$metricId}");
    }
}

class ExpensesResource
{
    public function __construct(private Management $client) {}

    public function list(
        int $limit = 25,
        ?string $cursor = null,
        ?string $appId = null,
        ?int $year = null,
        ?int $month = null,
    ): PaginatedResponse {
        $query = "?limit={$limit}";
        if ($cursor) $query .= "&cursor={$cursor}";
        if ($appId) $query .= "&app_id={$appId}";
        if ($year) $query .= "&year={$year}";
        if ($month) $query .= "&month={$month}";

        $data = $this->client->get("/sdk/expenses{$query}");
        return new PaginatedResponse(
            data: array_map(fn($e) => Expense::fromArray($e), $data['data'] ?? []),
            nextCursor: $data['next_cursor'] ?? null,
            hasMore: $data['has_more'] ?? false,
        );
    }

    public function get(string $expenseId): Expense
    {
        $data = $this->client->get("/sdk/expenses/{$expenseId}");
        return Expense::fromArray($data);
    }
}
