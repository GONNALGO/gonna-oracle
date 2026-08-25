# GONNA ARENA oracle server (M1) — node:20-slim, non-root, port 8787, /data volume
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
USER oracle
EXPOSE 8787
VOLUME ["/data"]
# ORACLE_MNEMONIC_FILE: mount the secret file (0600) e.g. at /run/secrets/oracle_mnemonic
CMD ["node", "dist/index.js"]
