package doow

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

const defaultMgmtTimeout = 30 * time.Second

// Management is the client for Doow Management API
type Management struct {
	apiKey   string
	endpoint string
	client   *http.Client
	debug    bool

	Apps      *AppsClient
	Contracts *ContractsClient
	Licenses  *LicensesClient
	Metrics   *MetricsClient
	Expenses  *ExpensesClient
}

// NewManagement creates a new management API client
func NewManagement(apiKey string, opts *ManagementOptions) *Management {
	if opts == nil {
		opts = &ManagementOptions{}
	}

	endpoint := opts.Endpoint
	if endpoint == "" {
		endpoint = defaultEndpoint
	}

	timeout := opts.Timeout
	if timeout == 0 {
		timeout = defaultMgmtTimeout
	}

	m := &Management{
		apiKey:   apiKey,
		endpoint: endpoint,
		client:   &http.Client{Timeout: timeout},
		debug:    opts.Debug,
	}

	m.Apps = &AppsClient{m: m}
	m.Contracts = &ContractsClient{m: m}
	m.Licenses = &LicensesClient{m: m}
	m.Metrics = &MetricsClient{m: m}
	m.Expenses = &ExpensesClient{m: m}

	return m
}

func (m *Management) log(format string, args ...interface{}) {
	if m.debug {
		fmt.Printf("[doow/management] "+format+"\n", args...)
	}
}

func (m *Management) request(ctx context.Context, method, path string, body, result interface{}) error {
	var reqBody *bytes.Buffer
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal body: %w", err)
		}
		reqBody = bytes.NewBuffer(data)
	}

	var req *http.Request
	var err error
	if reqBody != nil {
		req, err = http.NewRequestWithContext(ctx, method, m.endpoint+path, reqBody)
	} else {
		req, err = http.NewRequestWithContext(ctx, method, m.endpoint+path, nil)
	}
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+m.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "doow-track-go/0.1.0")

	m.log("%s %s", method, path)

	resp, err := m.client.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		var apiErr APIError
		if err := json.NewDecoder(resp.Body).Decode(&apiErr); err != nil {
			apiErr = APIError{Status: resp.StatusCode, Message: resp.Status}
		}
		apiErr.Status = resp.StatusCode
		return &apiErr
	}

	if resp.StatusCode == 204 || result == nil {
		return nil
	}

	if err := json.NewDecoder(resp.Body).Decode(result); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}

	return nil
}

// AppsClient handles app operations
type AppsClient struct {
	m *Management
}

func (c *AppsClient) Create(ctx context.Context, input CreateAppInput) (*App, error) {
	var app App
	if err := c.m.request(ctx, "POST", "/sdk/apps", input, &app); err != nil {
		return nil, err
	}
	return &app, nil
}

