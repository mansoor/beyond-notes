# Build stage
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -r build
# Pruned production install for the server only
RUN pnpm --filter @bn/server --prod deploy /out/server

# Runtime stage — Debian slim (glibc), so the optional embedding layer's
# onnxruntime binary can load. libgomp1 is onnxruntime's one extra shared lib;
# it's a few hundred KB and harmless when the semantic layer is off.
FROM node:22-slim
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends libgomp1 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out/server /app
COPY --from=build /repo/apps/web/dist /app/web-dist
ENV WEB_DIST=/app/web-dist
ENV MIGRATIONS_DIR=/app/drizzle
EXPOSE 3800
# Debian slim has no wget/curl; use node itself for the check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "require('http').get('http://127.0.0.1:3800/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/index.js"]
