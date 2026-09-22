namespace DoowTrack;

public class DoowError : Exception
{
    public int StatusCode { get; }
    public string? ErrorClass { get; }

    public DoowError(string message, int statusCode = 0, string? errorClass = null)
        : base(message)
    {
        StatusCode = statusCode;
        ErrorClass = errorClass;
    }

    public bool IsNotFound() => StatusCode == 404;
    public bool IsUnauthorized() => StatusCode == 401;
    public bool IsForbidden() => StatusCode == 403;
    public bool IsRateLimited() => StatusCode == 429;
    public bool IsServerError() => StatusCode >= 500;
}
