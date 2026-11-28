# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:22.23.4-alpine
ARG ALPINE_MIRROR=dl-cdn.alpinelinux.org
ARG NPM_REGISTRY=https://registry.npmjs.org/
ARG APP_VERSION=unknown

FROM ${NODE_IMAGE} AS base
ARG ALPINE_MIRROR
WORKDIR /app

# Use the official Alpine mirror by default. A repository variable/build arg can
# override it for environments that require a regional mirror.
RUN if [ "$ALPINE_MIRROR" != "dl-cdn.alpinelinux.org" ]; then \
      sed -i "s|dl-cdn.alpinelinux.org|${ALPINE_MIRROR}|g" /etc/apk/repositories; \
    fi

FROM base AS builder
ARG NPM_REGISTRY
ARG BUILD_NODE_MAX_OLD_SPACE_SIZE=1024
ARG BUILD_CPUS=1

RUN apk add --no-cache python3 make g++ linux-headers

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci \
      --registry="${NPM_REGISTRY}" \
      --fetch-retries=5 \
      --fetch-retry-factor=2 \
      --fetch-retry-mintimeout=10000 \
      --fetch-retry-maxtimeout=120000 \
      --fetch-timeout=300000

COPY . ./
ENV NEXT_TELEMETRY_DISABLED=1
# Build-only limits; Node heap is not total process RAM.
# The cache mount keeps Next's compile cache between builds on the same builder.
RUN --mount=type=cache,id=9router-next-cache,target=/app/.next/cache,sharing=locked \
    NODE_OPTIONS="--max-old-space-size=${BUILD_NODE_MAX_OLD_SPACE_SIZE}" \
    NINEROUTER_BUILD_CPUS="${BUILD_CPUS}" npm run build

FROM ${NODE_IMAGE} AS runner
ARG ALPINE_MIRROR
ARG APP_VERSION
WORKDIR /app

RUN if [ "$ALPINE_MIRROR" != "dl-cdn.alpinelinux.org" ]; then \
      sed -i "s|dl-cdn.alpinelinux.org|${ALPINE_MIRROR}|g" /etc/apk/repositories; \
    fi

LABEL org.opencontainers.image.title="9router" \
      org.opencontainers.image.version="${APP_VERSION}"

ENV NODE_ENV=production
ENV PORT=20128
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATA_DIR=/app/data

# Avoid a full distribution upgrade in the runtime image. It makes builds less
# reproducible and is unrelated to installing the runtime entrypoint helper.
# Kept above the app files so a code change does not reinstall these packages.
RUN apk add --no-cache su-exec ffmpeg && \
  printf '#!/bin/sh\nchown -R node:node /app/data /app/data-home 2>/dev/null\nexec su-exec node "$@"\n' > /entrypoint.sh && \
  chmod +x /entrypoint.sh

# Ownership is set while copying; a recursive chown afterwards is slow and
# duplicates every file into another layer.
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/custom-server.js ./custom-server.js
COPY --from=builder --chown=node:node /app/open-sse ./open-sse
# Ensure `next` is available at runtime in case tracing did not include it.
COPY --from=builder --chown=node:node /app/node_modules/next ./node_modules/next
# sql.js loads dist/sql-wasm.wasm by path at runtime; tracing only follows JS imports,
# so the last-resort DB driver would abort with ENOENT on the missing binary.
COPY --from=builder --chown=node:node /app/node_modules/sql.js ./node_modules/sql.js
# node-machine-id is createRequire-loaded at runtime; tracing omits it.
COPY --from=builder --chown=node:node /app/node_modules/node-machine-id ./node_modules/node-machine-id
# The copied open-sse source dynamically imports Undici for HTTP proxies;
# standalone tracing does not necessarily include this runtime dependency.
COPY --from=builder --chown=node:node /app/node_modules/undici ./node_modules/undici
# Native bindings are loaded dynamically and omitted by standalone tracing.
COPY --from=builder --chown=node:node /app/node_modules/wreq-js ./node_modules/wreq-js
COPY --from=builder --chown=node:node /app/node_modules/@wreq-js ./node_modules/@wreq-js

RUN mkdir -p /app/data /app/data-home && \
  chown node:node /app /app/data /app/data-home && \
  (ln -sf /app/data-home /root/.9router 2>/dev/null || true)

EXPOSE 20128

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "custom-server.js"]
