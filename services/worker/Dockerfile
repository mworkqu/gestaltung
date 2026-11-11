# Gestaltung worker (services/worker). Build from the REPOSITORY ROOT, because
# the worker bundles the repo's lib/**:
#   docker build -f services/worker/Dockerfile -t gestaltung-worker .
# Multi-arch (Mac Mini = arm64; amd64 for any other machine):
#   docker buildx build --platform linux/arm64,linux/amd64 -f services/worker/Dockerfile .
# services/compose.yaml builds it for you.

# ---- build: install deps, bundle with esbuild --------------------------------
FROM node:24-slim AS build
WORKDIR /repo
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
# Root runtime deps only (supabase-js, zod, ...); no install scripts (sharp etc. are not used by the worker).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY services/worker/package.json services/worker/package-lock.json services/worker/
RUN npm --prefix services/worker ci
COPY tsconfig.json ./
COPY lib ./lib
COPY services/worker ./services/worker
ARG GIT_SHA=""
ENV GIT_SHA=${GIT_SHA}
RUN node services/worker/build.mjs

# ---- runtime: the bundle only, non-root -------------------------------------
FROM node:24-slim AS runtime
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 TZ=Asia/Qatar
ARG GIT_SHA=""
ENV GIT_SHA=${GIT_SHA}
WORKDIR /app
COPY --from=build --chown=node:node /repo/services/worker/dist ./dist
# node-cron is bundled; nothing else to install.
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/worker.mjs"]
