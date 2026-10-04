FROM node:20-alpine

WORKDIR /app

ARG SDK_VERSION
LABEL org.opencontainers.image.version=$SDK_VERSION

COPY sdks/typescript/dist/sidecar.cjs ./dist/sidecar.cjs

# Health check
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:${DOOW_TRACK_HEALTH_PORT:-9090}/healthz || exit 1

# Default env
ENV DOOW_TRACK_INPUT=stdin \
    DOOW_TRACK_HEALTH_PORT=9090

EXPOSE ${DOOW_TRACK_HEALTH_PORT:-9090}

# Entry point: runs the sidecar
CMD ["node", "dist/sidecar.cjs"]
