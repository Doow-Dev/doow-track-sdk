package doow

import "fmt"

// APIError represents an error from the Doow API
type APIError struct {
	Status  int                    `json:"status"`
	Message string                 `json:"message"`
	Code    string                 `json:"code,omitempty"`
	Details map[string]interface{} `json:"details,omitempty"`
}

func (e *APIError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("doow: %s (code=%s, status=%d)", e.Message, e.Code, e.Status)
	}
	return fmt.Sprintf("doow: %s (status=%d)", e.Message, e.Status)
}

// IsNotFound returns true if the error is a 404
func (e *APIError) IsNotFound() bool {
	return e.Status == 404
}

// IsUnauthorized returns true if the error is a 401
func (e *APIError) IsUnauthorized() bool {
	return e.Status == 401
}

// IsForbidden returns true if the error is a 403
func (e *APIError) IsForbidden() bool {
	return e.Status == 403
}

// IsRateLimited returns true if the error is a 429
func (e *APIError) IsRateLimited() bool {
	return e.Status == 429
}
