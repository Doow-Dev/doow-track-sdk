FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy compiled source
# Assumes `npm run build` has already been run before docker build
COPY dist/ ./dist/

# Health check
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:${DOOW_TRACK_HEALTH_PORT:-9090}/healthz || exit 1

# Default env
ENV DOOW_TRACK_INPUT=stdin \
    DOOW_TRACK_HEALTH_PORT=9090

EXPOSE ${DOOW_TRACK_HEALTH_PORT:-9090}

# Entry point: runs the sidecar
CMD ["node", "dist/sidecar.cjs"]
