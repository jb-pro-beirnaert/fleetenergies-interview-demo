# 09 — Plan d'implémentation

Chaque jalon se termine par : tests verts, critères d'acceptation concernés vérifiés, commit. On ne commence pas un jalon avant que le précédent soit stable. Fin de V1 et fin de V2 = tag Git (`v1`, `v2`) et démo complète rejouable.

## V1 (≈ 4 à 5 jours)

| Jalon | Contenu | Specs | Durée |
|---|---|---|---|
| **M0** | Monorepo npm workspaces, TypeScript strict partagé, ESLint/Prettier, `packages/contracts` (premiers schémas), Docker Compose avec Postgres, `.env.example`, CI GitHub Actions | 00, 02, 08 | ½ j |
| **M1** | Simulateur `generate` : référentiel, physique, historique, journée de démo, scénarios S1-S8, `ground-truth.json` + tests | 04 | ¾ j |
| **M2** | API : migrations, `admin/history/load` et `admin/reset` (remplacé par `admin/wipe` en M6b), ingestion (télémétrie, cartes, messages), détecteur, file de tâches et balayage | 01, 03 | 1 j |
| **M3** | API : routes de données des outils, pseudonymisation, contexte d'alerte, étapes, verdict et décision, routes écran, statistiques, OpenAPI | 03 | ½ j |
| **M4** | Serveur MCP : 7 outils, authentification, gestion d'erreurs ; vérification avec l'inspecteur MCP | 05 | ¼ j |
| **M5** | Agents : `fleet-qwen`, `smoke:tools`, boucle générique, agent enquêteur, prompt `investigator-v1`, tests avec faux modèle | 06 | ¾ j |
| **M6** | Salle de contrôle Angular : flux, trace avec rendus par outil, verdict, revue, valeur | 07 | ¾ j |
| **M6b** | Simulation pilotée : contrats `simulation.ts`, `POST /admin/wipe` (remplace `/admin/reset`), service `simulator` (machine à états, API de contrôle, volume `simdata`, reprise), barre de simulation dans l'écran, fin des données versionnées | 00, 01, 02, 03, 04, 07, 08 | ¾ j |
| **M7** | Bout en bout : simulation pilotée depuis l'écran, Compose complet, réglage du prompt et des descriptions d'outils sur S1-S8, README de démo | tous | ½ j |

## V2 (≈ 1,5 jour)

| Jalon | Contenu | Specs | Durée |
|---|---|---|---|
| **M8** | Simulateur : scénarios B1-B4 et `invoices-plan.json` ; générateur : factures PDF (4 gabarits) et messages | 04, 10 | ½ j |
| **M9** | API : factures, texte, détection d'injection, rapprochement ; extracteur (sortie structurée, relances) ; alerte `billing_mismatch` traitée par l'enquêteur | 03, 06 | ¾ j |
| **M10** | Onglet Factures, rejeu des factures, vérification bout en bout de B1-B4 | 07 | ¼ j |

## Hors jalons, dès le premier jour
- Créer le compte Azure et demander le quota GPU (pour la V5).
- Installer Ollama, télécharger `qwen2.5:7b-instruct`, créer `fleet-qwen`, lancer `smoke:tools` dès que M5 commence : si le modèle appelle mal les outils, on le saura tôt.

---

# Travailler avec Claude Code

## Mise en place (une fois)
1. Créer le repo, y copier `CLAUDE.md` à la racine et `docs/specs/`. Premier commit.
2. Lancer Claude Code à la racine : il lit `CLAUDE.md` automatiquement à chaque session.

## Un jalon = une session
1. **Repartir d'un contexte propre** (`/clear`) au début de chaque jalon : les specs portent la mémoire du projet, pas l'historique de la conversation.
2. **Demander un plan d'abord**, en mode plan, sans écrire de code (prompt ci-dessous).
3. **Relire et ajuster le plan** : c'est le moment où tu supervises le plus efficacement.
4. **Implémenter par petites étapes** : une étape = quelques fichiers, compilation, tests, puis tu relis le diff et tu commites.
5. **Clore le jalon** : faire vérifier les critères d'acceptation un par un, et mettre à jour la spec si quelque chose a changé.

## Prompt type de début de jalon
```
Jalon M2. Lis CLAUDE.md, docs/specs/00-overview.md, 01-data-model.md, 02-contracts.md et 03-api.md
(sections V1 uniquement). Ne code rien pour l'instant.
Propose un plan d'implémentation en étapes courtes (5 à 8), avec pour chacune : les fichiers créés
ou modifiés, les choix techniques et les critères d'acceptation qu'elle couvre.
Signale toute ambiguïté ou contradiction dans les specs avant de commencer.
```

## Prompt type pendant le jalon
```
Étape 3 du plan. Implémente, ajoute les tests correspondants, lance-les.
Montre-moi le diff et explique en quelques lignes les choix qui ne sont pas évidents.
Propose un message de commit.
```

## Prompt type de fin de jalon
```
Vérifie un par un les critères d'acceptation de M2 (spec 03, section V1, critères 1 à 10 déjà concernés).
Pour chacun : couvert par quel test, ou comment le vérifier à la main.
Liste les écarts avec la spec et propose les modifications de spec correspondantes.
```

## Conseils
- **Contrats d'abord** : tout schéma qui traverse un service est écrit dans `packages/contracts` avant le code qui l'utilise. C'est ce qui garde les 6 applications cohérentes entre des sessions séparées.
- **Garde la main sur la partie IA** (boucle, prompts, descriptions d'outils, validation) : fais-toi expliquer chaque choix, et réécris toi-même le prompt système. Ce sont les questions qu'on te posera.
- **Demande des tests qui reproduisent les cas difficiles** plutôt que des tests de couverture.
- **Refuse les dépendances non demandées** et les « améliorations » hors jalon : demande à Claude de les noter dans une liste « idées » à la place.
- **Si le modèle local se comporte mal** sur un scénario, ajuste d'abord les descriptions d'outils et le prompt, puis seulement le code.
