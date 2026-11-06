# Contexte de build : racine du monorepo (pour accéder au lockfile et aux packages partagés)
# Une seule image pour les workers ; la commande choisit le point d'entrée (investigator, V2 : extractor)
FROM node:24-alpine AS dev
WORKDIR /app

# Manifestes uniquement, pour profiter du cache Docker sur `npm ci`
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/agents/package.json apps/agents/
RUN npm ci -w apps/agents

COPY packages/contracts packages/contracts
COPY apps/agents apps/agents

WORKDIR /app/apps/agents
CMD ["npm", "run", "dev:investigator"]

# Compilation TypeScript -> dist/
FROM dev AS build
RUN npm run build

# Image finale : dépendances de production + dist/ uniquement
FROM node:24-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/agents/package.json apps/agents/
RUN npm ci --omit=dev -w apps/agents && npm cache clean --force

COPY --from=build /app/apps/agents/dist apps/agents/dist

WORKDIR /app/apps/agents
USER node
CMD ["node", "dist/investigator.js"]
