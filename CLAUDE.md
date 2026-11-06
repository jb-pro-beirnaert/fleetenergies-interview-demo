# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projet

**Fleet Copilot** — démo d'entretien : un détecteur naïf (code) lève des alertes de chute de carburant, un agent IA enquête via des outils MCP et rend un verdict prouvé, l'API décide (auto-clôture ou escalade), un humain revoit. Principe directeur : **le code détecte et calcule, l'IA enquête et explique, l'humain décide.**

Les specs dans `specs/` font foi (en français) et portent la mémoire du projet. Commencer par `specs/00-overview.md` (services, flux, décisions structurantes, glossaire), puis la spec du service concerné. Le plan par jalons (M0–M10) est dans `specs/09-implementation-plan.md` : travailler jalon par jalon, ne pas ajouter de dépendances ni de fonctionnalités hors jalon (les noter comme « idées »). Si l'implémentation s'écarte d'une spec, proposer la mise à jour de la spec.

État actuel : API V1 (M2 + M3) implémentée dans `apps/nestjs` avec ses contrats dans `packages/contracts` ; simulateur V1 (`generate`, `load`, `replay`, `reset`) dans `apps/simulator`, données générées versionnées dans `data/generated/` ; serveur MCP V1 (M4, 7 outils, Express + Streamable HTTP sans état) dans `apps/mcp-server` ; `investigator` est un stub, `web` est un squelette.

## Commandes

Monorepo npm workspaces (`apps/*`, `packages/*`), Node 24, TypeScript strict, ESM (`"type": "module"` → imports relatifs avec suffixe `.js`).

```bash
cp .env.example .env                 # une fois
npm run dev                          # Compose dev (watch, src/ montés en volume)
npm run dev:up / dev:down / dev:logs
npm run dev:rebuild                  # après changement de package.json / tsconfig (node_modules vivent dans l'image)
npm run dev:db:reset                 # supprime le volume pgdata
npm run prod:up / prod:down          # projet Compose séparé `fleetenergies-prod`

npm test                             # tests de tous les workspaces
npm run build | npm run lint         # idem, --if-present

# Un workspace / un test (Vitest partout)
npm test -w apps/nestjs
npx -w apps/nestjs vitest run src/app.controller.spec.ts
npx -w apps/nestjs vitest run -t "nom du test"
npm run test:db:up                   # Postgres de test (docker-compose.test.yaml, port 5433, tmpfs)
npm run test:e2e                     # intégration API (vitest.config.e2e.ts) : migrate deploy puis tests
npm run prisma:migrate:dev -w apps/nestjs -- --name <nom>   # nouvelle migration (DATABASE_URL requis)
npm run lint -w apps/nestjs          # oxlint --type-aware (pas ESLint)
```

Ollama tourne **sur l'hôte**, hors Docker (GPU Metal) ; les conteneurs y accèdent via `host.docker.internal:11434` :
```bash
ollama pull qwen2.5:7b-instruct && ollama create fleet-qwen -f infra/ollama/Modelfile
```