func (c *AppsClient) List(ctx context.Context, params *ListAppsParams) (*PaginatedResponse[App], error) {
	path := "/sdk/apps"
	if params != nil {
		q := url.Values{}
		if params.Cursor != "" {
			q.Set("cursor", params.Cursor)
		}
		if params.Limit > 0 {
			q.Set("limit", strconv.Itoa(params.Limit))
		}
		if params.Name != "" {
			q.Set("name", params.Name)
		}
		if len(q) > 0 {
			path += "?" + q.Encode()
		}
	}

	var result PaginatedResponse[App]
	if err := c.m.request(ctx, "GET", path, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (c *AppsClient) Get(ctx context.Context, id string) (*App, error) {
	var app App
	if err := c.m.request(ctx, "GET", "/sdk/apps/"+id, nil, &app); err != nil {
		return nil, err
	}
	return &app, nil
}

func (c *AppsClient) Update(ctx context.Context, id string, input UpdateAppInput) (*App, error) {
	var app App
	if err := c.m.request(ctx, "PUT", "/sdk/apps/"+id, input, &app); err != nil {
		return nil, err
	}
	return &app, nil
}

func (c *AppsClient) Delete(ctx context.Context, id string) error {
	return c.m.request(ctx, "DELETE", "/sdk/apps/"+id, nil, nil)
}

// ContractsClient handles contract operations
type ContractsClient struct {
	m *Management
}

func (c *ContractsClient) Create(ctx context.Context, appID string, input CreateContractInput) (*Contract, error) {
	var contract Contract
	if err := c.m.request(ctx, "POST", "/sdk/apps/"+appID+"/contracts", input, &contract); err != nil {
		return nil, err
	}
	return &contract, nil
}

func (c *ContractsClient) ListByApp(ctx context.Context, appID string, params *ListContractsParams) (*PaginatedResponse[Contract], error) {
	path := "/sdk/apps/" + appID + "/contracts"
	if params != nil {
		q := url.Values{}
		if params.Cursor != "" {
			q.Set("cursor", params.Cursor)
		}
		if params.Limit > 0 {
			q.Set("limit", strconv.Itoa(params.Limit))
		}
		if params.ContractType != "" {
			q.Set("contract_type", string(params.ContractType))
		}
		if len(q) > 0 {
			path += "?" + q.Encode()
		}
	}

	var result PaginatedResponse[Contract]
	if err := c.m.request(ctx, "GET", path, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (c *ContractsClient) Get(ctx context.Context, id string) (*Contract, error) {
	var contract Contract
	if err := c.m.request(ctx, "GET", "/sdk/contracts/"+id, nil, &contract); err != nil {
		return nil, err
	}
	return &contract, nil
}

func (c *ContractsClient) Update(ctx context.Context, id string, input UpdateContractInput) (*Contract, error) {
	var contract Contract
	if err := c.m.request(ctx, "PUT", "/sdk/contracts/"+id, input, &contract); err != nil {
		return nil, err
	}
	return &contract, nil
}

func (c *ContractsClient) Delete(ctx context.Context, id string) error {
	return c.m.request(ctx, "DELETE", "/sdk/contracts/"+id, nil, nil)
}

// LicensesClient handles license operations
type LicensesClient struct {
	m *Management
}

func (c *LicensesClient) Create(ctx context.Context, contractID string, input CreateLicenseInput) (*License, error) {
	var license License
	if err := c.m.request(ctx, "POST", "/sdk/contracts/"+contractID+"/licenses", input, &license); err != nil {
		return nil, err
	}
	return &license, nil
}

func (c *LicensesClient) ListByContract(ctx context.Context, contractID string, params *ListLicensesParams) (*PaginatedResponse[License], error) {
	path := "/sdk/contracts/" + contractID + "/licenses"
	if params != nil {
		q := url.Values{}
		if params.Cursor != "" {
			q.Set("cursor", params.Cursor)
		}
		if params.Limit > 0 {
			q.Set("limit", strconv.Itoa(params.Limit))
		}
		if params.LicenseType != "" {
			q.Set("license_type", string(params.LicenseType))
		}
		if len(q) > 0 {
			path += "?" + q.Encode()
		}
	}

	var result PaginatedResponse[License]
	if err := c.m.request(ctx, "GET", path, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (c *LicensesClient) Get(ctx context.Context, id string) (*License, error) {
	var license License
	if err := c.m.request(ctx, "GET", "/sdk/licenses/"+id, nil, &license); err != nil {
		return nil, err
	}
	return &license, nil
}

func (c *LicensesClient) Update(ctx context.Context, id string, input UpdateLicenseInput) (*License, error) {
	var license License
	if err := c.m.request(ctx, "PUT", "/sdk/licenses/"+id, input, &license); err != nil {
		return nil, err
	}
	return &license, nil
}

func (c *LicensesClient) Delete(ctx context.Context, id string) error {
	return c.m.request(ctx, "DELETE", "/sdk/licenses/"+id, nil, nil)
}

// MetricsClient handles metric operations
type MetricsClient struct {
	m *Management
}

func (c *MetricsClient) Create(ctx context.Context, licenseID string, input CreateMetricInput) (*Metric, error) {
	var metric Metric
	if err := c.m.request(ctx, "POST", "/sdk/licenses/"+licenseID+"/metrics", input, &metric); err != nil {
		return nil, err
	}
	return &metric, nil
}

func (c *MetricsClient) ListByLicense(ctx context.Context, licenseID string, params *ListMetricsParams) (*PaginatedResponse[Metric], error) {
	path := "/sdk/licenses/" + licenseID + "/metrics"
	if params != nil {
		q := url.Values{}
		if params.Cursor != "" {
			q.Set("cursor", params.Cursor)
		}
		if params.Limit > 0 {
			q.Set("limit", strconv.Itoa(params.Limit))
		}
		if params.MetricType != "" {
			q.Set("metric_type", params.MetricType)
		}
		if len(q) > 0 {
			path += "?" + q.Encode()
		}
	}

	var result PaginatedResponse[Metric]
	if err := c.m.request(ctx, "GET", path, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (c *MetricsClient) Get(ctx context.Context, id string) (*Metric, error) {
	var metric Metric
	if err := c.m.request(ctx, "GET", "/sdk/metrics/"+id, nil, &metric); err != nil {
		return nil, err
	}
	return &metric, nil
}

func (c *MetricsClient) Update(ctx context.Context, id string, input UpdateMetricInput) (*Metric, error) {
	var metric Metric
	if err := c.m.request(ctx, "PUT", "/sdk/metrics/"+id, input, &metric); err != nil {
		return nil, err
	}
	return &metric, nil
}

func (c *MetricsClient) Delete(ctx context.Context, id string) error {
	return c.m.request(ctx, "DELETE", "/sdk/metrics/"+id, nil, nil)
}

// ExpensesClient handles expense operations (read-only)
type ExpensesClient struct {
	m *Management
}

func (c *ExpensesClient) List(ctx context.Context, params *ListExpensesParams) (*PaginatedResponse[Expense], error) {
	path := "/sdk/expenses"
	if params != nil {
		q := url.Values{}
		if params.Cursor != "" {
			q.Set("cursor", params.Cursor)
		}
		if params.Limit > 0 {
			q.Set("limit", strconv.Itoa(params.Limit))
		}
		if params.AppID != "" {
			q.Set("app_id", params.AppID)
		}
		if params.ContractID != "" {
			q.Set("contract_id", params.ContractID)
		}
		if params.Year > 0 {
			q.Set("year", strconv.Itoa(params.Year))
		}
		if params.Month > 0 {
			q.Set("month", strconv.Itoa(params.Month))
		}
		if len(q) > 0 {
			path += "?" + q.Encode()
		}
	}

	var result PaginatedResponse[Expense]
	if err := c.m.request(ctx, "GET", path, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (c *ExpensesClient) Get(ctx context.Context, id string) (*Expense, error) {
	var expense Expense
	if err := c.m.request(ctx, "GET", "/sdk/expenses/"+id, nil, &expense); err != nil {
		return nil, err
	}
	return &expense, nil
}
