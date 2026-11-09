# 02 — Shared contracts (`packages/contracts`)

TypeScript package imported by `api`, `mcp-server`, `agents`, `web` and `simulator`. It contains **only** Zod schemas and the types inferred from them (`z.infer`), plus constants. No business logic, no dependency other than `zod`.

Layout:
```
packages/contracts/src/
  enums.ts          categories, statuses, task types
  telemetry.ts      incoming readings
  tasks.ts          claim, results, failures
  tools.ts          inputs/outputs of the 7 investigation tools
  verdict.ts        investigator verdict
  steps.ts          investigation steps
  screen.ts         screen route responses
  fleet.ts          fleet overview (`GET /api/fleet`, Fleet tab)
  admin.ts          history loading
  simulation.ts     simulator control (states, view, commands)
  simulation-constants.ts  speed steps and commands per state, without zod (imported by the screen)
  invoice.ts        (V2) invoice extraction
  index.ts
```

## Enums
- `VerdictCategory`:
  - `theft_suspected` — likely theft (siphoning);
  - `sensor_fault` — sensor failure or artefact;
  - `equipment_transfer` — fuel used by a piece of equipment (reefer unit);
  - `legitimate_operation` — declared or workshop operation (draining, repair);
  - `billing_discrepancy` — (V2) invoice inconsistent with the fuel received;
  - `inconclusive` — insufficient clues.
- `TaskType`: `investigate_alert`; V2 `extract_invoice`.
- `AlertType`: `fuel_drop`; V2 `billing_mismatch`.
- `StepKind`, `AlertStatus`, `TaskStatus`, `InvoiceStatus`: identical to the SQL enums of `01-data-model.md`.

## Incoming telemetry
```ts
TelemetryReading = {
  truckId: uuid,
  recordedAt: ISO datetime,
  lat: number, lon: number,
  speedKmh: number >= 0,
  ignition: boolean,
  fuelLevelL: number >= 0,
  odometerKm: number >= 0,
}
TelemetryBatch = { readings: TelemetryReading[1..500], source: 'history' | 'live' }
```

## Simulation (simulator control API)
```ts
SimulationStatus  = 'idle' | 'preparing' | 'running' | 'paused' | 'finished'
SIMULATION_SPEEDS = [60, 120, 300, 600, 1000, 2000, 4000]   // steps; SimulationSpeed = one of them
SimulationCommand = 'start' | 'pause' | 'resume' | 'stop' | 'reset'
SIMULATION_COMMANDS: Record<SimulationStatus, SimulationCommand[]>   // commands accepted per state
SimulationView = {
  status: SimulationStatus,
  demoDate: 'YYYY-MM-DD' | null,        // D: date of the start, first day of the demo week
  clock: ISO datetime | null,            // simulated time of the last step sent
  speed: SimulationSpeed,
  progress: { done: int, total: int } | null,   // history batches (preparing) or steps of the week
  alertsCreated: int,
  error: string | null,
}
SimulationSpeedRequest = { speed: SimulationSpeed }
```
`SIMULATION_COMMANDS` is shared: the simulator uses it to answer 409, the screen to disable the buttons. The constants live in a module without zod and the package is declared `"sideEffects": false`: the screen imports them without bundling zod.

## Tasks (worker control)
```ts
ClaimRequest  = { type: TaskType, workerId: string }
ClaimedTask   = { id: uuid, type: TaskType, payload: { alertId: uuid } | { invoiceId: uuid }, attempts: number }
// InvestigateAlertPayload = { alertId }, ExtractInvoicePayload = { invoiceId }
FailRequest   = { error: string, retryable: boolean }
```

## Investigation tools
Common rules:
- all truck ids are `uuid`s; time windows are `from`/`to` in ISO;
- maximum window: 72 h (otherwise a validation error);
- **outputs are summarised**: never more than 30 points or 20 items per list;
- drivers only appear under their pseudonym.

| Tool | Input | Output (summary) |
|---|---|---|
| `get_truck_profile` | `{ truckId }` | `{ plate, make, model, energy, tankCapacityL, hasReefer, baselineLPer100km, idleLPerHour, homeDepot: string, sensorNotes: string \| null }` |
| `get_tank_curve` | `{ truckId, from, to }` | `{ startLevelL, endLevelL, minLevelL, maxLevelL, biggestDrop: { from, to, liters, durationMin, ignitionOff: boolean, maxSpeedKmh } \| null, recoveries: { at, liters }[], samples: { at, levelL }[] }` — `samples` downsampled to 30 points max |
| `get_vehicle_activity` | `{ truckId, from, to }` | `{ distanceKm, movingMinutes, stops: { from, to, durationMin, ignitionOff, place: { name, type } \| null, lat, lon }[] }` |
| `find_fuel_transactions` | `{ truckId, from, to }` | `{ refuels: { at, place: string \| null, liters, totalEur \| null, source, invoiceId \| null }[] }` |
| `read_driver_messages` | `{ truckId, from, to }` | `{ messages: { sentAt, driver: string /* pseudonym */, body: string /* masked */ }[] }` |
| `compute_fuel_balance` | `{ truckId, from, to }` | `{ distanceKm, movingConsumptionL, idleConsumptionL, expectedConsumptionL, refueledL, observedLevelChangeL, unexplainedLossL }` |
| `find_similar_events` | `{ truckId, lookbackDays: 1..30 }` | `{ events: { at, dropL, hourOfDay, placeType \| null, ignitionOff, alertId \| null, verdictCategory \| null }[] }` |

