//! Management API client for Doow SDK.

use crate::error::{DoowError, Result};
use crate::types::*;
use reqwest::Client;
use serde::Deserialize;
use std::time::Duration;

const SDK_VERSION: &str = "0.1.0";
const DEFAULT_ENDPOINT: &str = "https://api.doow.co";
const DEFAULT_TIMEOUT_MS: u64 = 30_000;

/// Management client configuration
#[derive(Debug, Clone)]
pub struct ManagementOptions {
    pub endpoint: String,
    pub timeout_ms: u64,
    pub debug: bool,
}

impl Default for ManagementOptions {
    fn default() -> Self {
        Self {
            endpoint: std::env::var("DOOW_TRACK_ENDPOINT")
                .unwrap_or_else(|_| DEFAULT_ENDPOINT.to_string()),
            timeout_ms: DEFAULT_TIMEOUT_MS,
            debug: false,
        }
    }
}

#[derive(Deserialize)]
struct ApiErrorResponse {
    message: Option<String>,
    #[serde(rename = "errorClass")]
    error_class: Option<String>,
}

/// Management API client
pub struct Management {
    api_key: String,
    options: ManagementOptions,
    client: Client,
}

impl Management {
    /// Create a new management client
    pub fn new(api_key: impl Into<String>, options: Option<ManagementOptions>) -> Self {
        let api_key = std::env::var("DOOW_TRACK_API_KEY").unwrap_or_else(|_| api_key.into());
        let options = options.unwrap_or_default();

        let client = Client::builder()
            .timeout(Duration::from_millis(options.timeout_ms))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            api_key,
            options,
            client,
        }
    }

    fn log(&self, msg: &str) {
        if self.options.debug {
            eprintln!("[doow/management] {}", msg);
        }
    }

    async fn request<T: serde::de::DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<T> {
        self.log(&format!("{} {}", method, path));

        let mut req = self
            .client
            .request(method, format!("{}{}", self.options.endpoint, path))
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .header("User-Agent", format!("doow-track-rust/{}", SDK_VERSION));

        if let Some(b) = body {
            req = req.json(&b);
        }

        let resp = req.send().await?;

        if resp.status().is_success() {
            if resp.status() == reqwest::StatusCode::NO_CONTENT {
                return Ok(serde_json::from_value(serde_json::Value::Null)?);
            }
            return Ok(resp.json().await?);
        }

        let status = resp.status().as_u16();
        let error_resp: ApiErrorResponse = resp.json().await.unwrap_or(ApiErrorResponse {
            message: None,
            error_class: None,
        });

        Err(DoowError::api(
            status,
            error_resp.message.unwrap_or_else(|| "Unknown error".to_string()),
            error_resp.error_class,
        ))
    }

    /// Apps resource
    pub fn apps(&self) -> AppsResource<'_> {
        AppsResource { client: self }
    }

    /// Contracts resource
    pub fn contracts(&self) -> ContractsResource<'_> {
        ContractsResource { client: self }
    }

    /// Licenses resource
    pub fn licenses(&self) -> LicensesResource<'_> {
        LicensesResource { client: self }
    }

    /// Metrics resource
    pub fn metrics(&self) -> MetricsResource<'_> {
        MetricsResource { client: self }
    }

    /// Expenses resource
    pub fn expenses(&self) -> ExpensesResource<'_> {
        ExpensesResource { client: self }
    }
}

/// Apps API resource
pub struct AppsResource<'a> {
    client: &'a Management,
}

impl<'a> AppsResource<'a> {
    /// List all apps
    pub async fn list(&self, params: Option<PaginationParams>) -> Result<PaginatedResponse<App>> {
        let params = params.unwrap_or_default();
        let mut query = format!("?limit={}", params.limit);
        if let Some(cursor) = params.cursor {
            query.push_str(&format!("&cursor={}", cursor));
        }
        self.client
            .request(reqwest::Method::GET, &format!("/sdk/apps{}", query), None)
            .await
    }

    /// Get an app by ID
    pub async fn get(&self, app_id: &str) -> Result<App> {
        self.client
            .request(reqwest::Method::GET, &format!("/sdk/apps/{}", app_id), None)
            .await
    }

    /// Create a new app
    pub async fn create(&self, input: CreateAppInput) -> Result<App> {
        self.client
            .request(
                reqwest::Method::POST,
                "/sdk/apps",
                Some(serde_json::to_value(input)?),
            )
            .await
    }

    /// Update an app
    pub async fn update(&self, app_id: &str, input: UpdateAppInput) -> Result<App> {
        self.client
            .request(
                reqwest::Method::PATCH,
                &format!("/sdk/apps/{}", app_id),
                Some(serde_json::to_value(input)?),
            )
            .await
    }

    /// Delete an app
    pub async fn delete(&self, app_id: &str) -> Result<()> {
        self.client
            .request::<serde_json::Value>(
                reqwest::Method::DELETE,
                &format!("/sdk/apps/{}", app_id),
                None,
            )
            .await?;
        Ok(())
    }
}

/// Contracts API resource
pub struct ContractsResource<'a> {
    client: &'a Management,
}

impl<'a> ContractsResource<'a> {
    /// List contracts for an app
    pub async fn list(
        &self,
        app_id: &str,
        params: Option<PaginationParams>,
    ) -> Result<PaginatedResponse<Contract>> {
        let params = params.unwrap_or_default();
        let mut query = format!("?limit={}", params.limit);
        if let Some(cursor) = params.cursor {
            query.push_str(&format!("&cursor={}", cursor));
        }
        self.client
            .request(
                reqwest::Method::GET,
                &format!("/sdk/apps/{}/contracts{}", app_id, query),
                None,
            )
            .await
    }

