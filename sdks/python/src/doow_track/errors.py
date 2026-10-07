"""Error types for Doow SDK."""

import json
from typing import Any, Optional


class DoowError(Exception):
    """Base exception for Doow SDK."""

    pass


MAX_ERROR_TEXT = 512

_UNSAFE_FORMAT_CODES = frozenset(
    [0x061C, 0x200E, 0x200F, 0x2028, 0x2029, *range(0x202A, 0x202F), *range(0x2066, 0x206A)]
)


def _is_unsafe(char: str) -> bool:
    code = ord(char)
    return code < 32 or 127 <= code <= 159 or code in _UNSAFE_FORMAT_CODES


def sanitize_text(value: Any) -> str:
    """Strip control, bidirectional, and line-separator characters and cap server-supplied text."""
    text = "".join(" " if _is_unsafe(ch) else ch for ch in str(value))
    return text if len(text) <= MAX_ERROR_TEXT else text[:MAX_ERROR_TEXT] + "..."


MAX_DETAILS_DEPTH = 4


def sanitize_details(value: Any, depth: int = 0) -> Any:
    """Clean every server-supplied string in an error body before it is exposed on an error."""
    if isinstance(value, str):
        return sanitize_text(value)
    if depth >= MAX_DETAILS_DEPTH:
        return sanitize_text(value) if isinstance(value, (dict, list)) else value
    if isinstance(value, dict):
        return {
            (sanitize_text(k) if isinstance(k, str) else k): sanitize_details(v, depth + 1)
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [sanitize_details(v, depth + 1) for v in value]
    return value


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
        self.error_class = sanitize_text(error_class) if error_class is not None else None
        self.details = sanitize_details(details) if details else {}
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
        return self.status in (408, 429, 500, 502, 503, 504)


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
            return cls.from_data(response.json())
        except Exception:
            return cls.from_data({})

    @classmethod
    def from_body(cls, body: bytes) -> "PartialAcceptError":
        try:
            return cls.from_data(json.loads(body))
        except Exception:
            return cls.from_data({})

    @classmethod
    def from_data(cls, data: Any) -> "PartialAcceptError":
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
