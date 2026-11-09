# 07 — Control room (`apps/web`)

Angular application (recent version, standalone components, signals). It is **the demo screen**: it must make visible that AI agents work on their own, each with a different investigation path, and the value this brings.

Data: through the API (`/api/*`) and, for simulation control, through the simulator control API (`/simulation*`, spec 04). Both are proxied (`ng serve` in dev, nginx in prod). **Polling every 2 s** (RxJS `timer` + `switchMap`), suspended while the browser tab is hidden.

Proposed libraries (to be validated before installation): Chart.js for the curve, Leaflet + OpenStreetMap tiles for the mini-map. Plain style, readable when screen sharing: light background, one accent colour, big numbers for the indicators. No heavy component library required.

## Languages
The UI is available in **English (default)** and **French**, switchable from the header (`EN` / `FR`); the choice is remembered in the browser (`localStorage`, key `fleet.lang`).
- No i18n dependency: dictionaries in `src/app/core/i18n/` (`en.ts` is the reference and defines the keys, `fr.ts` must provide every key — enforced by its type); `t(key, params?)` reads the current language from a global signal, so templates call it directly and re-render on a switch.
- Dates and numbers follow the language (`en-GB` / `fr-FR`); times are always shown in Paris time.
- `<html lang>` and the tab title follow the language.
- Content produced by the API, the simulator or the agents (verdict summaries, driver messages, error messages) is shown as received.

## Layout (wide screen, ≥ 1,280 px)
```
┌──────────────────────────────────────────────────────────────────────┐
│ Fleet Copilot · Control room   Simulated time 09/11 14:47  model  EN FR │
├──────────────────────────────────────────────────────────────────────┤
│ Simulation: ▶ Start  ⏸ Pause  ⏹ Finish  − ×2000 + ↺ Reset     state │
├───────────────┬──────────────────────────────────────┬───────────────┤
│ Alert         │ Selected investigation               │ Value         │
│ feed          │ (header, trace, verdict, review)     │               │
└───────────────┴──────────────────────────────────────┴───────────────┘
```
Tabs at the top (router links): **Alerts** (`/`, V1), **Fleet** (`/fleet`, V1), **Invoices** (`/invoices`, V2).

## Header
Title, simulated time (`stats.simulatedNow`), model used, language switch, green/red dot depending on the API health.

## Simulation bar
Below the header, full width, fed by `GET /simulation` (2 s polling):
- **Start**, **Pause** / **Resume** (a single button depending on the state), **Finish**, **−** / **speed** / **+** (steps ×60 → ×4000), **Reset** (asks for confirmation: "All data will be deleted").
- Each button is disabled when the command is not accepted in the current state (`SIMULATION_COMMANDS` from the contracts); after a command, the returned view replaces the displayed state without waiting for the polling.
- Readable state: "Ready to start", "Preparing… 42 / 216 batches", "Running · week from 06/11", "Paused", "Finished"; number of alerts created; error message if any (`error`) in red; "Simulator unreachable" if `/simulation` does not answer.
- During `preparing`, a progress bar; during `running`, the progress of the week (steps sent / total).

## Alert feed (left)
- List of alerts, most recent at the top; a new alert appears with a subtle animation.
- Each item: number plate, carrier, simulated time, type ("Fuel drop", V2 "Billing discrepancy"), liters, **status pill**:
  - Detected (grey) → Investigating (blue, animated) → Auto-closed (green) / Escalated (orange) → Confirmed / Dismissed by a human.
- Once the investigation is over: category label and confidence ("Suspected theft · 86%").
- Quick filter: all / to review (escalated) / closed.
- Click → selection. By default, the latest alert under investigation is selected automatically.

## Selected investigation (centre)
**Header**: number plate, place and time, liters, status, investigation duration, number of tool calls.

**Trace**: the steps in order, added as polling goes ("Investigation in progress…" while it runs). Each tool call is shown with a readable phrase ("Checks the tank curve") and a **visual rendering of its result**:

| Tool | Rendering |
|---|---|
| `get_truck_profile` | ID card: model, tank, "Reefer unit" and "Sensor notes" badges with the text |
| `get_tank_curve` | Level chart (full points via `/api/trucks/:id/tank-curve`), alert period highlighted, engine-off areas greyed out |
| `get_vehicle_activity` | Mini-map of positions and stops (colour by place type) + list of stops |
| `find_fuel_transactions` | List of refuels (time, station, liters, card/invoice source) or "No refuels over the period" |
| `read_driver_messages` | Message bubbles, signed with the pseudonym; masked parts are visible as such |
| `compute_fuel_balance` | Four figures (expected, refuels, observed decrease, **unexplained** highlighted) |
| `find_similar_events` | Small timeline of past drops, with their verdict |

