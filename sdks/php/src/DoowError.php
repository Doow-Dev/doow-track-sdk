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
    ) {
        parent::__construct("doow: {$message} (status={$status})");
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
        return in_array($this->status, [429, 500, 502, 503, 504], true);
    }
}
