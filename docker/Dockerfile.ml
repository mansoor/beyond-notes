# The "-ml" image: the lean server PLUS the concept-graph semantic layer.
# Debian slim (glibc), because onnxruntime's native runtime can't load on Alpine's
# musl. Bigger than the default image — pull this only if you set GRAPH_EMBEDDINGS=on.

# Build stage
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -r build
RUN pnpm --filter @bn/server --prod deploy /out/server
# onnxruntime-node ships libonnxruntime for macOS + Windows + BOTH Linux arches
# (~90 MB); a linux/$TARGETARCH image needs exactly one. Keep linux/<arch>, drop
# the rest — saves ~75 MB and nothing this image runs.
ARG TARGETARCH
RUN set -eux; \
    bin=$(find /out/server/node_modules -type d -path '*onnxruntime-node/bin/napi-v3' | head -1); \
    case "$TARGETARCH" in arm64) keep=arm64 ;; *) keep=x64 ;; esac; \
    find "$bin" -mindepth 1 -maxdepth 1 -type d ! -name linux -exec rm -rf {} +; \
    find "$bin/linux" -mindepth 1 -maxdepth 1 -type d ! -name "$keep" -exec rm -rf {} +

# Runtime stage
FROM node:22-slim
ENV NODE_ENV=production
# libgomp1 is onnxruntime's one extra shared lib; a few hundred KB.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libgomp1 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out/server /app
COPY --from=build /repo/apps/web/dist /app/web-dist
ENV WEB_DIST=/app/web-dist
ENV MIGRATIONS_DIR=/app/drizzle
EXPOSE 3800
# slim has no wget/curl; use node itself
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "require('http').get('http://127.0.0.1:3800/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/index.js"]
