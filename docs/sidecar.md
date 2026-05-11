# Sidecar Guide

The `doow/track-sidecar` Docker image runs alongside your application and accepts newline-delimited JSON events over stdin, file tail, or TCP. Use it when your application is not written in Node.js or when you want to decouple telemetry emission from your main process.

## Docker Compose

```yaml
version: '3.9'

services:
  app:
    image: your-app
    depends_on:
      - doow-sidecar
    environment:
      - DOOW_SIDECAR_HOST=doow-sidecar
      - DOOW_SIDECAR_PORT=9091

  doow-sidecar:
    image: doow/track-sidecar:latest
    environment:
      - DOOW_TRACK_API_KEY=dk_your_api_key
      - DOOW_TRACK_ENDPOINT=https://api.doow.co
      - DOOW_TRACK_INPUT=tcp:9091
      - DOOW_TRACK_HEALTH_PORT=9090
    ports:
      - '9090:9090'
      - '9091:9091'
    healthcheck:
      test: ['CMD', 'wget', '-qO-', 'http://localhost:9090/healthz']
      interval: 10s
      timeout: 5s
      retries: 3
```

## Kubernetes sidecar

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
      image: doow/track-sidecar:latest
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

| Mode | Env value | Description |
|------|-----------|-------------|
| stdin | `stdin` (default) | Read newline-delimited JSON from stdin |
| File tail | `file:/var/log/events.jsonl` | Tail a file for new events |
| TCP | `tcp:9091` | Listen on a TCP port for newline-delimited JSON |

## Event format

Each line must be a valid JSON object matching the `TrackEvent` interface:

```json
{"metric":"api_calls","quantity":1,"license_id":"lic_abc123"}
{"metric":"tokens","quantity":512,"license_id":"lic_abc123","unit":"tokens","attribution":{"model":"gpt-4"}}
```

## Health check

The sidecar exposes `/healthz` on the configured health port (default 9090). Returns `200 OK` when running.

## Graceful shutdown

On `SIGTERM` or `SIGINT`, the sidecar:
1. Stops accepting new events
2. Flushes all buffered events
3. Exits cleanly

In Kubernetes, configure `terminationGracePeriodSeconds: 10` to allow time for the final flush.

## Multi-arch support

The Docker image is published for `linux/amd64` and `linux/arm64`.
