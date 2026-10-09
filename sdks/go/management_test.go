package doow

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestManagement_Apps(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer dk_test_key" {
			t.Errorf("unexpected auth: %s", r.Header.Get("Authorization"))
		}

		switch {
		case r.Method == "POST" && r.URL.Path == "/sdk/apps":
			var input CreateAppInput
			json.NewDecoder(r.Body).Decode(&input)
			json.NewEncoder(w).Encode(App{
				ID:   "app_123",
				Name: input.Name,
			})

		case r.Method == "GET" && r.URL.Path == "/sdk/apps/app_123":
			json.NewEncoder(w).Encode(App{
				ID:   "app_123",
				Name: "Test App",
			})

		case r.Method == "GET" && r.URL.Path == "/sdk/apps":
			json.NewEncoder(w).Encode(PaginatedResponse[App]{
				Data:    []App{{ID: "app_123", Name: "Test App"}},
				HasMore: false,
			})

		case r.Method == "DELETE" && r.URL.Path == "/sdk/apps/app_123":
			w.WriteHeader(http.StatusNoContent)

		default:
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	mgmt := NewManagement("dk_test_key", &ManagementOptions{
		Endpoint: server.URL,
	})

	ctx := context.Background()

	// Create
	app, err := mgmt.Apps.Create(ctx, CreateAppInput{Name: "Test App"})
	if err != nil {
		t.Fatalf("create error: %v", err)
	}
	if app.ID != "app_123" {
		t.Errorf("expected app_123, got %s", app.ID)
	}

	// Get
	app, err = mgmt.Apps.Get(ctx, "app_123")
	if err != nil {
		t.Fatalf("get error: %v", err)
	}
	if app.Name != "Test App" {
		t.Errorf("expected Test App, got %s", app.Name)
	}

	// List
	list, err := mgmt.Apps.List(ctx, nil)
	if err != nil {
		t.Fatalf("list error: %v", err)
	}
	if len(list.Data) != 1 {
		t.Errorf("expected 1 app, got %d", len(list.Data))
	}

	// Delete
	err = mgmt.Apps.Delete(ctx, "app_123")
	if err != nil {
		t.Fatalf("delete error: %v", err)
	}
}

func TestManagement_Contracts(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "POST" && r.URL.Path == "/sdk/apps/app_123/contracts":
			var input CreateContractInput
			json.NewDecoder(r.Body).Decode(&input)
			json.NewEncoder(w).Encode(Contract{
				ID:    "contract_123",
				AppID: "app_123",
				Title: input.Title,
			})

		case r.Method == "GET" && r.URL.Path == "/sdk/contracts/contract_123":
			json.NewEncoder(w).Encode(Contract{
				ID:    "contract_123",
				Title: "Test Contract",
			})

		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	mgmt := NewManagement("dk_test_key", &ManagementOptions{
		Endpoint: server.URL,
	})

	ctx := context.Background()

	contract, err := mgmt.Contracts.Create(ctx, "app_123", CreateContractInput{
		Title: "Test Contract",
		Licenses: []LicenseInput{
			{Name: "Usage License"},
		},
	})
	if err != nil {
		t.Fatalf("create error: %v", err)
	}
	if contract.ID != "contract_123" {
		t.Errorf("expected contract_123, got %s", contract.ID)
	}

	contract, err = mgmt.Contracts.Get(ctx, "contract_123")
	if err != nil {
		t.Fatalf("get error: %v", err)
	}
	if contract.Title != "Test Contract" {
		t.Errorf("expected Test Contract, got %s", contract.Title)
	}
}

func TestManagement_Expenses(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "GET" && r.URL.Path == "/sdk/expenses":
			json.NewEncoder(w).Encode(PaginatedResponse[Expense]{
				Data: []Expense{
					{ID: "exp_123", Total: 99.99, Year: 2026, Month: 9},
				},
				HasMore: false,
			})

		case r.Method == "GET" && r.URL.Path == "/sdk/expenses/exp_123":
			json.NewEncoder(w).Encode(Expense{
				ID:    "exp_123",
				Total: 99.99,
			})

		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	mgmt := NewManagement("dk_test_key", &ManagementOptions{
		Endpoint: server.URL,
	})

	ctx := context.Background()

	list, err := mgmt.Expenses.List(ctx, &ListExpensesParams{
		Year:  2026,
		Month: 9,
	})
	if err != nil {
		t.Fatalf("list error: %v", err)
	}
	if len(list.Data) != 1 {
		t.Errorf("expected 1 expense, got %d", len(list.Data))
	}
	if list.Data[0].Total != 99.99 {
		t.Errorf("expected 99.99, got %f", list.Data[0].Total)
	}
}

func TestManagement_APIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"message": "App not found",
			"code":    "NOT_FOUND",
		})
	}))
	defer server.Close()

	mgmt := NewManagement("dk_test_key", &ManagementOptions{
		Endpoint: server.URL,
	})

	_, err := mgmt.Apps.Get(context.Background(), "invalid")
	if err == nil {
		t.Fatal("expected error")
	}

	apiErr, ok := err.(*APIError)
	if !ok {
		t.Fatalf("expected APIError, got %T", err)
	}

	if !apiErr.IsNotFound() {
		t.Errorf("expected 404, got %d", apiErr.Status)
	}

	if apiErr.Code != "NOT_FOUND" {
		t.Errorf("expected NOT_FOUND, got %s", apiErr.Code)
	}
}

func TestManagement_CreateMetricSendsZeroAndFalseValues(t *testing.T) {
	var sent map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" && r.URL.Path == "/sdk/licenses/lic_1/metrics" {
			json.NewDecoder(r.Body).Decode(&sent)
			json.NewEncoder(w).Encode(Metric{ID: "met_1"})
			return
		}
		t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	mgmt := NewManagement("dk_test_key", &ManagementOptions{Endpoint: server.URL})
	_, err := mgmt.Metrics.Create(context.Background(), "lic_1", CreateMetricInput{
		MetricType:                   "fees",
		RateKind:                     RateKindPercent,
		UsageRate:                    Ptr(0.0),
		UsageLimit:                   Ptr(0.0),
		UsageIncluded:                Ptr(0.0),
		PerUnitCap:                   Ptr(0.0),
		UsageRateIsEstimated:         Ptr(false),
		ExpectedEmissionIntervalMins: Ptr(1),
	})
	if err != nil {
		t.Fatalf("create failed: %v", err)
	}

	for _, field := range []string{
		"usage_rate", "usage_limit", "usage_included", "per_unit_cap",
		"usage_rate_is_estimated", "expected_emission_interval_minutes",
	} {
		if _, ok := sent[field]; !ok {
			t.Errorf("%s was dropped from the request body: %v", field, sent)
		}
	}
	if sent["usage_rate_is_estimated"] != false {
		t.Errorf("usage_rate_is_estimated = %v, want false", sent["usage_rate_is_estimated"])
	}
}

func TestManagement_CreateMetricWithOnlyATypeSendsNothingElse(t *testing.T) {
	var sent map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&sent)
		json.NewEncoder(w).Encode(Metric{ID: "met_1"})
	}))
	defer server.Close()

	mgmt := NewManagement("dk_test_key", &ManagementOptions{Endpoint: server.URL})
	if _, err := mgmt.Metrics.Create(context.Background(), "lic_1", CreateMetricInput{MetricType: "api_calls"}); err != nil {
		t.Fatalf("create failed: %v", err)
	}

	if len(sent) != 1 || sent["metric_type"] != "api_calls" {
		t.Errorf("body = %v, want only metric_type", sent)
	}
}
