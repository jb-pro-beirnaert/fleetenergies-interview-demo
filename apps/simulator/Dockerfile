# Build context: monorepo root (to reach the lockfile and the shared packages)
# No compilation step: Node 24 runs the TypeScript directly (type stripping)
FROM node:24-alpine AS dev
WORKDIR /app

# Manifests only, to benefit from the Docker cache on `npm ci`
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/simulator/package.json apps/simulator/
RUN npm ci -w apps/simulator

COPY packages/contracts packages/contracts
COPY apps/simulator apps/simulator

WORKDIR /app/apps/simulator
EXPOSE 3200
# `node --watch` restarts the service on every change; the state is resumed from /data
CMD ["npm", "run", "dev"]

# Final image: production dependencies + sources
FROM node:24-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/simulator/package.json apps/simulator/
RUN npm ci --omit=dev -w apps/simulator && npm cache clean --force

COPY packages/contracts/src packages/contracts/src
COPY apps/simulator/src apps/simulator/src

# Simulation state volume (state.json, dataset.json), writable by the node user
RUN mkdir -p /data && chown node:node /data
VOLUME /data

WORKDIR /app/apps/simulator
USER node
EXPOSE 3200
CMD ["node", "src/cli.ts", "serve"]
