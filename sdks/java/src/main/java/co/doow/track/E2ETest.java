package co.doow.track;

import co.doow.track.management.*;
import co.doow.track.tracker.*;
import co.doow.track.types.*;
import java.util.List;

public class E2ETest {
    public static void main(String[] args) {
        String apiKey = System.getenv("DOOW_TRACK_API_KEY");
        if (apiKey == null) {
            System.err.println("DOOW_TRACK_API_KEY required");
            System.exit(1);
        }

        Management mgmt = new Management(apiKey, new ManagementOptions().setDebug(true));

        // 1. Create App
        System.out.println("1. Creating App...");
        Models.CreateAppInput appInput = new Models.CreateAppInput("Java SDK Test " + System.currentTimeMillis());
        appInput.description = "E2E Test";
        Models.App app = mgmt.apps().create(appInput);
        System.out.println("   Created app: " + app.name + " (" + app.id + ")");

        try {
            // 2. Create Contract with License
            System.out.println("2. Creating Contract with License...");
            Models.CreateContractInput contractInput = new Models.CreateContractInput("Test Contract");
            contractInput.contractType = ContractType.PAY_AS_YOU_GO;
            contractInput.licenses = List.of(new Models.LicenseInput("API Usage", LicenseType.USAGE_BASED));
            Models.Contract contract = mgmt.contracts().create(app.id, contractInput);
            System.out.println("   Created contract: " + contract.title + " (" + contract.id + ")");

            String licenseId = contract.licenses.get(0).id;
            System.out.println("   License ID: " + licenseId);

            // 3. Create Metric
            System.out.println("3. Creating Metric...");
            Models.Metric metric = mgmt.metrics().create(licenseId, new Models.CreateMetricInput("java_sdk_calls"));
            System.out.println("   Created metric: " + metric.metricType + " (" + metric.id + ")");

            // 4. Track events
            System.out.println("4. Tracking events...");
            try (Tracker tracker = new Tracker(apiKey, new TrackerOptions().setDebug(true).setFlushAt(1))) {
                for (int i = 1; i <= 3; i++) {
                    tracker.track(TrackEvent.builder()
                        .metric("java_sdk_calls")
                        .quantity(i * 10)
                        .licenseId(licenseId)
                        .unit("calls")
                        .build());
                    System.out.println("   Tracked event " + i);
                }
            }

            // 5. Verify
            System.out.println("5. Verifying...");
            Models.Contract fetchedContract = mgmt.contracts().get(contract.id);
            System.out.println("   Contract: " + fetchedContract.title);

            Models.License fetchedLicense = mgmt.licenses().get(licenseId);
            System.out.println("   License: " + fetchedLicense.name);

            // 6. Cleanup
            System.out.println("6. Cleaning up...");
            mgmt.metrics().delete(metric.id);
            System.out.println("   Deleted metric");
            mgmt.contracts().delete(contract.id);
            System.out.println("   Deleted contract");

        } finally {
            mgmt.apps().delete(app.id);
            System.out.println("   Deleted app");
        }

        System.out.println("\n=== Java E2E Test PASSED ===");
    }
}
