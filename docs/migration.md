# Migration Guide: CSV Upload to SDK

This guide covers migrating from manual CSV-based usage reporting to automated SDK telemetry.

## Before (manual CSV upload)

In the legacy flow, customers exported usage data to CSV files and uploaded them through the Doow dashboard:

1. Export usage data from your billing/metering system
2. Format as CSV with columns: `license_id`, `metric`, `quantity`, `timestamp`
3. Upload via Doow dashboard or API

## After (SDK telemetry)

With `@doow/track`, usage events are emitted in real-time from your application code:

```ts
import { DoowTracker } from '@doow/track';

const meter = new DoowTracker(process.env.DOOW_API_KEY!);

// Track usage events as they happen
meter.track({
  metric: 'api_calls',
  quantity: 1,
  license_id: 'lic_customer_123',
});
```

## Migration steps

### 1. Get an SDK API key

Generate a `dk_` prefixed API key from the Doow dashboard under Settings > API Keys > SDK Keys.

### 2. Install the SDK

```bash
npm install @doow/track
```

### 3. Identify your metering points

Map your CSV columns to SDK `track()` calls:

| CSV column | SDK field |
|------------|-----------|
| `license_id` | `license_id` |
| `metric` | `metric` |
| `quantity` | `quantity` |
| `timestamp` | `timestamp` (optional, defaults to now) |
| `unit` | `unit` (optional) |

### 4. Instrument your code

Place `meter.track()` calls at the points where usage occurs:

```ts
// Before: accumulate in CSV
// csvRows.push({ license_id, metric: 'api_calls', quantity: 1, timestamp });

// After: emit in real-time
meter.track({ metric: 'api_calls', quantity: 1, license_id });
```

### 5. Run in parallel

During migration, run both systems in parallel to verify accuracy:

1. Continue CSV uploads on the existing schedule
2. Enable SDK telemetry in your staging environment
3. Compare SDK-reported usage against CSV totals
4. Once numbers match, disable CSV uploads

### 6. Non-Node.js applications

If your application is not in Node.js, use the sidecar or CLI:

```bash
# Sidecar (Docker)
docker run -e DOOW_TRACK_API_KEY=dk_... doow/track-sidecar:latest

# CLI (pipe mode)
your-app --emit-usage | doow-track --api-key dk_...
```

See [sidecar.md](./sidecar.md) and [daemon.md](./daemon.md) for details.

## Key differences

| Aspect | CSV upload | SDK telemetry |
|--------|-----------|---------------|
| Latency | Batch (hours/days) | Real-time (seconds) |
| Accuracy | Aggregated totals | Per-event granularity |
| Effort | Manual export + upload | Automated |
| Dedup | Manual | Automatic (batch + event level) |
| Error handling | Manual retry | Automatic retry + offline store |
| Rate limiting | N/A | Built-in per-category enforcement |
