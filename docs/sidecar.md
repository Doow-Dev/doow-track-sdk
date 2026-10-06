# Sidecar Guide

The `ghcr.io/doow-dev/doow-track-sidecar` Docker image runs alongside your application and accepts newline-delimited JSON events over stdin, a file, or TCP. Use it to decouple telemetry emission from your main process, from any language. It is designed to run on VMs, Kubernetes, Azure Container Apps, ECS, and any other platform that can run containers.

The image is currently private on GitHub Container Registry at `ghcr.io/doow-dev/doow-track-sidecar`. Customers need package read access and must authenticate Docker to GHCR before pulling it.

## Image tags and platforms

A release of the TypeScript SDK publishes three tags: the full version (`1.2.3`), the major version (`1`), and `latest`. Earlier images used other spellings, for example `0.1.10` and `typescript-v0.1.11`, and the major tag `0` was only ever applied to `0.1.4`. Look up the tags that exist on the package page in the Doow-Dev organization on GitHub, and pin a full version tag in production so an upgrade is a deliberate change. Replace `1.2.3` in the examples below with that tag. The image is published for `linux/amd64` and `linux/arm64`.

## Configuration

The sidecar is configured only through environment variables. It does not read a config file.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DOOW_TRACK_API_KEY` | yes | none | SDK key, created in the dashboard under Settings > API Keys > Create key > SDK key. The sidecar exits at startup without it |
| `DOOW_TRACK_INPUT` | no | `stdin` | `stdin`, `file:<path>`, or `tcp:<port>`. Any other value stops the sidecar at startup |
| `DOOW_TRACK_HEALTH_PORT` | no | `9090` | Port for the health endpoint |
| `DOOW_TRACK_ENDPOINT` | no | `https://api.doow.co` | Telemetry server URL |
| `DOOW_TRACK_FLUSH_AT` | no | `20` | Flush after this many queued events |
| `DOOW_TRACK_FLUSH_INTERVAL` | no | `10000` | Flush interval in milliseconds |
| `DOOW_TRACK_ATTRIBUTION` | no | none | A JSON object merged into every event, for example `{"env":"production"}` |
| `DOOW_TRACK_DEBUG` | no | `false` | Set to `true` for debug logging |
| `DOOW_TRACK_DISABLED` | no | `false` | Set to `true` to read input but send nothing |

## Docker Compose

In this example the application sends events to `doow-sidecar:9091` over the private Compose network. The `DOOW_SIDECAR_HOST` and `DOOW_SIDECAR_PORT` variables belong to your application, so name them however your code expects. The sidecar does not read them.

```yaml
services:
  app:
    image: your-app
    depends_on:
      doow-sidecar:
        condition: service_healthy
    environment:
      - DOOW_SIDECAR_HOST=doow-sidecar
      - DOOW_SIDECAR_PORT=9091

  doow-sidecar:
    image: ghcr.io/doow-dev/doow-track-sidecar:1.2.3
    environment:
      - DOOW_TRACK_API_KEY=dk_your_api_key
      - DOOW_TRACK_ENDPOINT=https://api.doow.co
      - DOOW_TRACK_INPUT=tcp:9091
      - DOOW_TRACK_HEALTH_PORT=9090
    expose:
      - '9091'
    healthcheck:
      test: ['CMD', 'wget', '-qO-', 'http://localhost:9090/healthz']
      interval: 10s
      timeout: 5s
      retries: 3
```

Use `expose`, not `ports`, for the event port. The TCP listener has no authentication, and `ports` would publish it on the host.

## Kubernetes sidecar

Containers in a pod share a network namespace, so the application reaches the sidecar on `localhost`. The resource values are examples, so size them for your event volume.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-app
spec:
  containers:
    - name: app
      image: your-app:latest
      env:
        - name: DOOW_SIDECAR_HOST
          value: localhost
        - name: DOOW_SIDECAR_PORT
          value: '9091'

    - name: doow-sidecar
      image: ghcr.io/doow-dev/doow-track-sidecar:1.2.3
      env:
        - name: DOOW_TRACK_API_KEY
          valueFrom:
            secretKeyRef:
              name: doow-secrets
              key: api-key
        - name: DOOW_TRACK_INPUT
          value: tcp:9091
        - name: DOOW_TRACK_HEALTH_PORT
          value: '9090'
      ports:
        - containerPort: 9091
          name: events
        - containerPort: 9090
          name: health
      livenessProbe:
        httpGet:
          path: /healthz
          port: health
        initialDelaySeconds: 5
        periodSeconds: 10
      resources:
        requests:
          cpu: 50m
          memory: 64Mi
        limits:
          cpu: 200m
          memory: 128Mi
```

## Input modes

| Mode | `DOOW_TRACK_INPUT` | Behavior |
|------|--------------------|----------|
| stdin | `stdin` (default) | Reads newline-delimited JSON from stdin. A container has no stdin unless you start it with `docker run -i` or set `stdin_open: true` in Compose, so use `file` or `tcp` for a long-running sidecar |
| File | `file:/var/log/events.jsonl` | Reads the whole file from the beginning when the sidecar starts, then polls it every 200 milliseconds for appended lines. The read position is kept in memory only, so a restart sends every line again as new events. A file that is truncated or rotated is not detected, so restart the sidecar after rotating it. Mount the file into the container as a volume |
| TCP | `tcp:9091` | Listens on the port on all network interfaces. It accepts up to 10 connections at once, closes a connection that is idle for 60 seconds, and drops a line longer than 1 MiB. Open a new connection if yours was closed |

Each line must be one JSON object. A malformed line is written to the container log and skipped.

## Event format

Each line is a JSON object with these fields. Only the first three are required.

| Field | Type | Description |
|-------|------|-------------|
| `metric` | string | The metric being measured, for example `api_calls` |
| `quantity` | number | The amount measured |
| `license_id` | string | The license the event belongs to |
| `unit` | string | Optional unit, for example `tokens` |
| `kind` | string | `USAGE` (default) or `ADJUSTMENT` |
| `timestamp` | string | ISO 8601 time of the event. Defaults to the time the sidecar receives it |
| `source_system` | string | Optional source name. Defaults to `sdk` |
| `metric_tuple_hint` | object | Optional `{ "app_name", "license_name", "metric_name" }` used to resolve the metric on ingest |
| `attribution` | object | Optional string, number, or boolean values merged with `DOOW_TRACK_ATTRIBUTION` |
| `metadata` | object | Optional free-form fields |

```json
{"metric":"api_calls","quantity":1,"license_id":"lic_abc123"}
{"metric":"tokens","quantity":512,"license_id":"lic_abc123","unit":"tokens","attribution":{"model":"gpt-4"}}
```

## Health check

The sidecar answers `GET` requests on the health port (default 9090) with `200 OK` and `{"status":"ok"}`, and the image also ships with a Docker `HEALTHCHECK` that calls `/healthz`. The check shows that the process is running. It does not test the connection to the Doow API.

## Graceful shutdown

On `SIGTERM` or `SIGINT`, the sidecar:

1. Stops accepting new events
2. Flushes buffered events, waiting up to 5 seconds
3. Closes the health port and exits with status 0

Docker waits 10 seconds by default and Kubernetes waits 30, and both leave enough time for the final flush. If you lower `terminationGracePeriodSeconds`, keep it above 10.
