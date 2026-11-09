# Build context: monorepo root (to reach the lockfile and the shared packages)
FROM node:24-alpine AS dev
WORKDIR /app

# Manifests only, to benefit from the Docker cache on `npm ci`
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/nestjs/package.json apps/nestjs/
RUN npm ci -w apps/nestjs

COPY packages/contracts packages/contracts
COPY apps/nestjs apps/nestjs

WORKDIR /app/apps/nestjs
EXPOSE 3000
# Generates the Prisma client (in src/, mounted in dev), applies the migrations, then watches
CMD ["npm", "run", "start:dev"]

# TypeScript compilation -> dist/ (Prisma client generated, then compiled with the app)
FROM dev AS build
RUN npm run build

# Final image: production dependencies + dist/ + migrations
FROM node:24-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/nestjs/package.json apps/nestjs/
RUN npm ci --omit=dev -w apps/nestjs && npm cache clean --force

# @fleet/contracts is consumed as TypeScript (Node 24 native type stripping)
COPY packages/contracts/src packages/contracts/src
COPY apps/nestjs/prisma apps/nestjs/prisma
COPY apps/nestjs/prisma.config.ts apps/nestjs/
COPY --from=build /app/apps/nestjs/dist apps/nestjs/dist

# V2: storage of the received PDF invoices (`invoices` volume), writable by the node user
RUN mkdir -p /data/invoices && chown -R node:node /data
VOLUME /data/invoices

WORKDIR /app/apps/nestjs
USER node
EXPOSE 3000
# Applies the migrations at startup (spec 08)
CMD ["npm", "run", "start:prod"]
