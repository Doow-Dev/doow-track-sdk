package co.doow.track.management;

public class ContractsResource {
    private final Management mgmt;

    ContractsResource(Management mgmt) {
        this.mgmt = mgmt;
    }

    public Models.PaginatedResponse<Models.Contract> listByApp(String appId) {
        return listByApp(appId, null, 50);
    }

    public Models.PaginatedResponse<Models.Contract> listByApp(String appId, String cursor, int limit) {
        String path = "/apps/" + appId + "/contracts?limit=" + limit;
        if (cursor != null && !cursor.isEmpty()) {
            path += "&cursor=" + cursor;
        }
        return mgmt.request("GET", path, null,
            mgmt.getMapper().getTypeFactory().constructParametricType(
                Models.PaginatedResponse.class, Models.Contract.class));
    }

    public Models.Contract get(String id) {
        return mgmt.request("GET", "/contracts/" + id, null, Models.Contract.class);
    }

    public Models.Contract create(String appId, Models.CreateContractInput input) {
        return mgmt.request("POST", "/apps/" + appId + "/contracts", input, Models.Contract.class);
    }

    public void delete(String id) {
        mgmt.delete("/contracts/" + id);
    }
}
