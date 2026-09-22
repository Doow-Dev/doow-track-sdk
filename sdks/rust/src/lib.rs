//! Doow Track SDK for Rust
//!
//! Official SDK for [Doow](https://doow.co) usage telemetry and management.
//!
//! # Quick Start - Telemetry
//!
//! ```rust,no_run
//! use doow_track::{Tracker, TrackEvent};
//!
//! #[tokio::main]
//! async fn main() {
//!     let tracker = Tracker::new("dk_your_api_key", None);
//!
//!     tracker.track(TrackEvent {
//!         metric: "api_calls".to_string(),
//!         quantity: 1.0,
//!         license_id: "lic_abc123".to_string(),
//!         ..Default::default()
//!     }).await;
//!
//!     tracker.shutdown().await;
//! }
//! ```
//!
//! # Quick Start - Management API
//!
//! ```rust,no_run
//! use doow_track::{Management, CreateAppInput};
//!
//! #[tokio::main]
//! async fn main() -> doow_track::Result<()> {
//!     let mgmt = Management::new("dk_your_api_key", None);
//!
//!     let app = mgmt.apps().create(CreateAppInput {
//!         name: "My SaaS".to_string(),
//!         ..Default::default()
//!     }).await?;
//!
//!     println!("Created app: {}", app.id);
//!     Ok(())
//! }
//! ```

pub mod error;
pub mod management;
pub mod tracker;
pub mod types;

pub use error::{DoowError, Result};
pub use management::{Management, ManagementOptions};
pub use tracker::{Tracker, TrackerOptions};
pub use types::*;
