package co.doow.track;

public class DoowError extends RuntimeException {
    private final int statusCode;
    private final String errorClass;

    public DoowError(String message) {
        this(message, 0, null);
    }

    public DoowError(String message, int statusCode) {
        this(message, statusCode, null);
    }

    public DoowError(String message, int statusCode, String errorClass) {
        super(message);
        this.statusCode = statusCode;
        this.errorClass = errorClass;
    }

    public int getStatusCode() { return statusCode; }
    public String getErrorClass() { return errorClass; }

    public boolean isNotFound() { return statusCode == 404; }
    public boolean isUnauthorized() { return statusCode == 401; }
    public boolean isForbidden() { return statusCode == 403; }
    public boolean isRateLimited() { return statusCode == 429; }
    public boolean isServerError() { return statusCode >= 500; }
}
