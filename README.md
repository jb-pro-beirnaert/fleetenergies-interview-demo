# Fleet Copilot

**AI agents that investigate fuel anomalies on a truck fleet, with a local LLM, an MCP server and guardrails in code.**

> Code detects and computes · AI investigates and explains · the human decides.

Fleet Copilot is an interview demo, not a product. A simulator plays a week of a fictional truck fleet (telematics, refuels, driver messages, supplier invoices). A simple rule in code raises an alert on every abnormal fuel drop. An AI agent then investigates each alert on its own, through read-only tools exposed by an MCP server, and returns a verdict backed by evidence. The API decides in code whether to close the alert or escalate it, and a human reviews it in the control room.

![Data flows](scripts/data-flow.gif)

## What it shows

- **A hand-written agent loop** (no framework): the model picks its tools, every tool result gets an evidence reference (`E1`, `E2`…), and the verdict must cite them. The API checks every reference.
- **An MCP server** with 7 read-only investigation tools (tank curve, trips and stops, refuels, driver messages, fuel balance, similar past events…). It is a thin adapter over the API: no SQL and no business logic.
- **A local, open-source LLM** (Qwen 2.5 7B through Ollama): no data leaves the machine.
- **Guardrails in code**: calculations are done by the API, never by the model. A verdict that contradicts the measured facts is sent back to the model (for example, `sensor_fault` while the tank level never recovered).
- **Privacy**: drivers are pseudonymised (`C-01`…) and phone numbers and emails are masked before anything reaches the agent.
- **Invoices (V2)**: an AI extractor reads supplier PDF invoices with structured output, a reconciliation in code compares them with the tank, and a prompt injection hidden in an invoice is detected and never followed.
- **Human in the loop**: theft, billing discrepancies and inconclusive cases are always escalated to an analyst.

### Demo scenarios

