<?php

declare(strict_types=1);

namespace Doow\Track;

use Exception;

class PartialAcceptError extends Exception
{
    /**
     * @param array<int, array{event_id: string, reason: string}> $rejections
     */
    public function __construct(
        public readonly int $accepted,
        public readonly int $rejected,
        public readonly string $batchId,
        public readonly array $rejections,
    ) {
        $first = $rejections[0] ?? null;
        $detail = $first ? " ({$first['event_id']}: {$first['reason']})" : '';
        parent::__construct("doow: batch {$batchId} partially accepted: {$rejected} rejected{$detail}", 207);
    }

    public static function fromBody(string $body, string $fallbackBatchId): self
    {
        $data = json_decode($body, true);
        $data = is_array($data) ? $data : [];
        $rejections = [];
        foreach (is_array($data['rejections'] ?? null) ? $data['rejections'] : [] as $rejection) {
            if (is_array($rejection)) {
                $rejections[] = [
                    'event_id' => (string) ($rejection['event_id'] ?? 'unknown'),
                    'reason' => (string) ($rejection['reason'] ?? ''),
                ];
            }
        }

        return new self(
            (int) ($data['accepted'] ?? 0),
            (int) ($data['rejected'] ?? 0),
            (string) ($data['batch_id'] ?? $fallbackBatchId),
            $rejections,
        );
    }
}