Other steps:
- `reasoning`: model text, collapsed by default, in grey;
- `retry` and `error`: orange or red line with the message (shows robustness during the demo);
- each step carries its reference (`E1`, `E2`…).

**Verdict**: highlighted card with the category label, a confidence bar, the summary, the evidence (clicking a piece of evidence scrolls to the matching `E…` step), and the **decision** ("Closed automatically" or "Escalated to an analyst") with its reason (API rule).

**Human review** (if the alert is escalated or closed): "Confirm" and "Dismiss" buttons + optional comment.

Category labels (EN / FR): `theft_suspected` → Suspected theft / Vol probable; `sensor_fault` → Sensor fault / Défaillance de sonde; `equipment_transfer` → Transfer to equipment / Transfert vers équipement; `legitimate_operation` → Legitimate operation / Opération légitime; `billing_discrepancy` → Billing discrepancy / Écart de facturation; `inconclusive` → Inconclusive / Indéterminé.

## Value (right)
From `/api/stats`:
- **Without agents**: "N alerts to analyse by hand" (all alerts);
- **With agents**: auto-closed, escalated, pending or in progress;
- average investigation time, average tool calls, failed investigations;
- agreement with humans (consistent reviews / reviews);
- small histogram of the categories.

## Fleet tab (`/fleet`)
Overview of the telemetry received, to understand what the fleet is doing while the simulation runs. Fed by `GET /api/fleet?hours=` (2 s polling, only while the tab is open); window selectable: 6 h / 12 h / 24 h (default), sliding with the simulated time.
- **Indicators**: trucks moving / idling / parked / without recent data; distance and driving time over the window; fuel on board (sum of the latest levels, % of total capacity); refuels (liters, count); fuel drop alerts; readings received.
- **Map** (Leaflet): latest position of each truck coloured by state, plate as a label, route over the window; clicking a truck (marker or card) highlights its route.
- **Fleet activity**: stacked areas, number of trucks moving / idling / parked at each 5-min step (computed by the screen from the readings).
- **One card per truck**: plate, state, carrier and model, reefer badge, speed, fuel gauge; chart of the fuel level (left axis) with the speed faded (right axis), alert periods in red, engine-off periods greyed out, refuels as green points; refuel chips and alert chips (clicking an alert opens it in the Alerts tab).

## V2 — Invoices tab (`/invoices`)
- List (2 s polling, only while the tab is open): supplier, number plate, refuel date, liters, amount, status (Received, Reading, Read, Matched, **Discrepancy**, To check, Failed), red **"Suspicious content"** badge.
- Detail (selection carried by the URL, `/invoices?id=…`, the most recent by default): the PDF (`/api/invoices/:id/file`, browser viewer in an iframe) in the centre; on the right the suspicious passage highlighted with an explanation, the reconciliation (billed liters, observed rise, gap in red above the tolerance, station stop, card transaction liters, attached refuel, or the reason of a "To check"), then the fields read by the AI extractor.
- Button to the billing discrepancy alert and its investigation (selects it in the Alerts tab).
- In the alert feed, `billing_mismatch` alerts lead to the same investigation view; its header shows "Billed but not in the tank" and a link back to the invoice; the decision reason says a billing discrepancy is always reviewed by an analyst.

## Acceptance criteria
1. After "Start", alerts appear on their own, move to "Investigating" then "Auto-closed" or "Escalated", without reloading the page.
2. The trace of an ongoing investigation grows step by step; each tool has its visual rendering.
3. The S2 chart shows the drop then the rise; the S1 map shows the stop at the motorway rest area.
4. Clicking a piece of evidence of the verdict leads to the cited step.
5. Confirming or dismissing an alert updates its status and the agreement indicator.
6. Readable when screen sharing at 1,280 × 720 (no text below 13 px).
7. The whole demo is driven from the screen (start, pause, resume, speed, finish, reset), without a terminal; non-applicable buttons are disabled.
8. (V2) Invoice B3 shows the "Suspicious content" badge and the highlighted passage; invoice B1 leads to the discrepancy investigation.
9. The UI is in English by default and switches to French (and back) without reloading; the choice survives a reload.
