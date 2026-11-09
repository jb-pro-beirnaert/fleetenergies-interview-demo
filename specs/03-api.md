# 03 — NestJS API (`apps/nestjs`)

Control centre. **The only service connected to PostgreSQL.** NestJS 10+, strict TypeScript, input validation through the `packages/contracts` schemas (Zod pipe), generated OpenAPI documentation (`/docs`).

## Modules
| Module | Responsibility |
|---|---|
| `config` | Environment variables validated at startup |
| `database` | Connection, migrations, transactions |
| `auth` | Token guards: `device`, `agent`, `admin` |
| `fleet` | Trucks, drivers, places (read) |
| `telemetry` | Readings ingestion |
| `detector` | Alert rules applied at ingestion |
| `tasks` | Task queue (creation, claim, completion, failure, sweep) |
| `investigations` | Alert context, steps, verdict, decision |
| `investigation-data` | Calculations of the 7 tools (summaries) — called by the agent routes |
| `pii` | Pseudonymisation and masking |
| `screen` | Read routes for the control room, human review, statistics |
| `admin` | Full reset, history loading |
| `invoices` | (V2) Reception, text, extraction, reconciliation |

## Authentication
Static tokens in V1/V2, passed as `Authorization: Bearer …`:
- `DEVICE_TOKEN`: ingestion routes (`/api/telemetry`, V2 `/api/invoices`) — used by the simulator;
- `AGENT_API_TOKEN`: all `/agent/*` routes — used by the workers and the MCP server;
- `ADMIN_TOKEN`: `/admin/*` routes.

The screen routes (`/api/*` reads and the review) are open locally. A route receiving a wrong token answers 401; a route of another role, 403.

## Ingestion — `POST /api/telemetry` (device token)
- Body: `TelemetryBatch`.
- Batch insert with `ON CONFLICT (truck_id, recorded_at) DO NOTHING` (idempotent).
- If `source = 'live'`, the detector is called for each truck concerned, in chronological order. If `source = 'history'`, no detection.
- Response `202`: `{ inserted, alertsCreated }`.

## Other ingestions (device token)
- `POST /api/fuel-card-transactions` — `{ transactions: { truckId, occurredAt, placeId?, liters, unitPriceEur, totalEur }[], source }` → `refuels` with `source = fuel_card`. Idempotent on `(truck_id, occurred_at)`.
- `POST /api/driver-messages` — `{ messages: { driverId, truckId, sentAt, body }[], source }`. Idempotent on `(driver_id, sent_at)`.

The matching schemas are to be added to `contracts/telemetry.ts`.

## Detector (module, called by the ingestion)
Deliberately **naive**: it must produce false positives; the agent does the sorting.

`FUEL_DROP` rule, evaluated for each new reading `R` of a truck:
1. Load the truck's readings over `[R.recordedAt − 20 min, R.recordedAt]`.
2. Take the maximum level `Lmax` of that window and its timestamp.
3. If `Lmax − R.fuelLevelL ≥ FUEL_DROP_MIN_L` (default 40) **and** the speed stayed `< 3 km/h` on all readings in between → anomaly.
4. **Anti-duplicate**: if there is a `fuel_drop` alert for this truck with `window_end ≥ R.recordedAt − 30 min`:
   - if it is still `detected`: extend it (`window_end`, `drop_l`, `details`);
   - otherwise: do nothing (the ongoing investigation will see the full curve).
5. Otherwise, create the alert (`detected`) and an `investigate_alert` task with `available_at = now() + DETECTOR_DEBOUNCE_SECONDS` (default 15 s, to let the episode finish during the accelerated replay).

`details` contains: `levelBeforeL`, `levelAfterL`, `maxSpeedKmh`, `ignitionOffShare` (share of readings with the engine off), `lat`, `lon`.

## Task queue — agent routes (agent token)
- `POST /agent/tasks/claim` — body `ClaimRequest`. Claims with the query from `01-data-model.md`. Response `200 ClaimedTask` or `204` if nothing. Side effect for `investigate_alert`: alert → `investigating`, creation or reopening of the `investigation` (`running`).
- `POST /agent/tasks/:id/complete` — task → `done`.
- `POST /agent/tasks/:id/fail` — body `FailRequest`. If `retryable` and `attempts < max_attempts`: back to `pending` with `available_at = now() + 10 s × attempts`; otherwise `failed`, the investigation moves to `failed` and the alert to `escalated` with `details.failure`. (V2) For an `extract_invoice` task that failed permanently, the invoice moves to `needs_review`.
- **Sweep** every 30 s: `in_progress` tasks with an expired lock and `attempts >= max_attempts` → handled as a permanent failure.

