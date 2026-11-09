# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Fleet Copilot** — interview demo: a naive detector (code) raises fuel drop alerts, an AI agent investigates through MCP tools and returns an evidence-backed verdict, the API decides (auto-close or escalation), a human reviews. Guiding principle: **code detects and computes, AI investigates and explains, the human decides.**

The specs in `specs/` are authoritative and carry the project memory. Start with `specs/00-overview.md` (services, flows, structural decisions, glossary), then the spec of the relevant service. The milestone plan (M0–M10) is in `specs/09-implementation-plan.md`: work milestone by milestone, do not add dependencies or features outside the milestone (note them as "ideas"). If the implementation departs from a spec, propose the spec update.

Language: everything in the repository (code, comments, tests, specs, docs, log and error messages, LLM prompts and tool descriptions) is written in **English**. Only the web UI is bilingual: English (default) and French, through the dictionaries in `apps/web/src/app/core/i18n/` (see `specs/07-web.md`, "Languages").

Current state: API V1 (M2 + M3) implemented in `apps/nestjs` with its contracts in `packages/contracts`; driven simulator (M6b) in `apps/simulator`: permanent Compose service, state machine (`idle` → `preparing` → `running` ⇄ `paused` → `finished`), dataset generated in memory on every "Start", state resumed from the `simdata` volume; MCP server V1 (M4, 7 tools, Express + stateless Streamable HTTP) in `apps/mcp-server`; control room (M6) in `apps/web`, with the simulation bar and the EN/FR switch; `investigator` is a stub. V2 in progress: M8 done — billing scenarios B1–B4 and PDF invoices rendered by the simulator at each "Start" (pdfmake, 4 hard-coded templates with variations, `apps/simulator/src/{billing,invoices,invoice-pdf}.ts`, spec 10). M9 done — `apps/nestjs/src/invoices` (reception with unpdf text extraction and injection detection in code, agent text/extraction routes, reconciliation in code → `billing_mismatch` alert, screen routes, PDFs in the `invoices` volume emptied by `/admin/wipe`), `extractor` worker (`apps/agents/src/extractor`, structured output, local time converted in code), investigator prompt `investigator-v2`. M10 done — the simulator sends the PDFs during the replay (`POST /api/invoices`, 30 simulated minutes after the refuel), Invoices tab of the screen (`apps/web/src/app/invoices`), `billing_mismatch` alerts always escalated by the API. V2 checked end to end on a real simulation (B1 discrepancy → `billing_discrepancy` escalated, B2/B4 matched, B3 suspicious with its real liters).

## Commands

npm workspaces monorepo (`apps/*`, `packages/*`), Node 24, strict TypeScript, ESM (`"type": "module"` → relative imports with a `.js` suffix).

```bash
cp .env.example .env                 # once
npm run dev                          # dev Compose (watch, src/ mounted as volumes)
npm run dev:up / dev:down / dev:logs
npm run dev:rebuild                  # after a package.json / tsconfig change (node_modules live in the image)
npm run dev:db:reset                 # deletes the pgdata and simdata volumes
npm run prod:up / prod:down          # separate Compose project `fleetenergies-prod`

npm test                             # tests of all workspaces
npm run build | npm run lint         # same, --if-present

# One workspace / one test (Vitest everywhere)
npm test -w apps/nestjs
npx -w apps/nestjs vitest run src/app.controller.spec.ts
npx -w apps/nestjs vitest run -t "test name"
npm run test:db:up                   # test Postgres (docker-compose.test.yaml, port 5433, tmpfs)
npm run test:e2e                     # API integration (vitest.config.e2e.ts): migrate deploy then tests
npm run prisma:migrate:dev -w apps/nestjs -- --name <name>   # new migration (DATABASE_URL required)
npm run lint -w apps/nestjs          # oxlint --type-aware (not ESLint)
```

Ollama runs **on the host**, outside Docker (Metal GPU); the containers reach it through `host.docker.internal:11434`:
```bash
ollama pull qwen2.5:7b-instruct && ollama create fleet-qwen -f infra/ollama/Modelfile
```

Simulation: driven from the control room (`http://localhost:4200`, "Simulation" bar: Start, Pause / Resume, Finish, speed ×60 → ×4000, Reset). "Start" calls `POST /admin/wipe`, generates the dataset (seed `SIM_SEED`, start = `Date.now()`), loads the history (D − 1 month → start) then replays the demo week (start → start + 7 days; ≈ 5 min at ×2000, the default `SIM_SPEED`). Control API without authentication on port 3200 (`GET /simulation`, `POST /simulation/{start,pause,resume,stop,reset}`, `PUT /simulation/speed`), proxied under `/simulation` by `ng serve` / nginx.
```bash
curl -X POST localhost:3200/simulation/start             # same as the "Start" button
npm run sim -- generate                                  # debugging: writes the dataset to data/generated/ (ignored by Git)
```
`apps/simulator` is run directly by Node 24 (type stripping, relative imports in `.ts`, no build; `node --watch` in dev). The `generate.spec.ts` test applies the API detector rule (`apps/nestjs/src/detector/fuel-drop.rule.ts`) to the generated data: any change to the rule or to the physics must keep it green. `simulation.spec.ts` covers the state machine with a fake backend. `invoice-pdf.spec.ts` re-reads the rendered PDFs with unpdf.