`compute_fuel_balance` formula (in code, never by the LLM):
- `expectedConsumptionL = distanceKm × baseline / 100 + engine-running hours while stopped × idleLPerHour`;
- `observedLevelChangeL = startLevel − endLevel` (positive = decrease);
- `unexplainedLossL = observedLevelChangeL + refueledL − expectedConsumptionL`, rounded to 0.1 L.

A "drop" for `find_similar_events`: decrease ≥ 25 L in ≤ 20 min with speed < 3 km/h.

## Verdict (local `submit_verdict` tool)
```ts
Verdict = {
  category: VerdictCategory,
  confidence: number (0..1),
  summary: string (40..600 characters, English),
  evidence: {
    toolCallId: string,   // reference "E1", "E2"… assigned by the worker; must match a tool call actually made
    finding: string,      // what that call showed (≤ 200 characters)
  }[1..6],
}
```
The verdict does **not** contain a recommendation: the API decides (see `03-api.md`, "Decision after the verdict").

## Investigation steps
```ts
StepInput = {
  attempt: number, seq: number, kind: StepKind,
  toolName?: string, toolCallId?: string,
  payload: unknown, durationMs?: number,
}
```
Shape of `payload` by `kind` (read by the screen); the `E1`, `E2`… reference is in `toolCallId`, identical on `tool_call` and `tool_result`:
- `reasoning` → `{ text }`;
- `tool_call` → `{ arguments }`;
- `tool_result` → `{ result }` or `{ error }` if the tool failed;
- `retry`, `error` → `{ message }`;
- `verdict` → the `Verdict`.

`durationMs`: on a `tool_result`, the MCP call time; on any other step, the model (LLM) time that produced it — the first step recorded after a model turn carries that turn's time (a turn that records no step, e.g. a nudge, carries over to the next one).

## V2 — invoice extraction
```ts
InvoiceExtraction = {
  supplier: string,                // e.g. "AS24", "TotalEnergies", "Station Garcia"
  invoiceNumber: string | null,
  issuedAt: ISO date | null,
  refuelAt: ISO datetime | null,   // date and time of the refuel if present
  stationName: string | null,
  stationCity: string | null,
  plate: string | null,            // normalised AB-123-CD if recognised
  fuelType: 'diesel' | 'b100' | 'hvo' | 'adblue' | 'other' | null,
  liters: number | null,
  unitPriceEur: number | null,
  totalEur: number | null,
  currency: 'EUR' | 'other',
  suspiciousContent: boolean,      // does the document contain instructions addressed to a system?
  suspiciousExcerpt: string | null,
  confidenceNotes: string | null,  // uncertain fields, ≤ 200 characters
}
```
Consistency rules checked in code by the API (422 otherwise): `liters × unitPriceEur ≈ totalEur` (±2%) when all three are present; liters between 1 and 1,200.

Other V2 schemas (`invoice.ts`):
- `InvoiceUploadFields` (`receivedAt`, `source` = `live` by default: multipart fields of `POST /api/invoices`) → `InvoiceUploadResult { invoiceId, status, suspicious, created }`;
- `InvoiceText { invoiceId, text, receivedAt }` (agent, masked);
- `InvoiceReconciliation { truckId, plate, refuelAt, billedL, observedRiseL, gapL, toleranceL, stationMatched, stationName, refuelId, refuelSource, cardLiters, reason }`;
- `InvoiceExtractionOutcome { invoiceId, status, suspicious, reconciliation, alertId, alreadyExtracted }`;
- screen: `InvoiceListQuery`, `InvoiceListItem` / `InvoiceList` (with the extracted `refuelAt`), `InvoiceDetail` (text, extraction, reconciliation, linked alert).

The extractor imposes on the model a variant of `InvoiceExtraction` (`ModelExtraction`, in `apps/agents`): `refuelAt` is the **local time as printed** (`YYYY-MM-DDTHH:mm`, no time zone), converted to an ISO UTC instant by code (Europe/Paris).
