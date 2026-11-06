# 03 — API NestJS (`apps/api`)

Centre de contrôle. **Seul service connecté à PostgreSQL.** NestJS 10+, TypeScript strict, validation des entrées par les schémas de `packages/contracts` (pipe Zod), documentation OpenAPI générée (`/docs`).

## Modules
| Module | Responsabilité |
|---|---|
| `config` | Variables d'environnement validées au démarrage |
| `database` | Connexion, migrations, transactions |
| `auth` | Guards par jeton : `device`, `agent`, `admin` |
| `fleet` | Camions, conducteurs, lieux (lecture) |
| `telemetry` | Ingestion des relevés |
| `detector` | Règles d'alerte appliquées à l'ingestion |
| `tasks` | File de tâches (création, réservation, fin, échec, balayage) |
| `investigations` | Contexte d'alerte, étapes, verdict, décision |
| `investigation-data` | Calculs des 7 outils (résumés) — appelé par les routes agents |
| `pii` | Pseudonymisation et masquage |
| `screen` | Routes de lecture pour la salle de contrôle, revue humaine, statistiques |
| `admin` | Réinitialisation de la journée de démo, chargement de l'historique |
| `invoices` | (V2) Réception, texte, extraction, rapprochement |

## Authentification
Jetons statiques en V1/V2, passés en `Authorization: Bearer …` :
- `DEVICE_TOKEN` : routes d'ingestion (`/api/telemetry`, V2 `/api/invoices`) — utilisé par le simulateur ;
- `AGENT_API_TOKEN` : toutes les routes `/agent/*` — utilisé par les workers et le serveur MCP ;
- `ADMIN_TOKEN` : routes `/admin/*`.

Les routes écran (`/api/*` en lecture et la revue) sont ouvertes en local. Une route qui reçoit un mauvais jeton répond 401 ; une route d'un autre rôle, 403.

## Ingestion — `POST /api/telemetry` (jeton device)
- Corps : `TelemetryBatch`.
- Insertion en lot avec `ON CONFLICT (truck_id, recorded_at) DO NOTHING` (idempotent).
- Si `source = 'live'`, appel du détecteur pour chaque camion concerné, dans l'ordre chronologique. Si `source = 'history'`, pas de détection.
- Réponse `202` : `{ inserted, alertsCreated }`.

## Autres ingestions (jeton device)
- `POST /api/fuel-card-transactions` — `{ transactions: { truckId, occurredAt, placeId?, liters, unitPriceEur, totalEur }[], source }` → `refuels` avec `source = fuel_card`. Idempotent sur `(truck_id, occurred_at)`.
- `POST /api/driver-messages` — `{ messages: { driverId, truckId, sentAt, body }[], source }`. Idempotent sur `(driver_id, sent_at)`.

Les schémas correspondants sont à ajouter dans `contracts/telemetry.ts`.

## Détecteur (module, appelé par l'ingestion)
Volontairement **naïf** : il doit produire des faux positifs, c'est l'agent qui fait le tri.

Règle `FUEL_DROP`, évaluée pour chaque nouveau relevé `R` d'un camion :
1. Charger les relevés du camion sur `[R.recordedAt − 20 min, R.recordedAt]`.
2. Prendre le niveau maximal `Lmax` de cette fenêtre et son horodatage.
3. Si `Lmax − R.fuelLevelL ≥ FUEL_DROP_MIN_L` (défaut 40) **et** que la vitesse est restée `< 3 km/h` sur tous les relevés entre les deux → anomalie.
4. **Anti-doublon** : s'il existe pour ce camion une alerte `fuel_drop` dont `window_end ≥ R.recordedAt − 30 min` :
   - si elle est encore `detected` : la prolonger (`window_end`, `drop_l`, `details`) ;
   - sinon : ne rien faire (l'enquête en cours verra la courbe complète).
5. Sinon, créer l'alerte (`detected`) et une tâche `investigate_alert` avec `available_at = now() + DETECTOR_DEBOUNCE_SECONDS` (défaut 15 s, pour laisser l'épisode se terminer pendant le rejeu accéléré).

`details` contient : `levelBeforeL`, `levelAfterL`, `maxSpeedKmh`, `ignitionOffShare` (part des relevés moteur coupé), `lat`, `lon`.

## File de tâches — routes agents (jeton agent)
- `POST /agent/tasks/claim` — corps `ClaimRequest`. Réserve avec la requête de `01-data-model.md`. Réponse `200 ClaimedTask` ou `204` si rien. Effet de bord pour `investigate_alert` : alerte → `investigating`, création ou réouverture de l'`investigation` (`running`).
- `POST /agent/tasks/:id/complete` — tâche → `done`.
- `POST /agent/tasks/:id/fail` — corps `FailRequest`. Si `retryable` et `attempts < max_attempts` : retour en `pending` avec `available_at = now() + 10 s × attempts` ; sinon `failed`, l'investigation passe en `failed` et l'alerte en `escalated` avec `details.failure`. (V2) Pour une tâche `extract_invoice` en échec définitif, la facture passe en `needs_review`.
- **Balayage** toutes les 30 s : tâches `in_progress` à verrou expiré et `attempts >= max_attempts` → traitées comme un échec définitif.

