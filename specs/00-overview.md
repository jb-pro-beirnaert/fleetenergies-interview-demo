# 00 — Vue d'ensemble

## Le problème métier (fictif)
Un détecteur simple lève des alertes dès qu'un niveau de réservoir chute anormalement. La plupart sont des faux positifs (capteur défaillant, transfert vers un groupe frigo, opération d'atelier). Un analyste passe 10 à 20 minutes par alerte à croiser les sources. Fleet Copilot confie cette enquête à un agent IA, qui rend un verdict prouvé et n'escalade aux humains que ce qui le mérite. En V2, un extracteur IA lit les factures carburant, et un rapprochement en code détecte les écarts de facturation, qui deviennent à leur tour des alertes à enquêter.

Principe directeur : **le code détecte et calcule, l'IA enquête et explique, l'humain décide.**

## Services

| Service | Rôle | Version | Port | Parle à |
|---|---|---|---|---|
| `postgres` | Données métier + file de tâches | V1 | 5432 | — |
| `api` (NestJS) | Centre de contrôle : ingestion, détecteur, tâches, enquêtes, routes écran et agents ; V2 : factures, rapprochement | V1 | 3000 | postgres |
| `mcp-server` | 7 outils d'enquête en lecture seule (adaptateur fin sur les routes agents de l'API) | V1 | 3100 | api |
| `investigator` | Worker : agent enquêteur | V1 | — | api (pilotage), mcp-server (outils), Ollama |
| `extractor` | Worker : extracteur IA de factures | V2 | — | api, Ollama |
| `web` (Angular) | Salle de contrôle | V1 | 4200 | api |
| `simulator` | CLI : génère les données, les charge, rejoue la journée de démo | V1 | — | api |
| `generator` | CLI hors ligne : factures PDF et messages conducteurs | V2 | — | Ollama, fichiers |
| Ollama (hôte) | Modèle `fleet-qwen` | V1 | 11434 | — |

## Flux V1 : de l'alerte au verdict
1. `simulator replay` envoie les relevés de la journée de démo : `POST /api/telemetry`.
2. L'API les enregistre. Le module détecteur applique ses règles ; s'il y a chute anormale, il crée une `alert` (statut `detected`) et une `task` `investigate_alert` (statut `pending`).
3. `investigator` interroge `POST /agent/tasks/claim` toutes les 2 s. L'API réserve une tâche (`FOR UPDATE SKIP LOCKED`) et passe l'alerte en `investigating`.
4. Le worker récupère le contexte de l'alerte, la liste des outils du serveur MCP, et lance la boucle avec le modèle. Chaque outil demandé est exécuté via MCP ; chaque étape est enregistrée via `POST /agent/investigations/:alertId/steps`.
5. Le modèle termine par l'outil local `submit_verdict`. Le worker valide le verdict (Zod + vérification des preuves) et l'envoie à l'API. **L'API décide** de l'auto-clôture ou de l'escalade selon des règles en code.
6. `web` interroge l'API toutes les 2 s et affiche alertes, trace et verdict. Un humain peut confirmer ou rejeter.

## Flux V2 : de la facture à l'alerte
1. `simulator replay` dépose les factures PDF de la journée : `POST /api/invoices` (multipart).
2. L'API stocke le fichier, extrait son texte (code, pas IA) et crée une `task` `extract_invoice`.
3. `extractor` réclame la tâche, lit le texte via l'API, appelle le modèle avec un format de sortie imposé, valide (Zod, 2 relances), renvoie le résultat.
4. L'API enregistre le plein et lance le **rapprochement** (code). En cas d'écart, alerte `billing_mismatch` + tâche d'enquête : l'enquêteur s'en saisit comme de toute autre alerte.

## Décisions structurantes (à ne pas remettre en cause sans discussion)
- **NestJS est le seul service connecté à PostgreSQL.**
- **File de tâches dans PostgreSQL** (table `tasks`), sans Redis ni BullMQ. Les workers tirent leur travail (polling 2 s).
- **Agent = trois connexions** : API en direct pour le pilotage (claim, étapes, verdict), serveur MCP pour les outils que voit le modèle, Ollama pour le raisonnement.
- **Boucle agent écrite à la main**, sans framework d'agents.
- **Le modèle ne voit que des outils de lecture**, des résultats résumés et des conducteurs pseudonymisés.
- **L'extracteur n'est pas un agent** (pas de boucle, pas d'outils) : c'est un pipeline LLM à sortie structurée.
- **Polling** côté écran (pas de SSE ni WebSocket en V1/V2).

## Glossaire
- **Alerte** : anomalie détectée par une règle en code (`fuel_drop`, V2 : `billing_mismatch`).
- **Tâche** : travail à faire par un worker, dans la table `tasks`.
- **Enquête** (`investigation`) : exécution de l'agent sur une alerte, avec ses étapes et son verdict.
- **Étape** (`investigation_step`) : un message du modèle, un appel d'outil, son résultat, une relance ou une erreur.
- **Journée de démo** : le jour J où `simulator generate` est lancé (heure de Paris), rejouée en accéléré. Le mois qui précède (J − 1 mois à J − 1) est l'historique chargé d'avance.

## Index des specs
- `01-data-model.md` — schéma PostgreSQL
- `02-contracts.md` — schémas partagés (`packages/contracts`)
- `03-api.md` — NestJS
- `04-simulator.md` — données, scénarios, rejeu
- `05-mcp-server.md` — outils d'enquête
- `06-agents.md` — enquêteur et extracteur
- `07-web.md` — salle de contrôle
- `08-infra-local.md` — Docker Compose, Ollama, variables, scripts
- `09-implementation-plan.md` — jalons et ordre de réalisation
- `10-generator.md` — (V2) factures PDF et messages
