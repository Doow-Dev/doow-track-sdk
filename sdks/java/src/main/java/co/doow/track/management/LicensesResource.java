package co.doow.track.management;

public class LicensesResource {
    private final Management mgmt;

    LicensesResource(Management mgmt) {
        this.mgmt = mgmt;
    }

    public Models.PaginatedResponse<Models.License> list() {
        return list(null, 50);
    }

    public Models.PaginatedResponse<Models.License> list(String cursor, int limit) {
        String path = "/licenses?limit=" + limit;
        if (cursor != null && !cursor.isEmpty()) {
            path += "&cursor=" + cursor;
        }
        return mgmt.request("GET", path, null,
            mgmt.getMapper().getTypeFactory().constructParametricType(
                Models.PaginatedResponse.class, Models.License.class));
    }

    public Models.License get(String id) {
        return mgmt.request("GET", "/licenses/" + id, null, Models.License.class);
    }
}