Seul le worker titulaire (`locked_by`) peut terminer ou faire échouer une tâche (sinon 409).

## Enquêtes — routes agents (jeton agent)
- `GET /agent/alerts/:id` → contexte : `{ alertId, type, truckId, plate, windowStart, windowEnd, dropL, details, detectedAt }`. Aucune donnée personnelle.
- `POST /agent/investigations/:alertId/steps` — corps `StepInput`. Idempotent sur `(investigation, attempt, seq)`.
- `POST /agent/investigations/:alertId/verdict` — corps `{ verdict: Verdict, model, promptVersion, toolCallsCount }`.
  - Vérifie que chaque `evidence.toolCallId` existe parmi les étapes `tool_call` de la tentative en cours (sinon 422 avec la liste des identifiants inconnus).
  - **Idempotent** : si l'investigation est déjà `completed`, renvoie 200 sans rien modifier.
  - Enregistre le verdict, puis applique la décision.

### Décision après verdict (code, pas IA)
- `theft_suspected`, `billing_discrepancy`, `inconclusive` → **toujours** `escalated` ;
- autres catégories : `confidence ≥ AUTO_CLOSE_MIN_CONFIDENCE` (défaut 0,75) → `closed`, sinon `escalated`.

## Données des outils — routes agents (jeton agent)
Adaptées 1 pour 1 par le serveur MCP. Paramètres `from`, `to` en query (ISO), validés par les schémas de `contracts/tools.ts`. Les calculs et résumés sont faits ici.

| Route | Outil |
|---|---|
| `GET /agent/trucks/:truckId/profile` | `get_truck_profile` |
| `GET /agent/trucks/:truckId/tank-curve` | `get_tank_curve` |
| `GET /agent/trucks/:truckId/activity` | `get_vehicle_activity` |
| `GET /agent/trucks/:truckId/fuel-transactions` | `find_fuel_transactions` |
| `GET /agent/trucks/:truckId/driver-messages` | `read_driver_messages` |
| `GET /agent/trucks/:truckId/fuel-balance` | `compute_fuel_balance` |
| `GET /agent/trucks/:truckId/similar-events?lookbackDays=` | `find_similar_events` |

