# syntax=docker/dockerfile:1.7
# Runner service. Build context = repo root (pnpm workspace lockfile):
#   docker build -f runner/Dockerfile .
# Needs the host's Docker socket mounted at /var/run/docker.sock.

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.31.0 --activate
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY runner/package.json ./runner/package.json
RUN pnpm install --frozen-lockfile --filter @online-shell/runner --ignore-scripts
COPY runner ./runner
RUN pnpm --filter @online-shell/runner build \
 && pnpm --filter @online-shell/runner deploy --prod --legacy /out

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /app/runner/dist ./dist
# Runs as root: it needs the Docker socket (which is root-equivalent anyway).
EXPOSE 4100
CMD ["node", "dist/index.js"]
