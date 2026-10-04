"""Error types for Doow SDK."""

from typing import Any, Optional


class DoowError(Exception):
    """Base exception for Doow SDK."""

    pass


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
        rejections = data.get("rejections")
        return cls(
            accepted=int(data.get("accepted") or 0),
            rejected=int(data.get("rejected") or 0),
            batch_id=str(data.get("batch_id") or ""),
            rejections=rejections if isinstance(rejections, list) else [],
        )


class ValidationError(DoowError):
    """Input validation error."""

    pass


class ConfigurationError(DoowError):
    """SDK configuration error."""

    pass
