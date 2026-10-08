# syntax=docker/dockerfile:1
# Production dependencies in one stage, then a slim runtime as the node user.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit

FROM node:24-alpine
LABEL org.opencontainers.image.source="https://github.com/giovannirco/tetra-node" \
      org.opencontainers.image.description="Tetra arithmetic API (Node.js)" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY web ./web
ARG VERSION=
ARG COMMIT=unknown
ARG BUILD_DATE=
ENV VERSION=${VERSION} COMMIT=${COMMIT} BUILD_DATE=${BUILD_DATE}
USER node
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=3s --retries=3 CMD ["node", "src/healthcheck.js"]
CMD ["node", "src/server.js"]