Only the worker holding the lock (`locked_by`) can complete or fail a task (409 otherwise).

## Investigations — agent routes (agent token)
- `GET /agent/alerts/:id` → context: `{ alertId, type, truckId, plate, windowStart, windowEnd, dropL, details, detectedAt }`. No personal data.
- `POST /agent/investigations/:alertId/steps` — body `StepInput`. Idempotent on `(investigation, attempt, seq)`.
- `POST /agent/investigations/:alertId/verdict` — body `{ verdict: Verdict, model, promptVersion, toolCallsCount }`.
  - Checks that each `evidence.toolCallId` exists among the `tool_call` steps of the current attempt (otherwise 422 with the list of unknown ids).
  - **Idempotent**: if the investigation is already `completed`, returns 200 without changing anything.
  - Stores the verdict, then applies the decision.

### Decision after the verdict (code, not AI)
- `theft_suspected`, `billing_discrepancy`, `inconclusive` → **always** `escalated`;
- other categories: `confidence ≥ AUTO_CLOSE_MIN_CONFIDENCE` (default 0.75) → `closed`, otherwise `escalated`.

## Tool data — agent routes (agent token)
Adapted 1:1 by the MCP server. `from`, `to` parameters in the query (ISO), validated by the `contracts/tools.ts` schemas. Calculations and summaries are done here.

| Route | Tool |
|---|---|
| `GET /agent/trucks/:truckId/profile` | `get_truck_profile` |
| `GET /agent/trucks/:truckId/tank-curve` | `get_tank_curve` |
| `GET /agent/trucks/:truckId/activity` | `get_vehicle_activity` |
| `GET /agent/trucks/:truckId/fuel-transactions` | `find_fuel_transactions` |
| `GET /agent/trucks/:truckId/driver-messages` | `read_driver_messages` |
| `GET /agent/trucks/:truckId/fuel-balance` | `compute_fuel_balance` |
| `GET /agent/trucks/:truckId/similar-events?lookbackDays=` | `find_similar_events` |

Calculation details:
- **Stops** (`activity`): run of readings at speed < 3 km/h for ≥ 5 min; linked to the nearest place if the distance is ≤ `radius_m`.
- **Distance**: odometer difference.
- **`biggestDrop`**: largest decrease between two readings ≤ 20 min apart, vehicle stopped.
- **`recoveries`**: rises ≥ 25 L with no refuel recorded within 30 min (sign of a sensor artefact).
- **Downsampling** of the curves: 30 points max, keeping the extremes.

## Pseudonymisation (`pii` module)
Applied to every response of the `/agent/*` routes:
- a driver is referred to by their `pseudonym`;
- in free text (messages, V2 invoice text), the following are replaced:
  - full names, first names and last names of known drivers (case- and accent-insensitive) → pseudonym;
  - French phone numbers (`(?:\+33|0)\s?[1-9](?:[\s.-]?\d{2}){4}`) → `[phone masked]`;
  - email addresses → `[email masked]`.

The screen routes return the real names (authenticated human — out of V1 scope).

## Screen routes (`/api`, read)
- `GET /api/alerts?status=&limit=50` → list sorted by `detected_at desc`: `{ id, type, status, decision, plate, carrier, detectedAt, windowStart, windowEnd, dropL, category, confidence, toolCallsCount }`.
- `GET /api/alerts/:id` → alert + truck + investigation (verdict, duration, model) + steps (all attempts) + human review.
- `GET /api/trucks/:id/tank-curve?from&to` → full points `{ at, levelL, speedKmh, ignition }[]` for the chart.
- `GET /api/trucks/:id/positions?from&to` → `{ at, lat, lon, speedKmh, ignition }[]` for the mini-map.
- `GET /api/places` → places (for the map).
- `GET /api/fleet?hours=24` (1–72) → fleet overview (Fleet tab): window `[to − hours, to]` where `to` = latest reading received, any source (`from`/`to` = `null` before any reading); per truck (sorted by plate): identity, `state` from the latest reading (`moving` ≥ 3 km/h, `idling` stopped engine on, `parked` engine off, `no_data` if none or older than 30 min before `to`), `last`, every reading of the window `{ at, lat, lon, speedKmh, ignition, levelL }`, `distanceKm`, `movingMinutes` (same functions as the tools), refuels `{ at, liters }`, alerts overlapping the window `{ id, status, windowStart, windowEnd, dropL }`. Per-truck queries on the `(truck_id, recorded_at)` index.
- `POST /api/alerts/:id/review` — `{ decision: 'confirm' | 'dismiss', comment? }`, only if the alert is `escalated` or `closed`; sets the alert to `confirmed` / `dismissed`.
- `GET /api/stats` →
  ```
  { alerts: { total, byStatus }, ruleOnly: { toReviewManually: total },
    withAgents: { autoClosed, escalated, pending },
    investigations: { avgDurationSeconds, avgToolCalls, failed },
    humanAgreement: { reviewed, agreed },   // agreed = number of `confirm` reviews
    model, simulatedNow }                    // simulatedNow = latest live recordedAt received
  ```
