# 00 — Overview

## The business problem (fictional)
A simple detector raises alerts as soon as a tank level drops abnormally. Most of them are false positives (faulty sensor, transfer to a reefer unit, workshop job). An analyst spends 10 to 20 minutes per alert cross-checking sources. Fleet Copilot hands this investigation over to an AI agent, which returns an evidence-backed verdict and only escalates to humans what deserves it. In V2, an AI extractor reads fuel invoices, and a reconciliation in code detects billing discrepancies, which in turn become alerts to investigate.

Guiding principle: **code detects and computes, AI investigates and explains, the human decides.**

## Services

| Service | Role | Version | Port | Talks to |
|---|---|---|---|---|
| `postgres` | Business data + task queue | V1 | 5432 | — |
| `api` (NestJS) | Control centre: ingestion, detector, tasks, investigations, screen and agent routes; V2: invoices, reconciliation | V1 | 3000 | postgres |
| `mcp-server` | 7 read-only investigation tools (thin adapter over the API agent routes) | V1 | 3100 | api |
| `investigator` | Worker: investigator agent | V1 | — | api (control), mcp-server (tools), Ollama |
| `extractor` | Worker: AI invoice extractor | V2 | — | api, Ollama |
| `web` (Angular) | Control room, including simulation control | V1 | 4200 | api, simulator |
| `simulator` | Long-running service: simulates the trucks' telematics boxes and the suppliers; generates the data when the simulation starts, loads it, replays the demo day; driven from the screen | V1 | 3200 | api |
| `generator` | Offline CLI: PDF invoices and driver messages | V2 | — | Ollama, files |
| Ollama (host) | `fleet-qwen` model | V1 | 11434 | — |

## V1 flow: from alert to verdict
0. In the control room, "Start": the simulator wipes the database, generates the dataset in memory, loads the reference data and the history, then replays the demo day step by step (adjustable speed, pause, stop, reset).
1. The simulator sends the demo day readings: `POST /api/telemetry`.
2. The API stores them. The detector module applies its rules; if there is an abnormal drop, it creates an `alert` (status `detected`) and an `investigate_alert` `task` (status `pending`).
3. `investigator` polls `POST /agent/tasks/claim` every 2 s. The API claims a task (`FOR UPDATE SKIP LOCKED`) and moves the alert to `investigating`.
4. The worker fetches the alert context and the MCP server's tool list, and starts the loop with the model. Each requested tool is run through MCP; each step is recorded via `POST /agent/investigations/:alertId/steps`.
5. The model ends with the local `submit_verdict` tool. The worker validates the verdict (Zod + evidence check) and sends it to the API. **The API decides** between auto-close and escalation according to rules in code.
6. `web` polls the API every 2 s and shows alerts, trace and verdict. A human can confirm or dismiss.

## V2 flow: from invoice to alert
1. The simulator drops the day's PDF invoices during the replay: `POST /api/invoices` (multipart).
2. The API stores the file, extracts its text (code, not AI) and creates an `extract_invoice` `task`.
3. `extractor` claims the task, reads the text through the API, calls the model with an enforced output format, validates (Zod, 2 retries), sends the result back.
4. The API records the refuel and runs the **reconciliation** (code). On a discrepancy, a `billing_mismatch` alert + investigation task: the investigator picks it up like any other alert.

## Structural decisions (not to be challenged without discussion)
- **NestJS is the only service connected to PostgreSQL.**
- **Task queue in PostgreSQL** (`tasks` table), without Redis or BullMQ. Workers pull their work (2 s polling).
- **Agent = three connections**: the API directly for control (claim, steps, verdict), the MCP server for the tools the model sees, Ollama for reasoning.
- **Hand-written agent loop**, without an agent framework.
- **The model only sees read tools**, summarised results and pseudonymised drivers.
- **The extractor is not an agent** (no loop, no tools): it is an LLM pipeline with structured output.
- **Polling** on the screen side (no SSE or WebSocket in V1/V2).
- **The simulation is driven from the screen**: the simulator is a service that keeps its own state (memory + volume), with no table in Postgres; the screen talks to it directly (`/simulation` proxy), the API does not know about it.

## Glossary
- **Alert**: anomaly detected by a rule in code (`fuel_drop`, V2: `billing_mismatch`).
- **Task**: work to be done by a worker, in the `tasks` table.
- **Investigation** (`investigation`): a run of the agent on an alert, with its steps and its verdict.
- **Step** (`investigation_step`): a model message, a tool call, its result, a retry or an error.
- **Demo day**: day D on which the simulation is started (Paris time), replayed at accelerated speed. The preceding month (D − 1 month to D − 1) is the history loaded at startup.
- **Simulation**: one run of the simulator, from "Start" to the end of the day or to a reset; states `idle`, `preparing`, `running`, `paused`, `finished`.

## Spec index
- `01-data-model.md` — PostgreSQL schema
- `02-contracts.md` — shared schemas (`packages/contracts`)
- `03-api.md` — NestJS
- `04-simulator.md` — data, scenarios, replay, simulation control
- `05-mcp-server.md` — investigation tools
- `06-agents.md` — investigator and extractor
- `07-web.md` — control room
- `08-infra-local.md` — Docker Compose, Ollama, variables, scripts
- `09-implementation-plan.md` — milestones and order of work
- `10-generator.md` — (V2) PDF invoices and messages