Script planned by the specs but not created yet: `npm run smoke:tools -w apps/agents`.

## Architecture

| Service (Compose) | Folder | Role |
|---|---|---|
| `postgres` | — | business data **and** task queue |
| `nestjs` ("api" in the specs) | `apps/nestjs` | the only service connected to Postgres (Prisma 7 + `@prisma/adapter-pg`, SQL migrations in `prisma/migrations`, applied at startup); Swagger on `/docs` |
| `mcp-server` | `apps/mcp-server` | 7 read-only investigation tools, thin adapter over `/agent/trucks/*` — no business logic, no SQL |
| `investigator`, `extractor` (V2) | `apps/agents` | workers without an HTTP server; one image, two commands (`dist/investigator.js`, `dist/extractor.js`) |
| `web` | `apps/web` | Angular 22 (standalone, signals), 2 s polling, EN/FR UI (English by default); `ng serve` proxies `/api` and `/simulation` (`proxy.conf.mjs`, `API_PROXY_TARGET`, `SIMULATION_PROXY_TARGET`) |
| `simulator` | `apps/simulator` | long-running service (`node:http`, port 3200): simulates the telematics boxes and the suppliers, only talks to the API; state in `/data` (`simdata` volume: `state.json`, `dataset.json`), never in Postgres |
| — | `packages/contracts` | **only** Zod schemas + inferred types + constants, sole dependency `zod`; consumed as TypeScript source (`exports` → `src/index.ts`, internal imports in `.ts`, Node 24 type stripping: no build) |

Structural decisions (not to be challenged without discussion):
- **Task queue in Postgres** (`tasks` table, `FOR UPDATE SKIP LOCKED` claim, 5-min lock, 30 s sweep); polling workers. No Redis/BullMQ, no SSE/WebSocket.
- **Agent = three connections**: the API directly for control (claim, steps, verdict), the MCP server for the tools seen by the model, Ollama (`openai` SDK) for reasoning. **Hand-written agent loop**, no framework.
- `submit_verdict` is a tool **local** to the worker, not on the MCP server. Tool results are wrapped as `{ ref: "E1", result }`; the verdict cites these refs, which the API re-checks against the `tool_call` steps (422 otherwise).
- **The API decides** after the verdict (rules in code): `theft_suspected` / `billing_discrepancy` / `inconclusive` → always escalated; otherwise `confidence ≥ AUTO_CLOSE_MIN_CONFIDENCE` → closed.
- Calculations (fuel balance, stops, downsampling) are done in code in the API, never by the LLM. Tool outputs are summarised (≤ 30 points / 20 items, window ≤ 72 h).
- PII: every `/agent/*` response goes through the `pii` module (`C-xx` pseudonyms, phone numbers/emails masked as `[phone masked]` / `[email masked]`). No `full_name`/`phone` may reach an agent.
- Idempotent ingestion (`ON CONFLICT DO NOTHING` on natural keys); `history` vs `live` data. Detection only on `live` batches.
- Static Bearer token auth: `DEVICE_TOKEN` (ingestion), `AGENT_API_TOKEN` (`/agent/*`), `ADMIN_TOKEN` (`/admin/*`), `MCP_CLIENT_TOKEN` (incoming MCP).
- **Contracts first**: any schema that crosses a service is written in `packages/contracts` before the code that uses it. The package is `"sideEffects": false`; constants imported at runtime by the web app live in modules without zod (e.g. `simulation-constants.ts`), otherwise zod ends up in the Angular bundle.
- **Simulation driven from the screen**: every "Start" and "Reset" wipes the whole database (`/admin/wipe`, which replaces the former `/admin/reset`); the simulator keeps its state on its volume and comes back `paused` after a restart.
- **Web i18n without a dependency**: `t(key, params?)` reads the language from a global signal (`apps/web/src/app/core/i18n/i18n.ts`); `en.ts` defines the keys, `fr.ts` must provide them all (enforced by its type). Formatters (`core/format.ts`) follow the language. Any new UI text goes into both dictionaries.

NestJS 12: validation and documentation through the Zod schemas themselves (Standard Schema) — `@Body({ schema })`, `@Query({ schema })`, `@ApiOkResponse({ standardSchema })`, global `StandardSchemaValidationPipe` (`src/setup-app.ts`); no class DTOs and no `class-validator`. The Prisma client is generated in `src/generated/prisma` (ignored by Git; `prisma generate` is run by `build`, `start:dev` and `test:e2e`). The API tsconfig uses `preserveSymlinks` so that `tsc` does not recompile `@fleet/contracts`.

Docker: multi-stage Dockerfiles (`dev` / `build` / `prod`) built from the **monorepo root** (context `.`) to include `packages/contracts`; installed with `npm ci -w <app>`. In dev, only the app's `src/` and `packages/contracts/src` are mounted.

Worker tests: scripted fake model, never a real LLM call in CI.
