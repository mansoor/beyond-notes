# Build stage
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -r build
# Pruned production install for the server only
RUN pnpm --filter @bn/server --prod deploy /out/server
# Lean image: drop the optional semantic-layer runtime (transformers.js +
# onnxruntime, ~200 MB, glibc-only). The embedding code imports it lazily and
# falls back when absent, so the graph still has links/tags/concepts. For the
# semantic layer, use the -ml image (docker/Dockerfile.ml).
RUN rm -rf /out/server/node_modules/@xenova \
           /out/server/node_modules/.pnpm/@xenova+transformers* \
           /out/server/node_modules/.pnpm/onnxruntime-*

# Runtime stage
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/server /app
COPY --from=build /repo/apps/web/dist /app/web-dist
ENV WEB_DIST=/app/web-dist
ENV MIGRATIONS_DIR=/app/drizzle
EXPOSE 3800
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3800/healthz || exit 1
CMD ["node", "dist/index.js"]