- `GET /api/health`.

## Administration (admin token)
- `POST /admin/history/load` — receives the reference data and history generated by the simulator (see `04-simulator.md`), in batches. Idempotent.
- `POST /admin/wipe` — empties all tables (see `01-data-model.md`). Answers 204. Called by the simulator on every "Start" and "Reset".

## V2 — Invoices
- `POST /api/invoices` (device token, multipart `file` + `receivedAt`):
  1. stores the PDF in `INVOICE_STORAGE_DIR` (Docker volume);
  2. extracts the text in code (**unpdf**, the library the simulator tests already use to re-read the PDFs); if there is no text → `failed`;
  3. **injection detection in code** on the raw text (patterns: "ignore … instructions", "system instruction(s)", "system prompt", "you are an assistant", "you are", "assistant:") → `suspicious = true` + excerpt;
  4. creates an `extract_invoice` task. Status `received`.
- `GET /agent/invoices/:id/text` (agent) → `{ invoiceId, text, receivedAt }`, text masked by the `pii` module.
- `POST /agent/invoices/:id/extraction` (agent) — body `InvoiceExtraction`. Checks the consistency rules of `02-contracts.md` (otherwise 422, the worker will retry). Merges `suspicious` (code OR model). Status `extracted`, then reconciliation.
- `GET /api/invoices`, `GET /api/invoices/:id` (with extraction, reconciliation, linked alert), `GET /api/invoices/:id/file` (PDF).

### Reconciliation (code, V2)
1. Truck by normalised plate. Not found or missing → `needs_review`.
2. Refuel instant: `refuelAt`, otherwise `needs_review`.
3. Observed tank rise: `max(level over [t, t+60 min]) − min(level over [t−30 min, t])`.
4. Presence at a fuel station: a stop of the truck at a `fuel_station` place within `[t−30 min, t+30 min]`.
5. Refuel: if there is a `fuel_card` `refuel` of the truck within ±30 min, the invoice is attached to it; otherwise a `refuel` with `source = invoice` is created.
6. Gap = billed liters − observed rise. If `gap > max(20 L, 8% of billed liters)` **or** no presence at a fuel station → `mismatch`: `billing_mismatch` alert (`details`: `invoiceId`, `billedL`, `observedRiseL`, `gapL`, `stationMatched`, `stationName`) + `investigate_alert` task. Otherwise `matched`.

For a `billing_mismatch` alert, the `find_fuel_transactions` tool does return the billed refuel, and the alert context includes the `details` above.

## Acceptance criteria
**V1**
1. A batch of `history` readings creates no alert; a `live` batch containing a 60 L drop while stopped in 12 min creates exactly one alert and one task.
2. Replaying the same batch twice inserts nothing the second time.
3. A drop over several successive readings creates a single alert, extended while it is `detected`.
4. Two simultaneous claims (integration test with two parallel requests) get two different tasks; a task whose `available_at` is in the future cannot be claimed.
5. A claimed task whose lock expires can be claimed again; after 3 attempts, it moves to `failed` and the alert to `escalated`.
6. A verdict citing a non-existent `toolCallId` is rejected (422); a second submission of the same verdict has no effect (200).
7. The decision rules are respected (unit tests on each category and threshold).
8. No `/agent/*` response contains a driver's `full_name` or `phone` (test that walks all agent routes on the test data).
9. `compute_fuel_balance` gives the expected result on a hand-built set of readings.
10. `/admin/wipe` empties all tables, reference data and history included.
11. `/docs` serves the OpenAPI documentation.

**V2**
12. An uploaded PDF invoice creates an `extract_invoice` task; a PDF without text moves to `failed`.
13. The text of the trapped invoice is flagged `suspicious` by the code, even if the model does not report it.
14. An inconsistent extraction (liters × price ≠ total) is rejected (422).
15. A compliant invoice is `matched` and attached to the right refuel; an overbilled invoice creates a `billing_mismatch` alert and an investigation task.
