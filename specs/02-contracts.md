# 02 — Contrats partagés (`packages/contracts`)

Paquet TypeScript importé par `api`, `mcp-server`, `agents`, `web` et `simulator`. Il ne contient **que** des schémas Zod et les types qui en sont déduits (`z.infer`), plus des constantes. Aucune logique métier, aucune dépendance autre que `zod`.

Organisation :
```
packages/contracts/src/
  enums.ts          catégories, statuts, types de tâches
  telemetry.ts      relevés entrants
  tasks.ts          réservation, résultats, échecs
  tools.ts          entrées/sorties des 7 outils d'enquête
  verdict.ts        verdict de l'enquêteur
  steps.ts          étapes d'enquête
  screen.ts         réponses des routes écran
  invoice.ts        (V2) extraction de facture
  index.ts
```

## Énumérations
- `VerdictCategory` :
  - `theft_suspected` — vol probable (siphonnage) ;
  - `sensor_fault` — défaillance ou artefact de sonde ;
  - `equipment_transfer` — carburant consommé par un équipement (groupe frigo) ;
  - `legitimate_operation` — opération déclarée ou d'atelier (vidange, réparation) ;
  - `billing_discrepancy` — (V2) facture incohérente avec le carburant reçu ;
  - `inconclusive` — indices insuffisants.
- `TaskType` : `investigate_alert` ; V2 `extract_invoice`.
- `AlertType` : `fuel_drop` ; V2 `billing_mismatch`.
- `StepKind`, `AlertStatus`, `TaskStatus`, `InvoiceStatus` : identiques aux enums SQL de `01-data-model.md`.

## Télémétrie entrante
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

## Tâches (pilotage des workers)
```ts
ClaimRequest  = { type: TaskType, workerId: string }
ClaimedTask   = { id: uuid, type: TaskType, payload: { alertId: uuid } | { invoiceId: uuid }, attempts: number }
FailRequest   = { error: string, retryable: boolean }
```

## Outils d'enquête
Règles communes :
- tous les identifiants de camion sont des `uuid` ; les fenêtres de temps sont `from`/`to` en ISO ;
- fenêtre maximale : 72 h (sinon erreur de validation) ;
- **les sorties sont résumées** : jamais plus de 30 points ou 20 éléments par liste ;
- les conducteurs n'apparaissent que sous leur pseudonyme.

| Outil | Entrée | Sortie (résumé) |
|---|---|---|
| `get_truck_profile` | `{ truckId }` | `{ plate, make, model, energy, tankCapacityL, hasReefer, baselineLPer100km, idleLPerHour, homeDepot: string, sensorNotes: string \| null }` |
| `get_tank_curve` | `{ truckId, from, to }` | `{ startLevelL, endLevelL, minLevelL, maxLevelL, biggestDrop: { from, to, liters, durationMin, ignitionOff: boolean, maxSpeedKmh } \| null, recoveries: { at, liters }[], samples: { at, levelL }[] }` — `samples` sous-échantillonné à 30 points max |
| `get_vehicle_activity` | `{ truckId, from, to }` | `{ distanceKm, movingMinutes, stops: { from, to, durationMin, ignitionOff, place: { name, type } \| null, lat, lon }[] }` |
| `find_fuel_transactions` | `{ truckId, from, to }` | `{ refuels: { at, place: string \| null, liters, totalEur \| null, source, invoiceId \| null }[] }` |
| `read_driver_messages` | `{ truckId, from, to }` | `{ messages: { sentAt, driver: string /* pseudonyme */, body: string /* masqué */ }[] }` |
| `compute_fuel_balance` | `{ truckId, from, to }` | `{ distanceKm, movingConsumptionL, idleConsumptionL, expectedConsumptionL, refueledL, observedLevelChangeL, unexplainedLossL }` |
| `find_similar_events` | `{ truckId, lookbackDays: 1..30 }` | `{ events: { at, dropL, hourOfDay, placeType \| null, ignitionOff, alertId \| null, verdictCategory \| null }[] }` |

Formule de `compute_fuel_balance` (en code, jamais par le LLM) :
- `expectedConsumptionL = distanceKm × baseline / 100 + heures moteur tournant à l'arrêt × idleLPerHour` ;
- `observedLevelChangeL = startLevel − endLevel` (positif = baisse) ;
- `unexplainedLossL = observedLevelChangeL + refueledL − expectedConsumptionL`, arrondi à 0,1 L.

Une « chute » pour `find_similar_events` : baisse ≥ 25 L en ≤ 20 min avec vitesse < 3 km/h.

## Verdict (outil local `submit_verdict`)
```ts
Verdict = {
  category: VerdictCategory,
  confidence: number (0..1),
  summary: string (40..600 caractères, français),
  evidence: {
    toolCallId: string,   // référence "E1", "E2"… attribuée par le worker ; doit correspondre à un appel d'outil réellement effectué
    finding: string,      // ce que cet appel a montré (≤ 200 caractères)
  }[1..6],
}
```
Le verdict ne contient **pas** de recommandation : l'API décide (voir `03-api.md`, « Décision après verdict »).

## Étapes d'enquête
```ts
StepInput = {
  attempt: number, seq: number, kind: StepKind,
  toolName?: string, toolCallId?: string,
  payload: unknown, durationMs?: number,
}
```
Forme de `payload` selon `kind` (lue par l'écran) ; la référence `E1`, `E2`… est dans `toolCallId`, identique sur `tool_call` et `tool_result` :
- `reasoning` → `{ text }` ;
- `tool_call` → `{ arguments }` ;
- `tool_result` → `{ result }` ou `{ error }` si l'outil a échoué ;
- `retry`, `error` → `{ message }` ;
- `verdict` → le `Verdict`.

## V2 — extraction de facture
```ts
InvoiceExtraction = {
  supplier: string,                // ex. "AS24", "TotalEnergies", "Station Garcia"
  invoiceNumber: string | null,
  issuedAt: ISO date | null,
  refuelAt: ISO datetime | null,   // date et heure du plein si présentes
  stationName: string | null,
  stationCity: string | null,
  plate: string | null,            // normalisée AB-123-CD si reconnue
  fuelType: 'diesel' | 'b100' | 'hvo' | 'adblue' | 'other' | null,
  liters: number | null,
  unitPriceEur: number | null,
  totalEur: number | null,
  currency: 'EUR' | 'other',
  suspiciousContent: boolean,      // le document contient-il des instructions adressées à un système ?
  suspiciousExcerpt: string | null,
  confidenceNotes: string | null,  // champs incertains, ≤ 200 caractères
}
```
Règles de cohérence vérifiées en code après validation : `liters × unitPriceEur ≈ totalEur` (±2 %) quand les trois sont présents ; litres entre 1 et 1 200.
