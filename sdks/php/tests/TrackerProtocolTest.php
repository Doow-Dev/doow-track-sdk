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

    private function tracker(array $responses, int $retryCount = 2, int $flushAt = 1000): Tracker
    {
        $this->history = [];
        $this->errors = [];
        $stack = HandlerStack::create(new MockHandler($responses));
        $stack->push(Middleware::history($this->history));

        return new Tracker('dk_test', new TrackerOptions(
            flushAt: $flushAt,
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
        $this->assertSame($this->body(0)['events'][0]['event_id'], $this->body(1)['events'][0]['event_id']);
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

    public function testAFlushOfMoreThan500EventsSendsChunksOfAtMost500WithDistinctBatchIds(): void
    {
        $tracker = $this->tracker(
            [new Response(202), new Response(202), new Response(202)],
            0,
            5000,
        );
        for ($i = 0; $i < 1200; $i++) {
            $tracker->track($this->event());
        }
        $tracker->flush();

        $this->assertCount(3, $this->history);
        $sizes = array_map(fn ($i) => count($this->body($i)['events']), [0, 1, 2]);
        $this->assertSame([500, 500, 200], $sizes);
        $batchIds = array_map(fn ($i) => $this->body($i)['batch_id'], [0, 1, 2]);
        $this->assertCount(3, array_unique($batchIds));
        $eventIds = [];
        foreach ([0, 1, 2] as $i) {
            foreach ($this->body($i)['events'] as $event) {
                $eventIds[] = $event['event_id'];
            }
        }
        $this->assertCount(1200, array_unique($eventIds));
        $this->assertSame([], $this->errors);
    }

    public function testATransientFailureRequeuesThatChunkAndEveryLaterChunk(): void
    {
        $tracker = $this->tracker(
            [new Response(202), new Response(503)],
            0,
            5000,
        );
        for ($i = 0; $i < 1200; $i++) {
            $tracker->track($this->event());
        }
        $tracker->flush();

        $this->assertCount(2, $this->history);
        $this->assertCount(1, $this->errors);
        $failedChunk = array_map(fn ($e) => $e['event_id'], $this->body(1)['events']);

        $buffer = (new \ReflectionProperty($tracker, 'buffer'))->getValue($tracker);
        $this->assertCount(700, $buffer);
        $this->assertSame($failedChunk, array_map(fn ($e) => $e['event_id'], array_slice($buffer, 0, 500)));
        $this->assertGreaterThan(microtime(true), (new \ReflectionProperty($tracker, 'holdUntil'))->getValue($tracker));
    }

    public function testATransientFailureHoldsCountTriggeredFlushes(): void
    {
        $tracker = $this->tracker([new Response(202)], 0, 2);
        (new \ReflectionProperty($tracker, 'holdUntil'))->setValue($tracker, microtime(true) + 100);
        $tracker->track($this->event());
        $tracker->track($this->event());

        $this->assertCount(0, $this->history);
        $buffer = (new \ReflectionProperty($tracker, 'buffer'))->getValue($tracker);
        $this->assertCount(2, $buffer);
        (new \ReflectionProperty($tracker, 'buffer'))->setValue($tracker, []);
    }

    public function testLaterChunksAreStillSentAfterAChunkFailsPermanently(): void
    {
        $tracker = $this->tracker(
            [new Response(400, [], '{"message":"bad"}'), new Response(202)],
            0,
            5000,
        );
        for ($i = 0; $i < 700; $i++) {
            $tracker->track($this->event());
        }
        $tracker->flush();

        $this->assertCount(2, $this->history);
        $this->assertCount(1, $this->errors);
    }

    public function testPermanentClientErrorIsReportedOnceAndNotRetried(): void
    {
        $tracker = $this->tracker([new Response(400, [], '{"message":"bad"}')], 3);
        $tracker->track($this->event());
        $tracker->flush();

        $this->assertCount(1, $this->history);
        $this->assertCount(1, $this->errors);
        $this->assertSame(400, $this->errors[0]->status);
    }

    public function testBlankSourceSystemDefaultsToSdk(): void
    {
        $tracker = $this->tracker([new Response(202)]);
        $tracker->track(new TrackEvent(metric: 'm', quantity: 1.0, licenseId: 'l', sourceSystem: ' '));
        $tracker->flush();

        $this->assertSame('sdk', $this->body(0)['events'][0]['source_system']);
    }

    public function testAThrowingOnErrorHandlerNeverEscapesFlush(): void
    {
        $stack = HandlerStack::create(new MockHandler([new Response(400, [], '{"message":"bad"}')]));
        $tracker = new Tracker('dk_test', new TrackerOptions(
            flushAt: 1000,
            onError: function (\Throwable $e): void {
                throw new \RuntimeException('handler failure');
            },
            httpClient: new Client(['handler' => $stack]),
        ));
        $tracker->track($this->event());
        $tracker->flush();

        $this->assertTrue(true);
    }

    public function testMalformedPartialAcceptBodyIsReportedWithoutResend(): void
    {
        $tracker = $this->tracker([new Response(207, [], json_encode([
            'accepted' => 'abc',
            'rejected' => null,
            'rejections' => [1, 'x', ['event_id' => 5]],
        ]))]);
        $tracker->track($this->event());
        $tracker->flush();

        $this->assertCount(1, $this->history);
        $this->assertInstanceOf(PartialAcceptError::class, $this->errors[0]);
    }

    public function testTransportFailuresAreWrappedSoTheRequestIsNotExposed(): void
    {
        $stack = HandlerStack::create(new MockHandler([
            new \GuzzleHttp\Exception\ConnectException('boom', new \GuzzleHttp\Psr7\Request('POST', 'https://x', ['Authorization' => 'Bearer dk_test'])),
        ]));
        $errors = [];
        $tracker = new Tracker('dk_test', new TrackerOptions(
            flushAt: 1000,
            retryCount: 0,
            onError: function (\Throwable $e) use (&$errors): void {
                $errors[] = $e;
            },
            httpClient: new Client(['handler' => $stack]),
        ));
        $tracker->track($this->event());
        $tracker->flush();

        $this->assertCount(1, $errors);
        $this->assertInstanceOf(\Doow\Track\DoowError::class, $errors[0]);
        $this->assertStringNotContainsString('dk_test', $errors[0]->getMessage());
        $this->assertNull($errors[0]->getPrevious());
    }

    public function testRateLimitedBatchWaitsForRetryAfterAndRetriesTheSameBatch(): void
    {
        $tracker = $this->tracker([new Response(429, ['Retry-After' => '1']), new Response(202)], 1);
        $tracker->track($this->event());
        $started = microtime(true);
        $tracker->flush();
        $elapsed = microtime(true) - $started;

        $this->assertCount(2, $this->history);
        $this->assertGreaterThanOrEqual(0.9, $elapsed);
        $this->assertSame($this->body(0)['batch_id'], $this->body(1)['batch_id']);
        $this->assertSame([], $this->errors);
    }

    public function testInFlightUnavailableBatchWaitsForRetryAfterAndRetriesTheSameBatch(): void
    {
        $tracker = $this->tracker([new Response(503, ['Retry-After' => '1']), new Response(202)], 1);
        $tracker->track($this->event());
        $started = microtime(true);
        $tracker->flush();
        $elapsed = microtime(true) - $started;

        $this->assertCount(2, $this->history);
        $this->assertGreaterThanOrEqual(0.9, $elapsed);
        $this->assertSame($this->body(0)['batch_id'], $this->body(1)['batch_id']);
        $this->assertSame([], $this->errors);
    }

    public function testTheClientStreamsResponsesInsteadOfBufferingThem(): void
    {
        $options = [];
        $handler = HandlerStack::create(new MockHandler([new Response(202)]));
        $handler->push(function (callable $next) use (&$options) {
            return function ($request, array $requestOptions) use ($next, &$options) {
                $options = $requestOptions;

                return $next($request, $requestOptions);
            };
        });
        $tracker = new Tracker('dk_test', new TrackerOptions(
            flushAt: 1000,
            httpClient: new Client(['handler' => $handler]),
        ));
        $tracker->track($this->event());
        $tracker->flush();

        $this->assertTrue($options['stream'] ?? false);
    }

    public function testRetryAfterIsClampedAndGarbageIgnored(): void
    {
        $this->assertSame(2.0, Tracker::parseRetryAfter('2'));
        $this->assertSame(30.0, Tracker::parseRetryAfter('86400'));
        $this->assertNull(Tracker::parseRetryAfter('garbage'));
        $this->assertNull(Tracker::parseRetryAfter(''));
    }

    public function testServerTextIsSanitizedAndTruncated(): void
    {
        $cleaned = \Doow\Track\DoowError::sanitize("line1\nline2\x1b[31m\u{9b}31m" . str_repeat('x', 2000));
        $this->assertStringNotContainsString("\n", $cleaned);
        $this->assertStringNotContainsString("\u{9b}", $cleaned);
        $this->assertLessThanOrEqual(520, mb_strlen($cleaned));
    }

    public function testAnyServerErrorStatusIsRetryable(): void
    {
        foreach ([408, 429, 500, 502, 503, 504, 520, 522] as $status) {
            $this->assertTrue((new \Doow\Track\DoowError($status, 'x'))->isRetryable(), (string) $status);
        }
        foreach ([400, 401, 403, 404, 413, 422] as $status) {
            $this->assertFalse((new \Doow\Track\DoowError($status, 'x'))->isRetryable(), (string) $status);
        }
    }

    public function testInvalidUtf8InServerTextDoesNotEmptyTheMessage(): void
    {
        $cleaned = \Doow\Track\DoowError::sanitize("bad\xff\xfebytes");
        $this->assertStringContainsString('bad', $cleaned);
        $this->assertStringContainsString('bytes', $cleaned);
    }

    public function testAnEndlessBodyIsReadOnlyUpToTheCap(): void
    {
        $served = 0;
        $endless = \GuzzleHttp\Psr7\Utils::streamFor(function (int $size) use (&$served) {
            $chunk = str_repeat('x', min($size, 8192));
            $served += strlen($chunk);

            return $chunk;
        });
        $tracker = $this->tracker([new Response(400, [], $endless)], 0);
        $tracker->track($this->event());
        $tracker->flush();

        $this->assertCount(1, $this->errors);
        $this->assertLessThanOrEqual(600, mb_strlen($this->errors[0]->getMessage()));
        $this->assertGreaterThanOrEqual(1048576, $served);
        $this->assertLessThanOrEqual(1048576 + 8192, $served);
    }
}
