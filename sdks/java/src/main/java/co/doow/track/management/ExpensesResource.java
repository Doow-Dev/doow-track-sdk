package co.doow.track.management;

public class ExpensesResource {
    private final Management mgmt;

    ExpensesResource(Management mgmt) {
        this.mgmt = mgmt;
    }

    public Models.PaginatedResponse<Models.Expense> listByApp(String appId) {
        return listByApp(appId, null, 50);
    }

    public Models.PaginatedResponse<Models.Expense> listByApp(String appId, String cursor, int limit) {
        String path = "/apps/" + appId + "/expenses?limit=" + limit;
        if (cursor != null && !cursor.isEmpty()) {
            path += "&cursor=" + cursor;
        }
        return mgmt.request("GET", path, null,
            mgmt.getMapper().getTypeFactory().constructParametricType(
                Models.PaginatedResponse.class, Models.Expense.class));
    }
}
