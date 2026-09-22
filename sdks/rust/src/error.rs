//! Error types for Doow SDK.

use thiserror::Error;

/// Result type for Doow SDK operations
pub type Result<T> = std::result::Result<T, DoowError>;

/// Doow SDK error
#[derive(Debug, Error)]
pub enum DoowError {
    /// API error response
    #[error("doow: {message} (status={status})")]
    Api {
        status: u16,
        message: String,
        error_class: Option<String>,
    },

    /// HTTP request error
    #[error("doow: request failed: {0}")]
    Request(#[from] reqwest::Error),

    /// JSON serialization/deserialization error
    #[error("doow: JSON error: {0}")]
    Json(#[from] serde_json::Error),

    /// Configuration error
    #[error("doow: configuration error: {0}")]
    Configuration(String),

    /// Validation error
    #[error("doow: validation error: {0}")]
    Validation(String),

    /// IO error
    #[error("doow: IO error: {0}")]
    Io(#[from] std::io::Error),
}

impl DoowError {
    /// Create a new API error
    pub fn api(status: u16, message: impl Into<String>, error_class: Option<String>) -> Self {
        Self::Api {
            status,
            message: message.into(),
            error_class,
        }
    }

    /// Check if error is not found (404)
    pub fn is_not_found(&self) -> bool {
        matches!(self, Self::Api { status: 404, .. })
    }

    /// Check if error is unauthorized (401)
    pub fn is_unauthorized(&self) -> bool {
        matches!(self, Self::Api { status: 401, .. })
    }

    /// Check if error is forbidden (403)
    pub fn is_forbidden(&self) -> bool {
        matches!(self, Self::Api { status: 403, .. })
    }

    /// Check if error is rate limited (429)
    pub fn is_rate_limited(&self) -> bool {
        matches!(self, Self::Api { status: 429, .. })
    }

    /// Check if error is a server error (5xx)
    pub fn is_server_error(&self) -> bool {
        matches!(self, Self::Api { status, .. } if *status >= 500)
    }

    /// Check if error is retryable
    pub fn is_retryable(&self) -> bool {
        match self {
            Self::Api { status, .. } => matches!(status, 429 | 500 | 502 | 503 | 504),
            Self::Request(_) => true,
            _ => false,
        }
    }
}
