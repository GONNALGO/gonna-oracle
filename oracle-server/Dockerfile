# GONNA ARENA oracle server — node:20-slim, non-root, /data volume.
# Render: docker runtime, health check GET /v1/health, disk mounted at /data,
# PORT injected by the platform (local default 8787). ORACLE_MNEMONIC_FILE
# (secret file, preferred) or ORACLE_MNEMONIC env (fallback) — never baked in.
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json && npm prune --omit=dev

FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd -r oracle && useradd -r -g oracle -d /app oracle \
  && mkdir -p /data && chown oracle:oracle /data
COPY --from=build --chown=oracle:oracle /app/node_modules ./node_modules
COPY --from=build --chown=oracle:oracle /app/dist ./dist
COPY --chown=oracle:oracle package.json ./
# pinned replay engine bundles (REPLAY_ENFORCE=1 boot assert fails without
# them — REPLAY_BUNDLES_DIR defaults to <pkg>/replay-bundles)
COPY --chown=oracle:oracle replay-bundles ./replay-bundles
USER oracle
EXPOSE 8787
VOLUME ["/data"]
# node:20-slim has no curl/wget — use node's fetch; honours the injected PORT
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
