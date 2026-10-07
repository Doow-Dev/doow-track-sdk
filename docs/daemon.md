# Daemon / CLI Guide

The `doow-track` CLI reads newline-delimited JSON from applications written in any language and sends it to Doow. It runs either as a long-lived daemon or as a pipe that exits when its input closes. The self-contained executable needs neither Node.js nor a language SDK on the server.

## Installation

### Download

Each release of the TypeScript SDK (tags of the form `typescript-vX.Y.Z`) attaches one executable per platform, plus a `.sha256` checksum file for each, to the [doow-track-sdk releases](https://github.com/Doow-Dev/doow-track-sdk/releases).

| Server platform | Release asset | Checksum asset |
|-----------------|---------------|----------------|
| Linux x64 | `doow-track-linux-x64` | `doow-track-linux-x64.sha256` |
| Linux arm64 | `doow-track-linux-arm64` | `doow-track-linux-arm64.sha256` |
| macOS x64 (Intel) | `doow-track-darwin-x64` | `doow-track-darwin-x64.sha256` |
| macOS arm64 (Apple silicon) | `doow-track-darwin-arm64` | `doow-track-darwin-arm64.sha256` |
| Windows Server x64 | `doow-track-windows-x64.exe` | `doow-track-windows-x64.exe.sha256` |

Linux x64, Linux arm64, macOS x64, macOS arm64, and Windows x64 are the only platforms with a release asset. Every release is built and smoke tested on all five (the Windows executable on Windows Server). If you run another platform, use the [sidecar image](sidecar.md) or one of the language SDKs instead.

### Verify the download

Download the executable and its `.sha256` file into the same folder, then check them before running anything:

```bash
# Linux
sha256sum -c doow-track-linux-x64.sha256

# macOS
shasum -a 256 -c doow-track-darwin-arm64.sha256
```

```powershell
# Windows Server: the two hashes must match
(Get-Content .\doow-track-windows-x64.exe.sha256).Split(' ')[0]
(Get-FileHash .\doow-track-windows-x64.exe -Algorithm SHA256).Hash.ToLower()
```

### Install

The executables are not code signed or notarized.

- **Linux:** run `chmod +x doow-track-linux-x64`, then move it to a folder on the `PATH` under the name `doow-track`, for example `sudo install -m 0755 doow-track-linux-x64 /usr/local/bin/doow-track`.
- **macOS:** do the same with the macOS asset. Gatekeeper blocks a downloaded file that is not notarized, so remove the quarantine flag once you have verified the checksum: `xattr -d com.apple.quarantine doow-track-darwin-arm64`.
- **Windows Server:** run `doow-track-windows-x64.exe` from PowerShell, or keep it running under a service wrapper such as NSSM or WinSW. SmartScreen can warn about an unsigned download until you choose to run it.

## Quick start

```bash
# Pipe mode: reads stdin, flushes, and exits when stdin closes
echo '{"metric":"api_calls","quantity":1,"license_id":"lic_..."}' | doow-track --api-key dk_...

# Daemon mode with a config file
doow-track --config ./doow-track.json --pidfile /var/run/doow-track.pid

# Windows Server (use Windows paths in the config file)
.\doow-track-windows-x64.exe --config .\doow-track.json

# Linux/macOS: reload the config without restarting
kill -HUP $(cat /var/run/doow-track.pid)
```

On Windows, restart the process to load changed configuration, because SIGHUP reload is not available there. Use Windows paths, such as `C:\ProgramData\Doow\usage.jsonl`, for `input.path`.

## CLI flags

| Flag | Description |
|------|-------------|
| `--config <path>`, `-c` | Path to the JSON config file |
| `--api-key <key>`, `-k` | API key. It overrides the config file, but a `DOOW_TRACK_API_KEY` environment variable still wins over it |
| `--pidfile <path>` | Write the process ID to this file and remove it on exit |
| `--version`, `-v` | Print the version and exit |
| `--help`, `-h` | Print usage and exit |

## Config file reference

Only `api_key` is required, and it can also come from the `--api-key` flag or the `DOOW_TRACK_API_KEY` environment variable.

```json
{
  "api_key": "dk_your_api_key",
  "endpoint": "https://api.doow.co",
  "attribution": { "env": "production", "service": "billing-api" },
  "input": { "mode": "file", "path": "/var/log/usage.jsonl" },
  "flush_at": 50,
  "flush_interval": 5000,
  "debug": false,
  "disabled": false
}
```

### Config fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `api_key` | `string` | none | SDK key, created in the dashboard under Settings > API Keys > Create key > SDK key. Keys start with `dk_`. The CLI does not check the prefix, and the API answers `401` for a key it does not accept |
| `endpoint` | `string` | `https://api.doow.co` | Telemetry server URL |
| `attribution` | `object` | `{}` | Default attribution merged into every event |
| `input.mode` | `"stdin" \| "file" \| "tcp"` | `stdin` | Input mode |
| `input.path` | `string` | none | File path, required when `mode` is `"file"` |
| `input.port` | `number` | none | TCP port, required when `mode` is `"tcp"` |
| `flush_at` | `number` | `20` | Flush after this many queued events |
| `flush_interval` | `number` | `10000` | Flush interval in milliseconds |
| `debug` | `boolean` | `false` | Enable debug logging |
| `disabled` | `boolean` | `false` | Read input but send nothing |

### Environment variables

| Variable | Overrides | Format |
|----------|-----------|--------|
| `DOOW_TRACK_API_KEY` | `api_key` | The key |
| `DOOW_TRACK_ENDPOINT` | `endpoint` | A URL |
| `DOOW_TRACK_INPUT` | `input` | `stdin`, `file:<path>`, or `tcp:<port>` |
| `DOOW_TRACK_FLUSH_AT` | `flush_at` | A positive integer |
| `DOOW_TRACK_FLUSH_INTERVAL` | `flush_interval` | Milliseconds, a positive integer |
| `DOOW_TRACK_ATTRIBUTION` | `attribution` | A JSON object, for example `{"env":"production"}` |
| `DOOW_TRACK_DEBUG` | `debug` | `true` |
| `DOOW_TRACK_DISABLED` | `disabled` | `true` |

An invalid value is ignored and the config file value stays in effect.

### Precedence

Values are resolved in this order, and the first match wins:

1. `DOOW_TRACK_*` environment variables
2. CLI flags (`--api-key`)
3. The config file
4. Built-in defaults

## Input modes

| Mode | Behavior |
|------|----------|
| `stdin` | Reads newline-delimited JSON until stdin closes and drops a line longer than 1 MiB. This is pipe mode: the CLI flushes and exits at end of input |
| `file` | Reads the whole file from the beginning when the daemon starts, then polls it every 200 milliseconds for appended lines. The read position is kept in memory only, so a restart reads the file again and sends every line again as new events. A line is read only after its newline is written, so the last line of a file is not sent until a newline follows it, and a line longer than 1 MiB is dropped. A file that is truncated or rotated is not detected, so restart the daemon after rotating the file. A file the daemon cannot read is reported once in the log as `Input error: Cannot read <path>`, and reading starts by itself when the permissions are fixed |
| `tcp` | Listens on the port on all network interfaces. It accepts up to 10 connections at once, closes a connection that is idle for 60 seconds, and drops a line longer than 1 MiB. There is no acknowledgement, so delivery is at most once: bytes that a client has sent but the daemon has not read yet, and a final line without a newline, are lost when the daemon stops |

Each line must be one JSON object. A malformed line is written to stderr and skipped. The TCP listener has no authentication, so bind it to a private network or restrict it with a firewall rule.

## Event format

Each line is a JSON object with these fields, the same ones the sidecar takes. Only the first three are required.

| Field | Type | Description |
|-------|------|-------------|
| `metric` | string | The metric being measured, for example `api_calls` |
| `quantity` | number | The amount measured |
| `license_id` | string | The license the event belongs to |
| `unit` | string | Optional. The unit your `quantity` is in, for example `GB`. Doow stores it as sent and does not convert it, so send `quantity` in the unit the metric is defined with. See [Units](../README.md#units) |
| `kind` | string | `USAGE` (default) or `ADJUSTMENT` |
| `timestamp` | string | ISO 8601 time of the event. Defaults to the time the daemon receives it |
| `source_system` | string | Optional source name. Defaults to `sdk` |
| `metric_tuple_hint` | object | Optional `{ "app_name", "license_name", "metric_name" }` used to resolve the metric on ingest |
| `attribution` | object | Optional string, number, or boolean values merged with `DOOW_TRACK_ATTRIBUTION` |
| `metadata` | object | Optional free-form fields |

```json
{"metric":"api_calls","quantity":1,"license_id":"lic_abc123"}
{"metric":"tokens_generated","quantity":1500,"unit":"tokens","license_id":"lic_abc123","attribution":{"model":"gpt-4"}}
{"metric":"data_transfer_gb","quantity":2.5,"unit":"GB","license_id":"lic_abc123"}
```

The first line has no unit, which is allowed. The second records 1,500 against `tokens_generated`, a metric defined in tokens. The third records 2.5 against `data_transfer_gb`, a metric defined in GB, so the value is sent as 2.5 and not as a number of bytes, because Doow does not convert quantities. See [Units](../README.md#units) for what happens when the unit and the metric disagree.

Do not send the wire envelope yourself. The daemon builds the `event_id`, `occurred_at`, `source_system`, and `measurements` that the ingest API requires from these fields.

## Linux systemd unit file

Create the service account and install the executable first:

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin doow-track
sudo install -m 0755 doow-track-linux-x64 /usr/local/bin/doow-track
sudo install -d -m 0750 -o root -g doow-track /etc/doow-track
```

Then put the config file at `/etc/doow-track/config.json`, make it readable only by root and the service account (`sudo chown root:doow-track /etc/doow-track/config.json && sudo chmod 0640 /etc/doow-track/config.json`), because it holds the API key, and create the unit:

```ini
[Unit]
Description=Doow Track Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/doow-track --config /etc/doow-track/config.json
ExecReload=/bin/kill -HUP $MAINPID
Restart=on-failure
RestartSec=5
User=doow-track
Group=doow-track
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

The unit leaves out `--pidfile`, because systemd tracks the process itself and the `doow-track` account cannot write to `/var/run`. If you need a PID file, add `RuntimeDirectory=doow-track` to the unit and pass `--pidfile /run/doow-track/doow-track.pid`.

## Linux/macOS SIGHUP config reload

When the daemon receives `SIGHUP`, it:

1. Re-reads the config file
2. Builds a new tracker from it and starts sending new events through it
3. Shuts down the old tracker, which flushes its remaining events

The input reader keeps running throughout, so a file input keeps its read position and does not send lines again, and a TCP listener keeps accepting connections.

Use it to rotate the API key or change flush settings. Two limits apply:

- The input source is fixed when the daemon starts, so a changed `input` block needs a restart.
- A key given with `--api-key` keeps overriding the config file, so rotate a key in the config file only when the daemon was not started with that flag.

## Pipe mode

When no `input` is configured, or `input.mode` is `"stdin"`, the CLI runs in pipe mode:

- It reads newline-delimited JSON from stdin
- It tracks each line as an event
- When stdin closes (EOF), it flushes all events and exits
- It logs malformed lines to stderr and skips them

## Shutdown

On `SIGTERM` or `SIGINT`, the daemon stops its input reader, which closes any TCP client that is still connected, then flushes queued events, removes the PID file, and exits with status 0. The flush waits up to 5 seconds.
