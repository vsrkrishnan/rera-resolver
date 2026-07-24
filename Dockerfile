# Runs the rera-resolver demo app: the published library (built from src/)
# plus a small, separate web/ package that wraps it. web/ is never merged
# into the library's own package.json or dist/ — see web/package.json.
FROM node:20

WORKDIR /app

# Native build toolchain, in case better-sqlite3 has no prebuilt binary for
# this platform/arch and falls back to compiling from source.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# The library's own package.json runs "prepare": "npm run build" during
# `npm ci`, which needs src/ present (tsconfig rootDir is src) — copy both
# before installing. "postinstall" tries to bootstrap a local index via the
# live portal; skip it here since the app builds its own index at boot
# instead (see web/server.js's ensureIndex() call).
ENV RERA_RESOLVER_SKIP_POSTINSTALL=1
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci
RUN npm run build

# --- web app (separate package, own deps) ---
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci --omit=dev
COPY web ./web

# No index.db is baked into the image or required from git — the app
# self-heals its local index against the live portal on first boot via
# ensureIndex() (see web/server.js). Mount a persistent disk at
# RERA_RESOLVER_DB_PATH to avoid re-syncing on every restart.
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "web/server.js"]
