<?php

declare(strict_types=1);

namespace Doow\Track\Tracker;

use Doow\Track\DoowError;
use Doow\Track\TrackEvent;
use Doow\Track\EventKind;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\GuzzleException;
use Ramsey\Uuid\Uuid;

class TrackerOptions
{
    public function __construct(
        public string $endpoint = 'https://api.doow.co',
        public bool $enabled = true,
        public bool $debug = false,
        public int $flushAt = 20,
        public int $flushIntervalMs = 10000,
        public int $maxQueueSize = 10000,
        public int $timeoutMs = 10000,
        public int $retryCount = 3,
        public bool $disableCompression = false,
        public array $attribution = [],
        public ?\Closure $onError = null,
    ) {
        // Environment overrides
        if ($env = getenv('DOOW_TRACK_ENDPOINT')) {
            $this->endpoint = $env;
        }
        if (getenv('DOOW_TRACK_DISABLED') === 'true') {
            $this->enabled = false;
        }
        if (getenv('DOOW_TRACK_DEBUG') === 'true') {
            $this->debug = true;
        }
        if ($env = getenv('DOOW_TRACK_FLUSH_AT')) {
            $this->flushAt = (int) $env;
        }
        if ($env = getenv('DOOW_TRACK_FLUSH_INTERVAL')) {
            $this->flushIntervalMs = (int) $env;
        }
    }
}

class Tracker
{
    private const SDK_VERSION = '0.1.0';

    private string $apiKey;
    private TrackerOptions $options;
    private Client $client;
    private array $buffer = [];

    public function __construct(string $apiKey, ?TrackerOptions $options = null)
    {
        $this->apiKey = getenv('DOOW_TRACK_API_KEY') ?: $apiKey;
        $this->options = $options ?? new TrackerOptions();

        $this->client = new Client([
            'timeout' => $this->options->timeoutMs / 1000,
        ]);
    }

    private function log(string $message): void
    {
        if ($this->options->debug) {
            fwrite(STDERR, "[doow/track] {$message}\n");
        }
    }

    public function track(TrackEvent $event): void
    {
        if (!$this->options->enabled) {
            return;
        }

        $timestamp = $event->timestamp?->format('c') ?? (new \DateTimeImmutable())->format('c');

        $attribution = array_merge($this->options->attribution, $event->attribution ?? []);

        $serialized = [
            'event_id' => Uuid::uuid4()->toString(),
            'metric' => $event->metric,
            'quantity' => $event->quantity,
            'license_id' => $event->licenseId,
            'unit' => $event->unit,
            'kind' => $event->kind->value,
            'timestamp' => $timestamp,
            'source_system' => $event->sourceSystem,
            'metric_tuple_hint' => $event->metricTupleHint,
            'attribution' => !empty($attribution) ? $attribution : null,
            'metadata' => $event->metadata,
        ];

        $this->buffer[] = $serialized;

        if (count($this->buffer) >= $this->options->maxQueueSize) {
            array_shift($this->buffer);
            $this->log('queue full, dropped oldest event');
        }

        if (count($this->buffer) >= $this->options->flushAt) {
            $this->flush();
        }
    }

    public function flush(): void
    {
        if (empty($this->buffer)) {
            return;
        }

        $events = $this->buffer;
        $this->buffer = [];

        try {
            $this->sendBatch($events);
        } catch (\Exception $e) {
            $this->log("flush error: {$e->getMessage()}");
            if ($this->options->onError) {
                ($this->options->onError)($e);
            }
        }
    }

    private function sendBatch(array $events): void
    {
        $batchId = Uuid::uuid4()->toString();

        $wireEvents = array_map(function ($e) {
            return [
                'event_id' => $e['event_id'],
                'license_id' => $e['license_id'],
                'occurred_at' => $e['timestamp'],
                'source_system' => $e['source_system'] ?? 'sdk',
                'kind' => $e['kind'],
                'attribution' => $e['attribution'],
                'metadata' => $e['metadata'],
                'measurements' => [[
                    'metric_name' => $e['metric'],
                    'quantity' => $e['quantity'],
                    'metric_tuple_hint' => $e['metric_tuple_hint'],
                ]],
            ];
        }, $events);

        $payload = [
            'batch_id' => $batchId,
            'sdk_version' => self::SDK_VERSION,
            'events' => $wireEvents,
        ];

        $body = json_encode($payload, JSON_THROW_ON_ERROR);
        $this->log("sending batch {$batchId} with " . count($events) . " events (" . strlen($body) . " bytes)");

        $lastError = null;

        for ($attempt = 0; $attempt <= $this->options->retryCount; $attempt++) {
            if ($attempt > 0) {
                $backoff = min(100 * (1 << ($attempt - 1)), 10000);
                usleep($backoff * 1000);
                $this->log("retry attempt {$attempt} after {$backoff}ms");
            }

            try {
                $this->doSend($body);
                $this->log("batch {$batchId} sent successfully");
                return;
            } catch (DoowError $e) {
                $lastError = $e;
                if (!$e->isRetryable()) {
                    throw $e;
                }
            } catch (GuzzleException $e) {
                $lastError = $e;
            }
        }

        if ($lastError) {
            throw $lastError;
        }
    }

    private function doSend(string $body): void
    {
        $headers = [
            'Authorization' => "Bearer {$this->apiKey}",
            'Content-Type' => 'application/json',
            'User-Agent' => 'doow-track-php/' . self::SDK_VERSION,
        ];

        $reqBody = $body;

        if (!$this->options->disableCompression && strlen($body) > 1024) {
            $compressed = gzencode($body);
            if ($compressed !== false) {
                $reqBody = $compressed;
                $headers['Content-Encoding'] = 'gzip';
            }
        }

        $response = $this->client->post(
            "{$this->options->endpoint}/telemetry/events",
            [
                'headers' => $headers,
                'body' => $reqBody,
                'http_errors' => false,
            ]
        );

        $statusCode = $response->getStatusCode();

        if ($statusCode >= 400) {
            $data = json_decode($response->getBody()->getContents(), true) ?? [];
            throw new DoowError(
                status: $statusCode,
                message: $data['message'] ?? 'Unknown error',
                errorClass: $data['errorClass'] ?? null,
                details: $data,
            );
        }
    }

    public function shutdown(): void
    {
        $this->flush();
    }
}
