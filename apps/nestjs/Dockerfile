# Contexte de build : racine du monorepo (pour accéder au lockfile et aux packages partagés)
FROM node:24-alpine AS dev
WORKDIR /app

# Manifestes uniquement, pour profiter du cache Docker sur `npm ci`
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/nestjs/package.json apps/nestjs/
RUN npm ci -w apps/nestjs

COPY packages/contracts packages/contracts
COPY apps/nestjs apps/nestjs

WORKDIR /app/apps/nestjs
EXPOSE 3000
# Génère le client Prisma (dans src/, monté en dev), applique les migrations, puis watch
CMD ["npm", "run", "start:dev"]

# Compilation TypeScript -> dist/ (client Prisma généré puis compilé avec l'app)
FROM dev AS build
RUN npm run build

# Image finale : dépendances de production + dist/ + migrations
FROM node:24-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/nestjs/package.json apps/nestjs/
RUN npm ci --omit=dev -w apps/nestjs && npm cache clean --force

# @fleet/contracts est consommé en TypeScript (type stripping natif de Node 24)
COPY packages/contracts/src packages/contracts/src
COPY apps/nestjs/prisma apps/nestjs/prisma
COPY apps/nestjs/prisma.config.ts apps/nestjs/
COPY --from=build /app/apps/nestjs/dist apps/nestjs/dist

WORKDIR /app/apps/nestjs
USER node
EXPOSE 3000
# Applique les migrations au démarrage (spec 08)
CMD ["npm", "run", "start:prod"]