| Situation | Expected verdict | Decision |
|---|---|---|
| −180 L at night, engine off, on a motorway rest area, with similar past drops | Suspected theft | Escalated |
| The level drops then recovers, and the driver reports a faulty gauge | Sensor fault | Closed automatically |
| A refrigerated truck feeds its reefer unit from the main tank | Transfer to equipment | Closed automatically |
| Tank drained at the workshop to fix a leak (the mechanic's phone number is masked) | Legitimate operation | Closed automatically |
| An invoice bills more liters than the tank received | Billing discrepancy | Escalated |
| An invoice hides "ignore your previous instructions" | Prompt injection flagged, figures read correctly | — |

## Architecture

| Service | Folder | Role |
|---|---|---|
| `postgres` | — | Business data **and** task queue (`FOR UPDATE SKIP LOCKED`) |
| `nestjs` | `apps/nestjs` | The only service connected to Postgres: ingestion, detector, tasks, decision rules, invoices. Swagger on `/docs` |
| `mcp-server` | `apps/mcp-server` | 7 read-only tools for the agent (Streamable HTTP) |
| `investigator` | `apps/agents` | AI agent worker: model + tools loop, local `submit_verdict` tool |
| `extractor` | `apps/agents` | AI worker that reads PDF invoices (structured output, no tools) |
| `simulator` | `apps/simulator` | Simulates the trucks' telematics boxes and the suppliers, driven from the control room |
| `web` | `apps/web` | Angular control room (English / French) |
| Ollama (host) | `infra/ollama` | The `fleet-qwen` model, outside Docker to use the GPU |

The detailed specifications live in [`specs/`](specs), starting with [`specs/00-overview.md`](specs/00-overview.md).

## Getting started

### Prerequisites

- [Node.js 24](https://nodejs.org) (npm comes with it)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Ollama](https://ollama.com), installed on the host (see below)
- About 6 GB of free memory for the model. Developed on a Mac M1 with 16 GB.

### 1. Install Ollama and create the model

Ollama runs **on the host, outside Docker**: on macOS, Docker has no access to the Apple GPU (Metal), so the model would be 5 to 10 times slower in a container. The containers reach it through `host.docker.internal:11434`.

Install Ollama, either with the installer from [ollama.com/download](https://ollama.com/download) or with Homebrew:

```bash
brew install ollama
```

Start the Ollama server and leave it running in its own terminal. If you installed the desktop app and it is open, the server is already running and you can skip this step.

```bash
ollama serve
```

In another terminal, download the base model (about 4.7 GB):

```bash
ollama pull qwen2.5:7b-instruct
```

Then create the `fleet-qwen` model from the repository's [Modelfile](infra/ollama/Modelfile) (8,192-token context window, temperature 0):

```bash
ollama create fleet-qwen -f infra/ollama/Modelfile
```

Check that the model is available:

```bash
ollama list
```

`fleet-qwen:latest` must appear in the list. You can also query the server: `curl http://localhost:11434/api/tags`.

> On Linux, if the containers cannot reach Ollama, start it with `OLLAMA_HOST=0.0.0.0 ollama serve` so that it listens on the Docker bridge, not only on `localhost`.

### 2. Create the `.env` file

Copy the example file at the root of the repository:

```bash
cp .env.example .env
```

The default values work as is for a local run. `.env` is ignored by Git. Here is the full content of `.env.example`:

```dotenv
# Postgres
POSTGRES_USER=fleet
POSTGRES_PASSWORD=fleet
POSTGRES_DB=fleet
POSTGRES_PORT=5432

# Ports published on the host
NESTJS_PORT=3000
MCP_PORT=3100
WEB_PORT=4200
SIM_PORT=3200

# NESTJS
DATABASE_URL=postgres://fleet:fleet@postgres:5432/fleet
# Detector and decision (spec 03)
FUEL_DROP_MIN_L=40
DETECTOR_DEBOUNCE_SECONDS=15
AUTO_CLOSE_MIN_CONFIDENCE=0.75
# V2: received PDF invoices (volume `invoices` of the nestjs container)
INVOICE_STORAGE_DIR=/data/invoices
TASK_SWEEP_INTERVAL_MS=30000

# Development tokens (spec 08)
DEVICE_TOKEN=dev-device-token
AGENT_API_TOKEN=dev-agent-token
ADMIN_TOKEN=dev-admin-token
MCP_CLIENT_TOKEN=dev-mcp-token

# URLs internal to the Docker network
API_URL=http://nestjs:3000
MCP_URL=http://mcp-server:3100/mcp

# Model (Ollama on the host)
LLM_BASE_URL=http://host.docker.internal:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=fleet-qwen

# Agents
POLL_INTERVAL_MS=2000
MAX_TOOL_CALLS=10

# Simulator (spec 04): seed, initial speed (60, 120, 300, 600, 1000, 2000 or 4000;
# at ×2000 the demo week lasts ≈ 5 min)
SIM_SEED=42
SIM_SPEED=2000
```

The tokens are development values only. If a port is already taken on your machine (for example `5432` by a local Postgres), change it here.

### 3. Run everything

```bash
npm run dev
```

**This single command builds and starts the whole stack** with Docker Compose: Postgres, the API, the MCP server, the two AI workers, the simulator and the control room. The source folders are mounted into the containers, so code changes reload on their own. The first build takes a few minutes. No `npm install` is needed on the host: dependencies are installed in the images.

Then open the control room: **[http://localhost:4200](http://localhost:4200)**.

### 4. Play the demo

1. In the **Simulation** bar, click **Start**. The simulator wipes the database, generates a week of data for 12 trucks, loads one month of history, then replays the week at accelerated speed (about 5 minutes at ×2000).
2. Alerts appear in the feed on the left. Click one to follow the agent's investigation step by step: tool calls with a visual rendering of each result, the model's reasoning, then the verdict with its evidence and the API's decision.
3. The **Invoices** tab shows the PDF invoices read by the AI extractor, the reconciliation with the tank, the billing discrepancy and the invoice with a hidden prompt injection.
4. **Fleet** shows the trucks on a map, their fuel level and their activity.

Use the bar to pause, resume, change the speed or reset. The UI is in English by default; switch to French with `FR` in the header.

> The local model handles one investigation at a time, and the invoice extractor uses it too: expect a few minutes per alert. The investigations keep running after the simulated week ends.

## Useful commands

| Command | Effect |
|---|---|
| `npm run dev` | Builds and starts the whole stack in the foreground, with logs |
| `npm run dev:up` / `npm run dev:down` | Starts in the background / stops |
| `npm run dev:logs` | Follows the API logs |
| `npm run dev:rebuild` | Rebuilds after a `package.json` or `tsconfig` change |
| `npm run dev:db:reset` | Deletes the data volumes (database, simulation) and restarts |
| `npm run prod:up` / `npm run prod:down` | Production images (separate Compose project) |
| `npm test` | Unit tests of all workspaces (the agent tests use a scripted fake model, never a real LLM) |
| `npm run test:db:up` then `npm run test:e2e` | API integration tests on a dedicated Postgres |

| URL | Service |
|---|---|
| [localhost:4200](http://localhost:4200) | Control room |
| [localhost:3000/docs](http://localhost:3000/docs) | API documentation (Swagger) |
| [localhost:3200/simulation](http://localhost:3200/simulation) | Simulation state |

## Troubleshooting

- **Alerts stay "Detected" or investigations fail**: check that Ollama is running (`curl http://localhost:11434/api/tags`) and that `fleet-qwen` appears in `ollama list`.
- **A port is already in use**: change the matching `*_PORT` variable in `.env`, then run `npm run dev` again.
- **After pulling changes to a `package.json`**: run `npm run dev:rebuild`.

## Tech stack

TypeScript (strict, ESM) on Node.js 24, npm workspaces · NestJS 12 and Prisma 7 · PostgreSQL 18 · Model Context Protocol SDK · `openai` SDK against Ollama · Zod contracts shared between services (`packages/contracts`) · Angular 22 (standalone, signals) · Vitest · Docker Compose.
