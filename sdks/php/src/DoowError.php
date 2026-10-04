<?php

declare(strict_types=1);

namespace Doow\Track;

use Exception;

class DoowError extends Exception
{
    public function __construct(
        public readonly int $status,
        string $message,
        public readonly ?string $errorClass = null,
        public readonly array $details = [],
        public readonly ?float $retryAfterSeconds = null,
    ) {
        parent::__construct("doow: " . self::sanitize($message) . " (status={$status})");
    }

    public static function sanitize(mixed $value): string
    {
        $raw = (string) (is_scalar($value) ? $value : json_encode($value));
        $text = (string) preg_replace('/\p{Cc}/u', ' ', mb_scrub($raw, 'UTF-8'));

        return mb_strlen($text) > 512 ? mb_substr($text, 0, 512) . '...' : $text;
    }

    public function isNotFound(): bool
    {
        return $this->status === 404;
    }

    public function isUnauthorized(): bool
    {
        return $this->status === 401;
    }

    public function isForbidden(): bool
    {
        return $this->status === 403;
    }

    public function isRateLimited(): bool
    {
        return $this->status === 429;
    }

    public function isServerError(): bool
    {
        return $this->status >= 500;
    }

    public function isRetryable(): bool
    {
        return $this->status === 0 || $this->status === 408 || $this->status === 429 || $this->status >= 500;
    }
}
