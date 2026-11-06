# 05 — Serveur MCP (`apps/mcp-server`)

Expose les **7 outils d'enquête** au standard MCP (Model Context Protocol). C'est un **adaptateur fin** : chaque outil valide ses arguments, appelle la route agent correspondante de l'API et renvoie le résultat. **Aucune logique métier, aucun accès à la base.**

## Pourquoi un serveur MCP (à savoir expliquer)
Les mêmes outils servent plusieurs consommateurs : l'agent enquêteur (V1), l'assistant analyste et tout client compatible MCP (V3). Le serveur est aussi un point de contrôle unique : authentification, journalisation et lecture seule.

## Technique
- SDK officiel `@modelcontextprotocol/sdk` (TypeScript), API haut niveau `McpServer` (`registerTool`).
- Transport **Streamable HTTP** sur `MCP_PORT` (défaut 3100), point d'entrée `POST /mcp`, mode sans état (une requête = un serveur et un transport neufs, réponses JSON sans flux SSE). Serveur HTTP Express, créé par `createMcpExpressApp` du SDK. Sans session, `GET` et `DELETE /mcp` répondent 405. `GET /health` est ouvert, sans jeton.
- Option `--stdio` pour brancher un client local en développement (inspecteur MCP).
- Authentification entrante : en-tête `Authorization: Bearer MCP_CLIENT_TOKEN` (V1 : un seul jeton, celui des workers ; V3 : jetons par rôle).
- Appels sortants vers l'API avec `AGENT_API_TOKEN`, timeout 10 s.

## Outils
Schémas d'entrée et de sortie : `packages/contracts/src/tools.ts`. Pour chaque outil, la **description est aussi importante que le code** : c'est elle que lit le modèle pour décider quand l'utiliser. Descriptions en français, 1 à 3 phrases, qui disent **quand** utiliser l'outil et **ce qu'il renvoie**.

| Outil | Route API | Description (à affiner grâce aux evals) |
|---|---|---|
| `get_truck_profile` | `GET /agent/trucks/:truckId/profile` | Fiche du camion : capacité du réservoir, énergie, présence d'un groupe frigo, consommation habituelle, notes connues sur la sonde. À appeler en premier pour connaître le contexte. |
| `get_tank_curve` | `GET /agent/trucks/:truckId/tank-curve` | Niveau du réservoir sur une période, résumé : niveaux de début et de fin, plus forte chute (moteur coupé ou non), remontées sans plein qui peuvent trahir un artefact de sonde. |
| `get_vehicle_activity` | `GET /agent/trucks/:truckId/activity` | Arrêts du camion avec leur durée, l'état du moteur et le type de lieu (station, dépôt, atelier, aire d'autoroute, client). Permet de savoir où et dans quelles conditions la baisse a eu lieu. |
| `find_fuel_transactions` | `GET /agent/trucks/:truckId/fuel-transactions` | Pleins enregistrés (cartes carburant et factures) sur une période. Une chute expliquée par un plein mal enregistré ou une facture incohérente se voit ici. |
| `read_driver_messages` | `GET /agent/trucks/:truckId/driver-messages` | Messages libres envoyés par le conducteur sur une période (pseudonymisés). Peut contenir une explication : intervention d'atelier, problème de jauge, transfert vers le groupe frigo. |
| `compute_fuel_balance` | `GET /agent/trucks/:truckId/fuel-balance` | Calcul exact du bilan carburant : consommation attendue selon les kilomètres et le ralenti, pleins, baisse observée et litres inexpliqués. Utiliser ce calcul plutôt que d'estimer soi-même. |
| `find_similar_events` | `GET /agent/trucks/:truckId/similar-events` | Chutes de niveau comparables du même camion sur les jours précédents, avec l'heure, le lieu et le verdict passé s'il existe. Un motif répété renforce un soupçon. |

## Comportement
- Chaque outil est déclaré avec son schéma d'entrée **et son schéma de sortie** (ceux de `packages/contracts`) et l'annotation `readOnlyHint: true`.
- Arguments invalides → résultat d'outil en erreur (`isError: true`), pour que le modèle puisse se corriger. Pas d'exception non gérée. La validation est faite par le SDK avant l'appel de l'outil : le message est celui du SDK, qui reprend les messages des schémas Zod (par exemple `MCP error -32602: Input validation error: Invalid arguments for tool compute_fuel_balance: fenêtre maximale 72 h at to`). On ne le réécrit pas.
- Erreur de l'API (4xx) → résultat en erreur avec le message de l'API ; (5xx ou timeout) → résultat en erreur « service indisponible, réessaie plus tard ».
- Résultat → `content` texte (JSON compact) **et** `structuredContent` (objet), conformément au SDK. Le SDK vérifie `structuredContent` contre le schéma de sortie : une réponse de l'API hors contrat devient un résultat en erreur plutôt qu'une donnée transmise au modèle.
- Journal d'une ligne par appel **transmis à l'API** : outil, durée, statut, code HTTP de l'API, taille du résultat. **Jamais** le contenu. Les appels refusés par la validation du SDK ne sont pas journalisés. Le journal est écrit sur stderr, car stdout est réservé au protocole en mode `--stdio`.

## Critères d'acceptation
1. L'inspecteur MCP officiel liste les 7 outils avec leurs descriptions et schémas d'entrée.
2. Chaque outil appelé avec des arguments valides renvoie le même contenu que la route API correspondante.
3. Un appel sans jeton ou avec un mauvais jeton est refusé.
4. Des arguments invalides produisent un résultat d'outil en erreur, pas un crash.
5. Le serveur ne contient aucune requête SQL ni dépendance de base de données.
