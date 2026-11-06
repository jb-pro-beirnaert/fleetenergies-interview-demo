# Contexte de build : racine du monorepo (pour accéder au lockfile et aux packages partagés)
FROM node:24-alpine AS dev
WORKDIR /app

# Manifestes uniquement, pour profiter du cache Docker sur `npm ci`
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/web/package.json apps/web/
RUN npm ci -w apps/web

COPY packages/contracts packages/contracts
COPY apps/web apps/web

WORKDIR /app/apps/web
EXPOSE 4200
# --host 0.0.0.0 : sinon `ng serve` n'écoute que dans le conteneur
CMD ["npm", "start", "--", "--host", "0.0.0.0", "--port", "4200"]

# Build Angular -> dist/web/browser
FROM dev AS build
RUN npm run build

# Image finale : fichiers statiques servis par nginx (non root, port 8080)
FROM nginxinc/nginx-unprivileged:1.29-alpine AS prod
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist/web/browser /usr/share/nginx/html
EXPOSE 8080
