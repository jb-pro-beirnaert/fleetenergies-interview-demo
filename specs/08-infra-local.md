# 08 — Infrastructure locale

Objectif : `docker compose up -d` démarre tout sauf Ollama, et l'environnement local ressemble déjà à la production (un conteneur par service, configuration par l'environnement). Le passage à Kubernetes en V5 ne doit demander aucune réécriture.

## Prérequis
Node.js 24 LTS, Docker Desktop, Ollama installé nativement sur le Mac (M1, 16 Go).

## Modèle
Ollama tourne **hors de Docker** : sur macOS, Docker n'a pas accès au GPU Apple (Metal), le modèle y serait 5 à 10 fois plus lent.

Créer le modèle `fleet-qwen` avec une fenêtre de contexte suffisante pour une enquête :

```
# infra/ollama/Modelfile
FROM qwen2.5:7b-instruct
PARAMETER num_ctx 8192
PARAMETER temperature 0
```
```bash
ollama pull qwen2.5:7b-instruct
ollama create fleet-qwen -f infra/ollama/Modelfile
```

Depuis les conteneurs, Ollama est joignable à `http://host.docker.internal:11434/v1`.

## Services Docker Compose
| Service | Image / build | Port hôte | Dépend de | Notes |
|---|---|---|---|---|
| `postgres` | `postgres:18` | 5432 | — | volume `pgdata`, healthcheck `pg_isready` |
| `nestjs` | `apps/nestjs` | 3000 | postgres (healthy) | applique les migrations au démarrage ; volume `invoices` (V2) ; healthcheck `/api/health` |
| `mcp-server` | `apps/mcp-server` | 3100 | nestjs | |
| `investigator` | `apps/agents` (commande `node dist/investigator.js`) | — | nestjs, mcp-server | `deploy.replicas: 1` (passer à 2 ou 3 pour la démo de parallélisme) |
| `extractor` | `apps/agents` (commande `node dist/extractor.js`) | — | nestjs | V2 |
| `simulator` | `apps/simulator` (commande `node src/cli.ts serve`, pas de build : type stripping) | 3200 | nestjs | volume `simdata` (`/data` : `state.json`, `dataset.json`) ; healthcheck `/health` |
| `web` | `apps/web` (build Angular servi par nginx) | 4200 | nestjs, simulator | proxy `/api` → nestjs, `/simulation` → simulator (`ng serve` en dev, nginx en prod) |

Le simulateur est un service permanent, piloté depuis la salle de contrôle. Seul le générateur (V2) se lance depuis l'hôte. `simulator generate --out` reste disponible depuis l'hôte pour le débogage (`npm run sim -- generate`).

## Images
- Dockerfile multi-étapes par application (`node:24-alpine`), construit depuis la racine du monorepo pour inclure `packages/contracts`.
- Une seule image `agents`, deux commandes.
- Utilisateur non root, `NODE_ENV=production`, uniquement les dépendances de production dans l'image finale.

## Variables d'environnement (`.env.example`)
| Variable | Utilisée par | Défaut local |
|---|---|---|
| `DATABASE_URL` | api | `postgres://fleet:fleet@postgres:5432/fleet` |
| `DEVICE_TOKEN` | api, simulator | `dev-device-token` |
| `AGENT_API_TOKEN` | api, mcp-server, agents | `dev-agent-token` |
| `ADMIN_TOKEN` | api, simulator | `dev-admin-token` |
| `MCP_CLIENT_TOKEN` | mcp-server, agents | `dev-mcp-token` |
| `API_URL` | mcp-server, agents, simulator | `http://nestjs:3000` (conteneurs), `http://localhost:3000` (hôte) |
| `MCP_URL` | agents | `http://mcp-server:3100/mcp` |
| `LLM_BASE_URL` | agents, generator | `http://host.docker.internal:11434/v1` |
| `LLM_API_KEY` | agents, generator | `ollama` |
| `LLM_MODEL` | agents, generator | `fleet-qwen` |
| `FUEL_DROP_MIN_L` | api | `40` |
| `DETECTOR_DEBOUNCE_SECONDS` | api | `15` |
| `AUTO_CLOSE_MIN_CONFIDENCE` | api | `0.75` |
| `POLL_INTERVAL_MS` | agents | `2000` |
| `MAX_TOOL_CALLS` | agents | `10` |
| `INVOICE_STORAGE_DIR` | api | `/data/invoices` (V2) |
| `SIM_SEED` | simulator | `42` |
| `SIM_SPEED` | simulator | `120` (vitesse initiale, l'un des paliers) |
| `SIM_FROM` | simulator | `02:00` (heure de Paris de début du rejeu) |
| `SIM_PORT` | simulator | `3200` |
| `SIM_DATA_DIR` | simulator | `/data` (volume `simdata`) |
| `SIMULATION_PROXY_TARGET` | web (dev) | `http://simulator:3200` |

Les jetons ci-dessus sont des valeurs de développement : `.env` est ignoré par Git, seul `.env.example` est versionné.

## Scripts racine (`package.json`)
| Script | Effet |
|---|---|
| `npm run up` | `docker compose up -d --build` |
| `npm run sim -- generate` | (débogage) écrit le jeu de données dans `data/generated/` (ignoré par Git) |
| `npm run dev:db:reset` | supprime les volumes (`pgdata` et `simdata`) et relance |
| `npm test` | tests de tous les workspaces |
| `npm run lint` | ESLint + Prettier |
| `npm run generate:docs` | (V2) générateur de factures et messages |

## Intégration continue (dès V1)
GitHub Actions sur chaque push : installation, lint, compilation TypeScript, tests unitaires de tous les workspaces, tests d'intégration de l'API avec un service Postgres. Pas d'appel au modèle en CI (les tests des workers utilisent un faux modèle).

## Critères d'acceptation
1. Sur une machine neuve avec les prérequis : `ollama create …`, `cp .env.example .env`, `npm run up`, puis « Démarrer » dans la salle de contrôle à `http://localhost:4200` suffisent à voir la démo.
2. Arrêter puis relancer le conteneur `investigator` pendant le rejeu ne perd aucune alerte (les tâches reprennent).
3. Arrêter puis relancer le conteneur `simulator` pendant le rejeu : la simulation revient en pause à la même heure simulée et reprend sans perte.
4. La CI passe au vert sur la branche principale.
