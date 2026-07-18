# Build stage
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -r build
# Pruned production install for the server only
RUN pnpm --filter @bn/server --prod deploy /out/server

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
