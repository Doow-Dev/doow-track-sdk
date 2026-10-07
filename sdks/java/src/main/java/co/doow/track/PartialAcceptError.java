package co.doow.track;

import java.util.List;

public class PartialAcceptError extends DoowError {
    public static class Rejection {
        private final String eventId;
        private final String reason;

        public Rejection(String eventId, String reason) {
            this.eventId = eventId;
            this.reason = reason;
        }

        public String getEventId() { return eventId; }
        public String getReason() { return reason; }
    }

    private final int accepted;
    private final int rejected;
    private final String batchId;
    private final List<Rejection> rejections;

    public PartialAcceptError(int accepted, int rejected, String batchId, List<Rejection> rejections) {
        super(describe(batchId, rejected, rejections), 207);
        this.accepted = accepted;
        this.rejected = rejected;
        this.batchId = batchId;
        this.rejections = List.copyOf(rejections);
    }

    private static String describe(String batchId, int rejected, List<Rejection> rejections) {
        String detail = rejections.isEmpty()
            ? ""
            : " (" + rejections.get(0).getEventId() + ": " + rejections.get(0).getReason() + ")";
        return "batch " + batchId + " partially accepted: " + rejected + " rejected" + detail;
    }

    public int getAccepted() { return accepted; }
    public int getRejected() { return rejected; }
    public String getBatchId() { return batchId; }
    public List<Rejection> getRejections() { return rejections; }
}