Détails de calcul :
- **Arrêts** (`activity`) : suite de relevés à vitesse < 3 km/h pendant ≥ 5 min ; rattachés au lieu le plus proche si distance ≤ `radius_m`.
- **Distance** : différence d'odomètre.
- **`biggestDrop`** : plus forte baisse entre deux relevés distants de ≤ 20 min, véhicule à l'arrêt.
- **`recoveries`** : hausses ≥ 25 L sans plein enregistré dans les 30 min (signe d'artefact de sonde).
- **Sous-échantillonnage** des courbes : 30 points max, en conservant les extremums.

## Pseudonymisation (module `pii`)
Appliquée à toute réponse des routes `/agent/*` :
- un conducteur est désigné par son `pseudonym` ;
- dans les textes libres (messages, V2 texte de facture), on remplace :
  - noms complets, prénoms et noms des conducteurs connus (insensible à la casse et aux accents) → pseudonyme ;
  - numéros de téléphone français (`(?:\+33|0)\s?[1-9](?:[\s.-]?\d{2}){4}`) → `[téléphone masqué]` ;
  - adresses e-mail → `[e-mail masqué]`.

Les routes écran renvoient les vrais noms (humain authentifié — hors périmètre V1).

## Routes écran (`/api`, lecture)
- `GET /api/alerts?status=&limit=50` → liste triée par `detected_at desc` : `{ id, type, status, decision, plate, carrier, detectedAt, windowStart, windowEnd, dropL, category, confidence, toolCallsCount }`.
- `GET /api/alerts/:id` → alerte + camion + investigation (verdict, durée, modèle) + étapes (toutes tentatives) + revue humaine.
- `GET /api/trucks/:id/tank-curve?from&to` → points complets `{ at, levelL, speedKmh, ignition }[]` pour le graphique.
- `GET /api/trucks/:id/positions?from&to` → `{ at, lat, lon, speedKmh, ignition }[]` pour la mini-carte.
- `GET /api/places` → lieux (pour la carte).
- `POST /api/alerts/:id/review` — `{ decision: 'confirm' | 'dismiss', comment? }`, uniquement si l'alerte est `escalated` ou `closed` ; met l'alerte en `confirmed` / `dismissed`.
- `GET /api/stats` →
  ```
  { alerts: { total, byStatus }, ruleOnly: { toReviewManually: total },
    withAgents: { autoClosed, escalated, pending },
    investigations: { avgDurationSeconds, avgToolCalls, failed },
    humanAgreement: { reviewed, agreed },   // agreed = nombre de revues `confirm`
    model, simulatedNow }                    // simulatedNow = dernier recordedAt live reçu
  ```
- `GET /api/health`.

## Administration (jeton admin)
- `POST /admin/history/load` — reçoit les fichiers générés par le simulateur (voir `04-simulator.md`) : référentiel + historique, en lots. Idempotent.
- `POST /admin/reset` — supprime la journée de démo (voir `01-data-model.md`). Répond avec les compteurs supprimés.

## V2 — Factures
- `POST /api/invoices` (jeton device, multipart `file` + `receivedAt`) :
  1. stocke le PDF dans `INVOICE_STORAGE_DIR` (volume Docker) ;
  2. extrait le texte en code (bibliothèque PDF à proposer) ; si aucun texte → `failed` ;
  3. **détection d'injection en code** sur le texte brut (motifs : « ignore … consignes/instructions », « instruction(s) système », « system prompt », « tu es un assistant », « you are », « assistant : ») → `suspicious = true` + extrait ;
  4. crée une tâche `extract_invoice`. Statut `received`.
- `GET /agent/invoices/:id/text` (agent) → `{ invoiceId, text, receivedAt }`, texte masqué par le module `pii`.
- `POST /agent/invoices/:id/extraction` (agent) — corps `InvoiceExtraction`. Vérifie les règles de cohérence de `02-contracts.md` (sinon 422, le worker relancera). Fusionne `suspicious` (code OU modèle). Statut `extracted`, puis rapprochement.
- `GET /api/invoices`, `GET /api/invoices/:id` (avec extraction, rapprochement, alerte liée), `GET /api/invoices/:id/file` (PDF).

### Rapprochement (code, V2)
1. Camion par immatriculation normalisée. Introuvable ou absente → `needs_review`.
2. Instant du plein : `refuelAt`, sinon `needs_review`.
3. Hausse constatée du réservoir : `max(niveau sur [t, t+60 min]) − min(niveau sur [t−30 min, t])`.
4. Présence en station : un arrêt du camion à un lieu `fuel_station` dans `[t−30 min, t+30 min]`.
5. Plein : s'il existe un `refuel` `fuel_card` du camion à ±30 min, on lui rattache la facture ; sinon on crée un `refuel` `source = invoice`.
6. Écart = litres facturés − hausse constatée. Si `écart > max(20 L, 8 % des litres facturés)` **ou** pas de présence en station → `mismatch` : alerte `billing_mismatch` (`details` : `invoiceId`, `billedL`, `observedRiseL`, `gapL`, `stationMatched`, `stationName`) + tâche `investigate_alert`. Sinon `matched`.

Pour une alerte `billing_mismatch`, l'outil `find_fuel_transactions` renvoie bien le plein facturé, et le contexte de l'alerte inclut les `details` ci-dessus.

## Critères d'acceptation
**V1**
1. Un lot de relevés `history` ne crée aucune alerte ; un lot `live` contenant une chute de 60 L à l'arrêt en 12 min crée exactement une alerte et une tâche.
2. Rejouer deux fois le même lot n'insère rien la seconde fois.
3. Une chute en plusieurs relevés successifs ne crée qu'une alerte, prolongée tant qu'elle est `detected`.
4. Deux réservations simultanées (test d'intégration avec deux requêtes parallèles) obtiennent deux tâches différentes ; une tâche dont `available_at` est dans le futur n'est pas réservable.
5. Une tâche réservée dont le verrou expire est re-réservable ; après 3 tentatives, elle passe en `failed` et l'alerte en `escalated`.
6. Un verdict citant un `toolCallId` inexistant est refusé (422) ; un second envoi du même verdict est sans effet (200).
7. Les règles de décision sont respectées (tests unitaires sur chaque catégorie et seuil).
8. Aucune réponse `/agent/*` ne contient un `full_name` ou un `phone` de conducteur (test qui parcourt toutes les routes agents sur les données de test).
9. `compute_fuel_balance` donne le résultat attendu sur un jeu de relevés construit à la main.
10. `/admin/reset` remet la journée de démo à zéro sans toucher à l'historique.
11. `/docs` expose la documentation OpenAPI.

**V2**
12. Une facture PDF déposée crée une tâche `extract_invoice` ; un PDF sans texte passe en `failed`.
13. Le texte de la facture piégée est marqué `suspicious` par le code, même si le modèle ne le signale pas.
14. Une extraction incohérente (litres × prix ≠ total) est refusée (422).
15. Une facture conforme est `matched` et rattachée au bon plein ; une facture surfacturée crée une alerte `billing_mismatch` et une tâche d'enquête.
