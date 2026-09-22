package co.doow.track.management;

public class MetricsResource {
    private final Management mgmt;

    MetricsResource(Management mgmt) {
        this.mgmt = mgmt;
    }

    public Models.PaginatedResponse<Models.Metric> listByLicense(String licenseId) {
        return listByLicense(licenseId, null, 50);
    }

    public Models.PaginatedResponse<Models.Metric> listByLicense(String licenseId, String cursor, int limit) {
        String path = "/licenses/" + licenseId + "/metrics?limit=" + limit;
        if (cursor != null && !cursor.isEmpty()) {
            path += "&cursor=" + cursor;
        }
        return mgmt.request("GET", path, null,
            mgmt.getMapper().getTypeFactory().constructParametricType(
                Models.PaginatedResponse.class, Models.Metric.class));
    }

    public Models.Metric get(String id) {
        return mgmt.request("GET", "/metrics/" + id, null, Models.Metric.class);
    }

    public Models.Metric create(String licenseId, Models.CreateMetricInput input) {
        return mgmt.request("POST", "/licenses/" + licenseId + "/metrics", input, Models.Metric.class);
    }

    public void delete(String id) {
        mgmt.delete("/metrics/" + id);
    }
}
