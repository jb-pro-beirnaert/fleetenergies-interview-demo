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
| `web` | `apps/web` (build Angular servi par nginx) | 4200 | nestjs | en développement, `ng serve` hors Docker avec proxy vers l'API |

Le simulateur et le générateur ne sont pas des services permanents : on les lance depuis l'hôte (`npm run …`) avec `API_URL=http://localhost:3000`.

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
| `API_URL` | mcp-server, agents, simulator | `http://api:3000` (conteneurs), `http://localhost:3000` (hôte) |
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

Les jetons ci-dessus sont des valeurs de développement : `.env` est ignoré par Git, seul `.env.example` est versionné.

## Scripts racine (`package.json`)
| Script | Effet |
|---|---|
| `npm run up` | `docker compose up -d --build` |
| `npm run seed` | `simulator generate` puis `simulator load` |
| `npm run demo` | `simulator reset` puis `simulator replay --speed 120 --from 02:00` |
| `npm test` | tests de tous les workspaces |
| `npm run lint` | ESLint + Prettier |
| `npm run generate:docs` | (V2) générateur de factures et messages |

## Intégration continue (dès V1)
GitHub Actions sur chaque push : installation, lint, compilation TypeScript, tests unitaires de tous les workspaces, tests d'intégration de l'API avec un service Postgres. Pas d'appel au modèle en CI (les tests des workers utilisent un faux modèle).

## Critères d'acceptation
1. Sur une machine neuve avec les prérequis : `ollama create …`, `cp .env.example .env`, `npm run up`, `npm run seed`, `npm run demo` suffisent à voir la démo à `http://localhost:4200`.
2. Arrêter puis relancer le conteneur `investigator` pendant le rejeu ne perd aucune alerte (les tâches reprennent).
3. La CI passe au vert sur la branche principale.