Simulateur (depuis l'hôte, API sur `http://localhost:3000` ; il ne lit pas `.env`, dont `API_URL` vise le réseau Docker) :
```bash
npm run seed                         # generate (graine SIM_SEED, défaut 42 ; période [aujourd'hui − 1 mois ; aujourd'hui], heure de Paris) + load
npm run demo                         # reset + replay --speed 120 --from 02:00
npm run sim -- replay --speed 3000   # toute commande : generate | load | replay | reset
```
`apps/simulator` est exécuté directement par Node 24 (type stripping, imports relatifs en `.ts`, pas de build). Le test `generate.spec.ts` applique la règle du détecteur de l'API (`apps/nestjs/src/detector/fuel-drop.rule.ts`) aux fichiers générés : toute modification de la règle ou de la physique doit le garder vert.

Script prévu par les specs mais pas encore créé : `npm run smoke:tools -w apps/agents`.

## Architecture

| Service (Compose) | Dossier | Rôle |
|---|---|---|
| `postgres` | — | données métier **et** file de tâches |
| `nestjs` (« api » dans les specs) | `apps/nestjs` | seul service connecté à Postgres (Prisma 7 + `@prisma/adapter-pg`, migrations SQL dans `prisma/migrations`, appliquées au démarrage) ; Swagger sur `/docs` |
| `mcp-server` | `apps/mcp-server` | 7 outils d'enquête en lecture seule, adaptateur fin sur `/agent/trucks/*` — aucune logique métier, aucun SQL |
| `investigator` (V2 : `extractor`) | `apps/agents` | workers sans serveur HTTP ; une image, plusieurs commandes |
| `web` | `apps/web` | Angular 22 (standalone, signals), polling 2 s ; `ng serve` proxifie `/api` (`proxy.conf.mjs`, `API_PROXY_TARGET`) |
| — | `apps/simulator` | CLI lancée depuis l'hôte, ne parle qu'à l'API (`API_URL=http://localhost:3000`) |
| — | `packages/contracts` | **uniquement** schémas Zod + types inférés + constantes, seule dépendance `zod` ; consommé en TypeScript source (`exports` → `src/index.ts`, imports internes en `.ts`, type stripping de Node 24 : pas de build) |

Décisions structurantes (ne pas remettre en cause sans discussion) :
- **File de tâches dans Postgres** (table `tasks`, réservation `FOR UPDATE SKIP LOCKED`, verrou 5 min, balayage 30 s) ; workers en polling. Pas de Redis/BullMQ, pas de SSE/WebSocket.
- **Agent = trois connexions** : API directe pour le pilotage (claim, steps, verdict), serveur MCP pour les outils vus par le modèle, Ollama (SDK `openai`) pour le raisonnement. **Boucle agent écrite à la main**, sans framework.
- `submit_verdict` est un outil **local** au worker, pas sur le serveur MCP. Les résultats d'outils sont enveloppés `{ ref: "E1", result }` ; le verdict cite ces refs, que l'API revérifie contre les étapes `tool_call` (422 sinon).
- **L'API décide** après verdict (règles en code) : `theft_suspected` / `billing_discrepancy` / `inconclusive` → toujours escaladé ; sinon `confidence ≥ AUTO_CLOSE_MIN_CONFIDENCE` → clos.
- Les calculs (bilan carburant, arrêts, sous-échantillonnage) sont faits en code dans l'API, jamais par le LLM. Sorties d'outils résumées (≤ 30 points / 20 éléments, fenêtre ≤ 72 h).
- PII : toute réponse `/agent/*` passe par le module `pii` (pseudonymes `C-xx`, téléphones/e-mails masqués). Aucun `full_name`/`phone` ne doit atteindre un agent.
- Ingestion idempotente (`ON CONFLICT DO NOTHING` sur clés naturelles) ; données `history` vs `live` — `/admin/reset` ne supprime que le `live`. Détection uniquement sur les lots `live`.
- Auth par jetons statiques Bearer : `DEVICE_TOKEN` (ingestion), `AGENT_API_TOKEN` (`/agent/*`), `ADMIN_TOKEN` (`/admin/*`), `MCP_CLIENT_TOKEN` (entrant MCP).
- **Contrats d'abord** : tout schéma qui traverse un service est écrit dans `packages/contracts` avant le code qui l'utilise.

NestJS 12 : validation et documentation par les schémas Zod eux-mêmes (Standard Schema) — `@Body({ schema })`, `@Query({ schema })`, `@ApiOkResponse({ standardSchema })`, `StandardSchemaValidationPipe` global (`src/setup-app.ts`) ; pas de DTO de classe ni de `class-validator`. Le client Prisma est généré dans `src/generated/prisma` (ignoré par Git ; `prisma generate` est lancé par `build`, `start:dev` et `test:e2e`). Le tsconfig de l'API utilise `preserveSymlinks` pour que `tsc` ne recompile pas `@fleet/contracts`.

Docker : Dockerfiles multi-étapes (`dev` / `build` / `prod`) construits depuis la **racine du monorepo** (contexte `.`) pour inclure `packages/contracts` ; installation par `npm ci -w <app>`. En dev, seuls `src/` de l'app et `packages/contracts/src` sont montés.

Tests des workers : faux modèle scripté, jamais d'appel réel au LLM en CI.
