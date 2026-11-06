# Contexte de build : racine du monorepo (pour accéder au lockfile et aux packages partagés)
FROM node:24-alpine AS dev
WORKDIR /app

# Manifestes uniquement, pour profiter du cache Docker sur `npm ci`
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/mcp-server/package.json apps/mcp-server/
RUN npm ci -w apps/mcp-server

COPY packages/contracts packages/contracts
COPY apps/mcp-server apps/mcp-server

WORKDIR /app/apps/mcp-server
EXPOSE 3100
CMD ["npm", "run", "dev"]

# Compilation TypeScript -> dist/
FROM dev AS build
RUN npm run build

# Image finale : dépendances de production + dist/ uniquement
FROM node:24-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/mcp-server/package.json apps/mcp-server/
RUN npm ci --omit=dev -w apps/mcp-server && npm cache clean --force

# @fleet/contracts est consommé en TypeScript (type stripping natif de Node 24)
COPY packages/contracts/src packages/contracts/src
COPY --from=build /app/apps/mcp-server/dist apps/mcp-server/dist

WORKDIR /app/apps/mcp-server
USER node
EXPOSE 3100
CMD ["node", "dist/main.js"]
