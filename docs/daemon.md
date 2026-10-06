# Daemon / CLI Guide

The `doow-track` CLI runs as a long-lived daemon process and accepts newline-delimited JSON from applications written in any language. Download the self-contained executable for your server OS/CPU from GitHub Releases; it requires neither Node.js nor a language SDK on the server.

## Installation

### Standalone executables

Download the asset matching the server platform from the [doow-track-sdk releases](https://github.com/Doow-Dev/doow-track-sdk/releases):

| Server platform | Release asset |
|-----------------|---------------|
| Linux x64 | `doow-track-linux-x64` |
| Linux arm64 | `doow-track-linux-arm64` |
| macOS x64 | `doow-track-darwin-x64` |
| macOS arm64 | `doow-track-darwin-arm64` |
| Windows Server x64 | `doow-track-windows-x64.exe` |

On Linux and macOS, make the downloaded file executable with `chmod +x doow-track-*` and run it directly. On Windows Server, run `doow-track-windows-x64.exe` from PowerShell or keep it running under a Windows service wrapper such as NSSM or WinSW.

## Quick start

```bash
# Pipe mode — reads stdin, flushes, exits when stdin closes
echo '{"metric":"api_calls","quantity":1,"license_id":"lic_..."}' | doow-track --api-key dk_...

# Daemon mode with config file
doow-track --config ./doow-track.json --pidfile /var/run/doow-track.pid

# Windows Server (use Windows paths in the config file)
.\doow-track-windows-x64.exe --config .\doow-track.json

# Linux/macOS: reload config without restart
kill -HUP $(cat /var/run/doow-track.pid)
```

On Windows, restart the process to load changed configuration; SIGHUP reload is not available there. Use Windows paths, such as `C:\ProgramData\Doow\usage.jsonl`, for `input.path`.

## CLI flags

| Flag | Description |
|------|-------------|
| `--config <path>`, `-c` | Path to JSON config file |
| `--api-key <key>`, `-k` | API key (overrides config and env) |
| `--pidfile <path>` | Write PID to file |
| `--version`, `-v` | Print version and exit |
| `--help`, `-h` | Print usage and exit |

## Config file reference

All fields are optional except `api_key` (which can also come from `--api-key` flag or `DOOW_TRACK_API_KEY` env var).

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
| `api_key` | `string` | — | SDK API key (must start with `dk_`) |
| `endpoint` | `string` | `https://api.doow.co` | Telemetry server URL |
| `attribution` | `object` | `{}` | Default attribution merged into every event |
| `input.mode` | `"stdin" \| "file" \| "tcp"` | `stdin` | Input mode |
| `input.path` | `string` | — | File path (required when `mode: "file"`) |
| `input.port` | `number` | — | TCP port (required when `mode: "tcp"`) |
| `flush_at` | `number` | `20` | Flush after N events |
| `flush_interval` | `number` | `10000` | Flush interval in ms |
| `debug` | `boolean` | `false` | Enable debug logging |
| `disabled` | `boolean` | `false` | Disable the SDK entirely |

### Precedence

Config values are resolved in this order (highest wins):

1. `DOOW_TRACK_*` environment variables
2. CLI flags (`--api-key`)
3. Config file
4. Built-in defaults

## Linux systemd unit file

```ini
[Unit]
Description=Doow Track Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/doow-track --config /etc/doow-track/config.json --pidfile /var/run/doow-track.pid
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

## Linux/macOS SIGHUP config reload

When the daemon receives `SIGHUP`, it:

1. Re-reads the config file
2. Builds a new tracker with the updated config
3. Swaps the tracker and input reader atomically
4. Shuts down the old tracker (flushing any remaining events)
5. Starts the new input reader

This allows zero-downtime config changes (e.g., rotating API keys, changing flush settings).

## Pipe mode

When no `input` config is set (or `input.mode: "stdin"`), the CLI runs in pipe mode:

- Reads newline-delimited JSON from stdin
- Each line is parsed and tracked
- When stdin closes (EOF), all events are flushed and the process exits
- Malformed lines are logged to stderr and skipped
