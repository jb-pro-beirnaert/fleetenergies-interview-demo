# 08 — Local infrastructure

Goal: `docker compose up -d` starts everything except Ollama, and the local environment already looks like production (one container per service, configuration through the environment). Moving to Kubernetes in V5 must not require any rewrite.

## Prerequisites
Node.js 24 LTS, Docker Desktop, Ollama installed natively on the Mac (M1, 16 GB).

## Model
Ollama runs **outside Docker**: on macOS, Docker has no access to the Apple GPU (Metal), so the model would be 5 to 10 times slower there.

Create the `fleet-qwen` model with a context window large enough for an investigation:

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

From the containers, Ollama is reachable at `http://host.docker.internal:11434/v1`.

## Docker Compose services
| Service | Image / build | Host port | Depends on | Notes |
|---|---|---|---|---|
| `postgres` | `postgres:18` | 5432 | — | `pgdata` volume, `pg_isready` healthcheck |
| `nestjs` | `apps/nestjs` | 3000 | postgres (healthy) | applies the migrations at startup; `invoices` volume (V2); `/api/health` healthcheck |
| `mcp-server` | `apps/mcp-server` | 3100 | nestjs | |
| `investigator` | `apps/agents` (command `node dist/investigator.js`) | — | nestjs, mcp-server | `deploy.replicas: 1` (set to 2 or 3 for the parallelism demo) |
| `extractor` | `apps/agents` (command `node dist/extractor.js`) | — | nestjs | V2 |
| `simulator` | `apps/simulator` (command `node src/cli.ts serve`, no build: type stripping) | 3200 | nestjs | `simdata` volume (`/data`: `state.json`, `dataset.json`); `/health` healthcheck |
| `web` | `apps/web` (Angular build served by nginx) | 4200 | nestjs, simulator | proxy `/api` → nestjs, `/simulation` → simulator (`ng serve` in dev, nginx in prod) |

The simulator is a long-running service, driven from the control room. Only the generator (V2) is run from the host. `simulator generate --out` remains available from the host for debugging (`npm run sim -- generate`).

## Images
- One multi-stage Dockerfile per application (`node:24-alpine`), built from the monorepo root to include `packages/contracts`.
- A single `agents` image, two commands.
- Non-root user, `NODE_ENV=production`, only production dependencies in the final image.

## Environment variables (`.env.example`)
| Variable | Used by | Local default |
|---|---|---|
| `DATABASE_URL` | api | `postgres://fleet:fleet@postgres:5432/fleet` |
| `DEVICE_TOKEN` | api, simulator | `dev-device-token` |
| `AGENT_API_TOKEN` | api, mcp-server, agents | `dev-agent-token` |
| `ADMIN_TOKEN` | api, simulator | `dev-admin-token` |
| `MCP_CLIENT_TOKEN` | mcp-server, agents | `dev-mcp-token` |
| `API_URL` | mcp-server, agents, simulator | `http://nestjs:3000` (containers), `http://localhost:3000` (host) |
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
| `SIM_SPEED` | simulator | `120` (initial speed, one of the steps) |
| `SIM_FROM` | simulator | `02:00` (Paris time at which the replay starts) |
| `SIM_PORT` | simulator | `3200` |
| `SIM_DATA_DIR` | simulator | `/data` (`simdata` volume) |
| `SIMULATION_PROXY_TARGET` | web (dev) | `http://simulator:3200` |

The tokens above are development values: `.env` is ignored by Git, only `.env.example` is versioned.

## Root scripts (`package.json`)
| Script | Effect |
|---|---|
| `npm run up` | `docker compose up -d --build` |
| `npm run sim -- generate` | (debugging) writes the dataset to `data/generated/` (ignored by Git) |
| `npm run dev:db:reset` | deletes the volumes (`pgdata` and `simdata`) and restarts |
| `npm test` | tests of all workspaces |
| `npm run lint` | ESLint + Prettier |
| `npm run generate:docs` | (V2) invoice and message generator |

## Continuous integration (from V1 on)
GitHub Actions on every push: install, lint, TypeScript compilation, unit tests of all workspaces, API integration tests with a Postgres service. No model call in CI (the worker tests use a fake model).

## Acceptance criteria
1. On a fresh machine with the prerequisites: `ollama create …`, `cp .env.example .env`, `npm run up`, then "Start" in the control room at `http://localhost:4200` are enough to see the demo.
2. Stopping then restarting the `investigator` container during the replay loses no alert (the tasks resume).
3. Stopping then restarting the `simulator` container during the replay: the simulation comes back paused at the same simulated time and resumes without loss.
4. CI is green on the main branch.
