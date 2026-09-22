package co.doow.track.management;

import com.fasterxml.jackson.core.type.TypeReference;

public class AppsResource {
    private final Management mgmt;

    AppsResource(Management mgmt) {
        this.mgmt = mgmt;
    }

    public Models.PaginatedResponse<Models.App> list() {
        return list(null, 50);
    }

    public Models.PaginatedResponse<Models.App> list(String cursor, int limit) {
        String path = "/apps?limit=" + limit;
        if (cursor != null && !cursor.isEmpty()) {
            path += "&cursor=" + cursor;
        }
        return mgmt.request("GET", path, null,
            mgmt.getMapper().getTypeFactory().constructParametricType(
                Models.PaginatedResponse.class, Models.App.class));
    }

    public Models.App get(String id) {
        return mgmt.request("GET", "/apps/" + id, null, Models.App.class);
    }

    public Models.App create(Models.CreateAppInput input) {
        return mgmt.request("POST", "/apps", input, Models.App.class);
    }

    public Models.App update(String id, Models.UpdateAppInput input) {
        return mgmt.request("PATCH", "/apps/" + id, input, Models.App.class);
    }

    public void delete(String id) {
        mgmt.delete("/apps/" + id);
    }
}