    /// Get a contract by ID
    pub async fn get(&self, contract_id: &str) -> Result<Contract> {
        self.client
            .request(
                reqwest::Method::GET,
                &format!("/sdk/contracts/{}", contract_id),
                None,
            )
            .await
    }

    /// Create a new contract
    pub async fn create(&self, app_id: &str, input: CreateContractInput) -> Result<Contract> {
        self.client
            .request(
                reqwest::Method::POST,
                &format!("/sdk/apps/{}/contracts", app_id),
                Some(serde_json::to_value(input)?),
            )
            .await
    }

    /// Update a contract
    pub async fn update(&self, contract_id: &str, input: UpdateContractInput) -> Result<Contract> {
        self.client
            .request(
                reqwest::Method::PATCH,
                &format!("/sdk/contracts/{}", contract_id),
                Some(serde_json::to_value(input)?),
            )
            .await
    }

    /// Delete a contract
    pub async fn delete(&self, contract_id: &str) -> Result<()> {
        self.client
            .request::<serde_json::Value>(
                reqwest::Method::DELETE,
                &format!("/sdk/contracts/{}", contract_id),
                None,
            )
            .await?;
        Ok(())
    }
}

/// Licenses API resource
pub struct LicensesResource<'a> {
    client: &'a Management,
}

impl<'a> LicensesResource<'a> {
    /// List licenses for a contract
    pub async fn list(
        &self,
        contract_id: &str,
        params: Option<PaginationParams>,
    ) -> Result<PaginatedResponse<License>> {
        let params = params.unwrap_or_default();
        let mut query = format!("?limit={}", params.limit);
        if let Some(cursor) = params.cursor {
            query.push_str(&format!("&cursor={}", cursor));
        }
        self.client
            .request(
                reqwest::Method::GET,
                &format!("/sdk/contracts/{}/licenses{}", contract_id, query),
                None,
            )
            .await
    }

    /// Get a license by ID
    pub async fn get(&self, license_id: &str) -> Result<License> {
        self.client
            .request(
                reqwest::Method::GET,
                &format!("/sdk/licenses/{}", license_id),
                None,
            )
            .await
    }

    /// Update a license
    pub async fn update(&self, license_id: &str, input: UpdateLicenseInput) -> Result<License> {
        self.client
            .request(
                reqwest::Method::PATCH,
                &format!("/sdk/licenses/{}", license_id),
                Some(serde_json::to_value(input)?),
            )
            .await
    }

    /// Delete a license
    pub async fn delete(&self, license_id: &str) -> Result<()> {
        self.client
            .request::<serde_json::Value>(
                reqwest::Method::DELETE,
                &format!("/sdk/licenses/{}", license_id),
                None,
            )
            .await?;
        Ok(())
    }
}

/// Metrics API resource
pub struct MetricsResource<'a> {
    client: &'a Management,
}

impl<'a> MetricsResource<'a> {
    /// List metrics for a license
    pub async fn list(
        &self,
        license_id: &str,
        params: Option<PaginationParams>,
    ) -> Result<PaginatedResponse<Metric>> {
        let params = params.unwrap_or_default();
        let mut query = format!("?limit={}", params.limit);
        if let Some(cursor) = params.cursor {
            query.push_str(&format!("&cursor={}", cursor));
        }
        self.client
            .request(
                reqwest::Method::GET,
                &format!("/sdk/licenses/{}/metrics{}", license_id, query),
                None,
            )
            .await
    }

    /// Get a metric by ID
    pub async fn get(&self, metric_id: &str) -> Result<Metric> {
        self.client
            .request(
                reqwest::Method::GET,
                &format!("/sdk/metrics/{}", metric_id),
                None,
            )
            .await
    }

    /// Create a new metric
    pub async fn create(&self, license_id: &str, input: CreateMetricInput) -> Result<Metric> {
        self.client
            .request(
                reqwest::Method::POST,
                &format!("/sdk/licenses/{}/metrics", license_id),
                Some(serde_json::to_value(input)?),
            )
            .await
    }

    /// Update a metric
    pub async fn update(&self, metric_id: &str, input: UpdateMetricInput) -> Result<Metric> {
        self.client
            .request(
                reqwest::Method::PATCH,
                &format!("/sdk/metrics/{}", metric_id),
                Some(serde_json::to_value(input)?),
            )
            .await
    }

    /// Delete a metric
    pub async fn delete(&self, metric_id: &str) -> Result<()> {
        self.client
            .request::<serde_json::Value>(
                reqwest::Method::DELETE,
                &format!("/sdk/metrics/{}", metric_id),
                None,
            )
            .await?;
        Ok(())
    }
}

/// Expenses API resource
pub struct ExpensesResource<'a> {
    client: &'a Management,
}

impl<'a> ExpensesResource<'a> {
    /// List expenses
    pub async fn list(&self, params: Option<ListExpensesParams>) -> Result<PaginatedResponse<Expense>> {
        let params = params.unwrap_or_default();
        let mut query = format!("?limit={}", params.limit);
        if let Some(cursor) = params.cursor {
            query.push_str(&format!("&cursor={}", cursor));
        }
        if let Some(app_id) = params.app_id {
            query.push_str(&format!("&app_id={}", app_id));
        }
        if let Some(year) = params.year {
            query.push_str(&format!("&year={}", year));
        }
        if let Some(month) = params.month {
            query.push_str(&format!("&month={}", month));
        }
        self.client
            .request(reqwest::Method::GET, &format!("/sdk/expenses{}", query), None)
            .await
    }

    /// Get an expense by ID
    pub async fn get(&self, expense_id: &str) -> Result<Expense> {
        self.client
            .request(
                reqwest::Method::GET,
                &format!("/sdk/expenses/{}", expense_id),
                None,
            )
            .await
    }
}
