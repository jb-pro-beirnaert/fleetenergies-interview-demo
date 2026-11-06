# Contexte de build : racine du monorepo (pour accéder au lockfile et aux packages partagés)
# Pas d'étape de compilation : Node 24 exécute le TypeScript directement (type stripping)
FROM node:24-alpine AS dev
WORKDIR /app

# Manifestes uniquement, pour profiter du cache Docker sur `npm ci`
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/simulator/package.json apps/simulator/
RUN npm ci -w apps/simulator

COPY packages/contracts packages/contracts
COPY apps/simulator apps/simulator

WORKDIR /app/apps/simulator
EXPOSE 3200
# `node --watch` relance le service à chaque modification ; l'état est repris depuis /data
CMD ["npm", "run", "dev"]

# Image finale : dépendances de production + sources
FROM node:24-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/simulator/package.json apps/simulator/
RUN npm ci --omit=dev -w apps/simulator && npm cache clean --force

COPY packages/contracts/src packages/contracts/src
COPY apps/simulator/src apps/simulator/src

# Volume de l'état de la simulation (state.json, dataset.json), inscriptible par l'utilisateur node
RUN mkdir -p /data && chown node:node /data
VOLUME /data

WORKDIR /app/apps/simulator
USER node
EXPOSE 3200
CMD ["node", "src/cli.ts", "serve"]
