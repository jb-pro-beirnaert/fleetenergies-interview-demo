# Contexte de build : racine du monorepo (pour accéder au lockfile et aux packages partagés)
FROM node:24-alpine AS dev
WORKDIR /app

# Manifestes uniquement, pour profiter du cache Docker sur `npm ci`
COPY package.json package-lock.json ./
COPY apps/nestjs/package.json apps/nestjs/
RUN npm ci -w apps/nestjs

COPY apps/nestjs apps/nestjs

WORKDIR /app/apps/nestjs
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

# Compilation TypeScript -> dist/
FROM dev AS build
RUN npm run build

# Image finale : dépendances de production + dist/ uniquement
FROM node:24-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/nestjs/package.json apps/nestjs/
RUN npm ci --omit=dev -w apps/nestjs && npm cache clean --force

COPY --from=build /app/apps/nestjs/dist apps/nestjs/dist

WORKDIR /app/apps/nestjs
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
