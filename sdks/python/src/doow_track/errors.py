"""Error types for Doow SDK."""

from typing import Any, Optional


class DoowError(Exception):
    """Base exception for Doow SDK."""

    pass


MAX_ERROR_TEXT = 512


def sanitize_text(value: Any) -> str:
    """Strip control characters and cap server-supplied text before it enters a message."""
    text = "".join(" " if (ord(ch) < 32 or ord(ch) == 127) else ch for ch in str(value))
    return text if len(text) <= MAX_ERROR_TEXT else text[:MAX_ERROR_TEXT] + "..."


def _to_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


class APIError(DoowError):
    """API error response."""

    def __init__(
        self,
        status: int,
        message: str,
        error_class: Optional[str] = None,
        details: Optional[dict] = None,
    ):
        self.status = status
        message = sanitize_text(message)
        self.message = message
        self.error_class = error_class
        self.details = details or {}
        super().__init__(f"doow: {message} (status={status})")

    def is_not_found(self) -> bool:
        return self.status == 404

    def is_unauthorized(self) -> bool:
        return self.status == 401

    def is_forbidden(self) -> bool:
        return self.status == 403

    def is_rate_limited(self) -> bool:
        return self.status == 429

    def is_server_error(self) -> bool:
        return self.status >= 500

    def is_retryable(self) -> bool:
        return self.status in (429, 500, 502, 503, 504)


class PartialAcceptError(DoowError):
    """HTTP 207: some events in the batch were rejected.

    The batch id is already recorded server side, so the batch is not retried.
    """

    def __init__(
        self,
        accepted: int,
        rejected: int,
        batch_id: str,
        rejections: list[dict],
    ):
        self.accepted = accepted
        self.rejected = rejected
        self.batch_id = batch_id
        self.rejections = rejections
        first = f" ({rejections[0].get('event_id')}: {rejections[0].get('reason')})" if rejections else ""
        super().__init__(f"doow: batch {batch_id} partially accepted: {rejected} rejected{first}")

    @classmethod
    def from_response(cls, response: Any) -> "PartialAcceptError":
        try:
            data = response.json()
        except Exception:
            data = {}
        if not isinstance(data, dict):
            data = {}
        raw = data.get("rejections")
        rejections = [
            {
                "event_id": sanitize_text(r.get("event_id", "unknown")),
                "reason": sanitize_text(r.get("reason", "")),
            }
            for r in (raw if isinstance(raw, list) else [])
            if isinstance(r, dict)
        ]
        return cls(
            accepted=_to_int(data.get("accepted")),
            rejected=_to_int(data.get("rejected")),
            batch_id=sanitize_text(data.get("batch_id") or ""),
            rejections=rejections,
        )


class ValidationError(DoowError):
    """Input validation error."""

    pass


class ConfigurationError(DoowError):
    """SDK configuration error."""

    pass
