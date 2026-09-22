//go:build integration
// +build integration

package doow

import (
	"context"
	"os"
	"testing"
	"time"
)

// Run with: DOOW_API_KEY=dk_xxx go test -tags=integration -v ./...

func TestIntegration_Tracker(t *testing.T) {
	apiKey := os.Getenv("DOOW_API_KEY")
	if apiKey == "" {
		t.Skip("DOOW_API_KEY not set")
	}

	endpoint := os.Getenv("DOOW_ENDPOINT")
	if endpoint == "" {
		endpoint = "https://dev-api.doow.co" // staging
	}

	tracker := NewTracker(apiKey, &TrackerOptions{
		Endpoint:      endpoint,
		FlushAt:       1,
		FlushInterval: time.Second,
		Debug:         true,
	})

	// Track a test event
	tracker.Track(TrackEvent{
		Metric:    "go_sdk_test",
		Quantity:  1,
		LicenseID: "test_license_integration",
		Metadata: map[string]interface{}{
			"test": true,
			"sdk":  "go",
		},
	})

	// Flush and shutdown
	err := tracker.Flush()
	if err != nil {
		t.Logf("Flush error (may be expected if license doesn't exist): %v", err)
	}

	tracker.Shutdown()
	t.Log("Integration test completed")
}

func TestIntegration_Management(t *testing.T) {
	apiKey := os.Getenv("DOOW_API_KEY")
	if apiKey == "" {
		t.Skip("DOOW_API_KEY not set")
	}

	endpoint := os.Getenv("DOOW_ENDPOINT")
	if endpoint == "" {
		endpoint = "https://dev-api.doow.co"
	}

	mgmt := NewManagement(apiKey, &ManagementOptions{
		Endpoint: endpoint,
		Debug:    true,
	})

	ctx := context.Background()

	// Test Apps.List
	t.Run("Apps.List", func(t *testing.T) {
		apps, err := mgmt.Apps.List(ctx, &ListAppsParams{PaginationParams: PaginationParams{Limit: 5}})
		if err != nil {
			t.Fatalf("Apps.List error: %v", err)
		}
		t.Logf("Found %d apps", len(apps.Data))
		for _, app := range apps.Data {
			t.Logf("  - %s: %s", app.ID, app.Name)
		}
	})

	// Test Expenses.List
	t.Run("Expenses.List", func(t *testing.T) {
		expenses, err := mgmt.Expenses.List(ctx, &ListExpensesParams{
			PaginationParams: PaginationParams{Limit: 5},
			Year:             2026,
		})
		if err != nil {
			t.Fatalf("Expenses.List error: %v", err)
		}
		t.Logf("Found %d expenses", len(expenses.Data))
		for _, exp := range expenses.Data {
			t.Logf("  - %s: $%.2f", exp.ID, exp.Total)
		}
	})
}
