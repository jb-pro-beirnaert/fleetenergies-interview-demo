# 01 — Modèle de données (PostgreSQL 18)

Propriétaire : `apps/nestjs`. Migrations versionnées (outil au choix de l'API : migrations TypeORM, Prisma ou Kysely + fichiers SQL ; **préférer des migrations SQL lisibles**). Identifiants `uuid` (générés par `gen_random_uuid()`) sauf mention contraire. Horodatages en `timestamptz`, stockés en UTC.

## Référentiel

### `carriers` — transporteurs
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text not null | « Transports Durance », « Frigo Sud » |

Deux transporteurs dès la V1 : la V3 pourra démontrer l'isolation multi-tenant sans migration.

### `places` — lieux
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text not null | « AS24 Valence Sud », « Aire de Saint-Rambert-d'Albon » |
| type | enum `place_type` | `fuel_station`, `depot`, `workshop`, `rest_area`, `customer`, `other` |
| brand | text null | AS24, TotalEnergies, DKV… (stations) |
| lat, lon | double precision not null | |
| radius_m | int not null default 150 | rayon pour rattacher une position au lieu |

### `trucks`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| carrier_id | uuid FK carriers | |
| plate | text unique not null | format français `AB-123-CD` |
| make, model | text not null | |
| energy | enum `energy` | `diesel`, `b100`, `hvo` |
| tank_capacity_l | int not null | 400 à 800 |
| has_reefer | boolean not null | groupe frigo alimenté par le réservoir principal |
| baseline_l_per_100km | numeric(4,1) not null | consommation habituelle |
| idle_l_per_hour | numeric(3,1) not null | consommation au ralenti |
| home_depot_id | uuid FK places | |
| sensor_notes | text null | historique connu de la sonde (« sonde remplacée le 02/09, valeurs erratiques signalées ») |

### `drivers`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| carrier_id | uuid FK | |
| full_name | text not null | **donnée personnelle** |
| phone | text not null | **donnée personnelle** |
| pseudonym | text unique not null | `C-01`, `C-02`… seule identité exposée aux agents |

### `driver_assignments` — qui conduit quoi et quand
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| truck_id, driver_id | uuid FK | |
| starts_at, ends_at | timestamptz | |

## Données d'activité

### `telemetry_readings`
| Colonne | Type | Notes |
|---|---|---|
| id | bigint identity PK | |
| truck_id | uuid FK | |
| recorded_at | timestamptz not null | |
| lat, lon | double precision | |
| speed_kmh | numeric(5,1) | |
| ignition | boolean | contact moteur |
| fuel_level_l | numeric(6,1) | niveau mesuré par la sonde |
| odometer_km | numeric(9,1) | |
| source | enum `reading_source` | `history`, `live` — permet de réinitialiser la journée de démo |

Contraintes et index : `unique (truck_id, recorded_at)` (idempotence de l'ingestion) ; index `(truck_id, recorded_at desc)`.
Note pour l'oral : chez FleetEnergies cette table vivrait dans ClickHouse ; ici ~50 000 lignes suffisent à Postgres. Le partitionnement mensuel est une évolution possible, pas un besoin.

### `refuels` — pleins
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| truck_id | uuid FK | |
| occurred_at | timestamptz not null | |
| place_id | uuid FK places null | |
| liters | numeric(6,1) not null | |
| unit_price_eur | numeric(5,3) null | |
| total_eur | numeric(8,2) null | |
| source | enum `refuel_source` | `fuel_card` (V1, données de carte carburant), `invoice` (V2, issu d'une extraction) |
| invoice_id | uuid FK invoices null | V2 |
| data_origin | enum `reading_source` | `history`, `live` |

Contrainte : `unique (truck_id, occurred_at)` (idempotence de l'ingestion des cartes carburant).

### `driver_messages`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| driver_id, truck_id | uuid FK | |
| sent_at | timestamptz not null | |
| body | text not null | texte libre, peut contenir des noms et numéros (**à masquer** côté agents) |
| data_origin | enum `reading_source` | |

Contrainte : `unique (driver_id, sent_at)`.

## Alertes et enquêtes

### `alerts`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| truck_id | uuid FK | |
| type | enum `alert_type` | `fuel_drop` ; V2 : `billing_mismatch` |
| status | enum `alert_status` | voir cycle de vie |
| window_start, window_end | timestamptz | période de l'anomalie |
| drop_l | numeric(6,1) null | `fuel_drop` : litres perdus |
| details | jsonb not null default '{}' | données de la règle (niveaux avant/après, vitesse max, contact) ; V2 : litres facturés vs constatés, `invoice_id` |
| detected_at | timestamptz not null | |
| decision | enum `alert_decision` null | `auto_closed`, `escalated` (décidé par l'API à réception du verdict) |

Cycle de vie : `detected` → `investigating` → `closed` (auto-clôture) ou `escalated` → après revue humaine : `confirmed` ou `dismissed`. Si l'enquête échoue définitivement : `escalated` avec `details.failure`.

### `investigations`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| alert_id | uuid FK **unique** | une seule enquête par alerte : rend le verdict idempotent |
| status | enum | `running`, `completed`, `failed` |
| model | text | ex. `fleet-qwen` |
| prompt_version | text | ex. `investigator-v1` |
| started_at, finished_at | timestamptz | |
| category | enum `verdict_category` null | voir `02-contracts.md` |
| confidence | numeric(3,2) null | 0 à 1 |
| summary | text null | 2-3 phrases pour l'humain |
| verdict | jsonb null | verdict complet validé |
| tool_calls_count | int not null default 0 | |

En cas de nouvelle tentative (tâche relancée), on réutilise la ligne : remise à `running`, étapes précédentes conservées avec `attempt` incrémenté.

### `investigation_steps`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| investigation_id | uuid FK | |
| attempt | int not null default 1 | |
| seq | int not null | ordre dans la tentative ; `unique (investigation_id, attempt, seq)` |
| kind | enum `step_kind` | `reasoning` (texte du modèle), `tool_call`, `tool_result`, `retry`, `error`, `verdict` |
| tool_name | text null | |
| tool_call_id | text null | identifiant de l'appel, référencé par les preuves du verdict |
| payload | jsonb not null | arguments, résultat (tronqué à 20 Ko), message d'erreur… |
| duration_ms | int null | |
| created_at | timestamptz | |

### `human_reviews`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| alert_id | uuid FK unique | |
| decision | enum | `confirm` (l'humain valide le verdict de l'agent), `dismiss` (verdict jugé faux) |
| comment | text null | |
| reviewed_at | timestamptz | |

## File de tâches

### `tasks`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| type | enum `task_type` | `investigate_alert` ; V2 : `extract_invoice` |
| payload | jsonb not null | `{ "alertId": "…" }` ou `{ "invoiceId": "…" }` |
| status | enum `task_status` | `pending`, `in_progress`, `done`, `failed` |
| attempts | int not null default 0 | incrémenté à chaque réservation |
| max_attempts | int not null default 3 | |
| available_at | timestamptz not null default now() | la tâche n'est réservable qu'à partir de cet instant (anti-rebond du détecteur) |
| locked_until | timestamptz null | |
| locked_by | text null | identifiant du worker |
| last_error | text null | |
| created_at, updated_at | timestamptz | |

Index partiel : `(type, created_at) where status in ('pending', 'in_progress')`.

Requête de réservation (dans une transaction) :

```sql
UPDATE tasks
SET status = 'in_progress', attempts = attempts + 1,
    locked_until = now() + interval '5 minutes', locked_by = $2, updated_at = now()
WHERE id = (
  SELECT id FROM tasks
  WHERE type = $1
    AND available_at <= now()
    AND (status = 'pending' OR (status = 'in_progress' AND locked_until < now()))
    AND attempts < max_attempts
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

Une tâche `in_progress` dont le verrou a expiré et dont `attempts >= max_attempts` passe en `failed` (balayage par l'API toutes les 30 s) ; l'alerte associée passe en `escalated`.

## V2 — factures

### `invoices`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| status | enum `invoice_status` | `received`, `extracting`, `extracted`, `matched`, `mismatch`, `needs_review`, `failed` |
| file_path | text not null | chemin dans le volume de stockage |
| original_filename | text | |
| raw_text | text null | texte extrait du PDF par le code |
| extraction | jsonb null | résultat validé de l'extracteur |
| suspicious | boolean not null default false | contenu ressemblant à une instruction |
| suspicious_excerpt | text null | passage à surligner à l'écran |
| matched_refuel_id | uuid FK refuels null | |
| match_details | jsonb null | litres facturés, hausse constatée, écart, position |
| received_at | timestamptz | |
| data_origin | enum `reading_source` | |

## Réinitialisation de la journée de démo
`POST /admin/reset` supprime tout ce qui a `data_origin`/`source = 'live'`, puis toutes les alertes, enquêtes, étapes, revues, tâches et factures liées à la journée de démo. L'historique (`history`) est conservé.
