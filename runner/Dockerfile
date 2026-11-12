# syntax=docker/dockerfile:1.7
# Runner service. Build context = repo root (pnpm workspace lockfile):
#   docker build -f runner/Dockerfile .
# Needs the host's Docker socket mounted at /var/run/docker.sock.

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.31.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY runner/package.json ./runner/package.json

# Compile with dev dependencies (typescript, types).
FROM base AS build
RUN pnpm install --frozen-lockfile --filter @online-shell/runner --ignore-scripts
COPY runner ./runner
RUN pnpm --filter @online-shell/runner build

# Production dependencies only, in a clean tree.
FROM base AS proddeps
RUN pnpm install --frozen-lockfile --filter @online-shell/runner --prod --ignore-scripts

# Runtime keeps pnpm's layout (/app/node_modules/.pnpm + symlinks in
# /app/runner/node_modules), so both directories are copied as-is.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=proddeps /app/node_modules ./node_modules
COPY --from=proddeps /app/runner/node_modules ./runner/node_modules
COPY --from=build /app/runner/package.json ./runner/package.json
COPY --from=build /app/runner/dist ./runner/dist
WORKDIR /app/runner
# Runs as root: it needs the Docker socket (which is root-equivalent anyway).
EXPOSE 4100
CMD ["node", "dist/index.js"]
