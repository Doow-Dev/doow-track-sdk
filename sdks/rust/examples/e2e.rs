use doow_track::{
    ContractType, CreateAppInput, CreateContractInput, CreateMetricInput, LicenseInput,
    LicenseType, Management, ManagementOptions, TrackEvent, Tracker, TrackerOptions,
};
use std::time::Duration;

#[tokio::main]
async fn main() -> doow_track::Result<()> {
    let api_key = "dk_91575a891025d3f95eb1e1a18080359100f34614e0a12c0398a3e8275ea4c044";
    let endpoint = "https://dev-api.doow.co";

    println!("=== End-to-End Rust SDK Test ===\n");

    let mgmt = Management::new(
        api_key,
        Some(ManagementOptions {
            endpoint: endpoint.to_string(),
            debug: true,
            ..Default::default()
        }),
    );

    // Step 1: Create an App
    println!("1. Creating App...");
    let app = mgmt
        .apps()
        .create(CreateAppInput {
            name: format!("Rust SDK Test App {}", chrono::Utc::now().timestamp()),
            description: Some("Created by Rust SDK E2E test".to_string()),
            ..Default::default()
        })
        .await?;
    println!("   Created app: {} ({})", app.name, app.id);

    // Step 2: Create Contract with License
    println!("\n2. Creating Contract with License...");
    let contract = mgmt
        .contracts()
        .create(
            &app.id,
            CreateContractInput {
                title: Some("Rust SDK Test Contract".to_string()),
                contract_type: ContractType::PayAsYouGo,
                licenses: vec![LicenseInput {
                    name: "API Usage License".to_string(),
                    license_type: LicenseType::UsageBased,
                    ..Default::default()
                }],
                ..Default::default()
            },
        )
        .await?;
    println!("   Created contract: {:?} ({})", contract.title, contract.id);

    let license_id = &contract.licenses[0].id;
    println!("   License ID: {}", license_id);

    // Step 3: Create Metric
    println!("\n3. Creating Metric...");
    let metric = mgmt
        .metrics()
        .create(
            license_id,
            CreateMetricInput {
                metric_type: "rust_sdk_api_calls".to_string(),
                ..Default::default()
            },
        )
        .await?;
    println!("   Created metric: {} ({})", metric.metric_type, metric.id);

    // Step 4: Track events
    println!("\n4. Tracking events...");
    let tracker = Tracker::new(
        api_key,
        Some(TrackerOptions {
            endpoint: endpoint.to_string(),
            flush_at: 1,
            flush_interval_ms: 1000,
            debug: true,
            ..Default::default()
        }),
    );

    for i in 1..=3 {
        println!("   Tracking event {}...", i);
        tracker
            .track(TrackEvent {
                metric: "rust_sdk_api_calls".to_string(),
                quantity: (i * 10) as f64,
                license_id: license_id.clone(),
                metadata: Some(
                    [
                        ("test_run".to_string(), serde_json::json!(true)),
                        ("event_num".to_string(), serde_json::json!(i)),
                    ]
                    .into_iter()
                    .collect(),
                ),
                ..Default::default()
            })
            .await;
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    println!("   Flushing remaining events...");
    tracker.flush().await;
    tracker.shutdown().await;

    // Step 5: Verify
    println!("\n5. Verifying created resources...");
    let fetched_contract = mgmt.contracts().get(&contract.id).await?;
    println!("   Contract: {}", fetched_contract.title);
    println!("   Licenses: {}", fetched_contract.licenses.len());

    let fetched_license = mgmt.licenses().get(license_id).await?;
    println!(
        "   License: {} (type: {:?})",
        fetched_license.name, fetched_license.license_type
    );

    let fetched_metric = mgmt.metrics().get(&metric.id).await?;
    println!(
        "   Metric: {} (aggregation: {:?})",
        fetched_metric.metric_type, fetched_metric.usage_aggregation_type
    );

    // Step 6: Cleanup
    println!("\n6. Cleaning up...");
    mgmt.apps().delete(&app.id).await?;
    println!("   Deleted test app");

    println!("\n=== E2E Test Complete ===");
    Ok(())
}
