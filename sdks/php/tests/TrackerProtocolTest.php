<?php

declare(strict_types=1);

namespace Doow\Track\Tests;

use Doow\Track\MetricTupleHint;
use Doow\Track\PartialAcceptError;
use Doow\Track\TrackEvent;
use Doow\Track\Tracker\Tracker;
use Doow\Track\Tracker\TrackerOptions;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\TestCase;

final class TrackerProtocolTest extends TestCase
{
    private array $history = [];
    private array $errors = [];

    private function tracker(array $responses, int $retryCount = 2): Tracker
    {
        $this->history = [];
        $this->errors = [];
        $stack = HandlerStack::create(new MockHandler($responses));
        $stack->push(Middleware::history($this->history));

        return new Tracker('dk_test', new TrackerOptions(
            flushAt: 1000,
            retryCount: $retryCount,
            onError: function (\Throwable $e): void {
                $this->errors[] = $e;
            },
            httpClient: new Client(['handler' => $stack]),
        ));
    }

    private function event(): TrackEvent
    {
        return new TrackEvent(
            metric: 'api_calls',
            quantity: 1.0,
            licenseId: 'lic_1',
            metricTupleHint: new MetricTupleHint('app', 'lic', 'calls'),
        );
    }

    private function body(int $index): array
    {
        $raw = (string) $this->history[$index]['request']->getBody();
        $request = $this->history[$index]['request'];
        if ($request->getHeaderLine('Content-Encoding') === 'gzip') {
            $raw = gzdecode($raw);
        }

        return json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    }

    public function testBatchEnvelopeAndSnakeCaseTupleHint(): void
    {
        $tracker = $this->tracker([new Response(202, [], '{"accepted":1,"rejected":0}')]);
        $tracker->track($this->event());
        $tracker->flush();

        $body = $this->body(0);
        $this->assertNotEmpty($body['batch_id']);
        $this->assertNotEmpty($body['sdk_version']);
        $event = $body['events'][0];
        $this->assertNotEmpty($event['event_id']);
        $this->assertSame('lic_1', $event['license_id']);
        $this->assertSame('sdk', $event['source_system']);
        $this->assertSame(
            ['app_name' => 'app', 'license_name' => 'lic', 'metric_name' => 'calls'],
            $event['measurements'][0]['metric_tuple_hint'],
        );
        $this->assertSame([], $this->errors);
    }

    public function testPartialAcceptReportsEachRejectionWithoutRetry(): void
    {
        $tracker = $this->tracker([new Response(207, [], json_encode([
            'accepted' => 1,
            'rejected' => 1,
            'batch_id' => 'b',
            'rejections' => [['event_id' => 'evt-x', 'reason' => 'license_id is required']],
        ]))]);
        $tracker->track($this->event());
        $tracker->flush();

        $this->assertCount(1, $this->history);
        $this->assertCount(1, $this->errors);
        $this->assertInstanceOf(PartialAcceptError::class, $this->errors[0]);
        $this->assertSame('evt-x', $this->errors[0]->rejections[0]['event_id']);
    }

    public function testRetryKeepsTheBatchId(): void
    {
        $tracker = $this->tracker([new Response(503), new Response(202)]);
        $tracker->track($this->event());
        $tracker->flush();

        $this->assertCount(2, $this->history);
        $this->assertSame($this->body(0)['batch_id'], $this->body(1)['batch_id']);
        $this->assertSame([], $this->errors);
    }

    public function testLargeBodiesAreRealGzip(): void
    {
        $tracker = $this->tracker([new Response(202)]);
        for ($i = 0; $i < 300; $i++) {
            $tracker->track($this->event());
        }
        $tracker->flush();

        $this->assertSame('gzip', $this->history[0]['request']->getHeaderLine('Content-Encoding'));
        $this->assertCount(300, $this->body(0)['events']);
    }
}
