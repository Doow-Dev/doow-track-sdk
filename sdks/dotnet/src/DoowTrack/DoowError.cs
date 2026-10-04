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

public record EventRejection(string EventId, string Reason);

public class PartialAcceptError : DoowError
{
    public int Accepted { get; }
    public int Rejected { get; }
    public string BatchId { get; }
    public IReadOnlyList<EventRejection> Rejections { get; }

    public PartialAcceptError(int accepted, int rejected, string batchId, IReadOnlyList<EventRejection> rejections)
        : base(Describe(batchId, rejected, rejections), 207)
    {
        Accepted = accepted;
        Rejected = rejected;
        BatchId = batchId;
        Rejections = rejections;
    }

    private static string Describe(string batchId, int rejected, IReadOnlyList<EventRejection> rejections) =>
        $"batch {batchId} partially accepted: {rejected} rejected" +
        (rejections.Count > 0 ? $" ({rejections[0].EventId}: {rejections[0].Reason})" : "");
}
