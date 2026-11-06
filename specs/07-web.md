# 07 — Salle de contrôle (`apps/web`)

Application Angular (version récente, composants autonomes, signals). C'est **l'écran de la démo** : il doit rendre visible que des agents IA travaillent seuls, chacun avec un chemin d'enquête différent, et la valeur que ça apporte.

Données : via l'API (`/api/*`) et, pour le pilotage de la simulation, via l'API de contrôle du simulateur (`/simulation*`, spec 04). Les deux sont proxifiés (`ng serve` en dev, nginx en prod). **Polling toutes les 2 s** (RxJS `timer` + `switchMap`), suspendu quand l'onglet du navigateur est masqué.

Bibliothèques proposées (à valider avant installation) : Chart.js pour la courbe, Leaflet + tuiles OpenStreetMap pour la mini-carte. Style sobre et lisible en partage d'écran : fond clair, une couleur d'accent, gros chiffres pour les indicateurs. Pas de bibliothèque de composants lourde obligatoire.

## Mise en page (écran large, ≥ 1 280 px)
```
┌──────────────────────────────────────────────────────────────────────┐
│ Fleet Copilot · Salle de contrôle   Heure simulée 06/11 02:47   modèle │
├──────────────────────────────────────────────────────────────────────┤
│ Simulation : ▶ Démarrer  ⏸ Pause  ⏹ Terminer  − ×120 +  ↺ Reset  état │
├───────────────┬──────────────────────────────────────┬───────────────┤
│ Flux          │ Enquête sélectionnée                 │ Valeur        │
│ d'alertes     │ (en-tête, trace, verdict, revue)     │               │
└───────────────┴──────────────────────────────────────┴───────────────┘
```
Onglets en haut : **Alertes** (V1), **Factures** (V2).

## Bandeau
Titre, heure simulée (`stats.simulatedNow`), modèle utilisé, point vert/rouge selon la santé de l'API.

## Barre de simulation
Sous le bandeau, pleine largeur, alimentée par `GET /simulation` (polling 2 s) :
- **Démarrer**, **Pause** / **Reprendre** (un seul bouton selon l'état), **Terminer**, **−** / **vitesse** / **+** (paliers ×30 → ×600), **Reset** (demande de confirmation : « Toutes les données seront supprimées »).
- Chaque bouton est grisé quand la commande n'est pas acceptée dans l'état courant (`SIMULATION_COMMANDS` des contrats) ; après une commande, la vue renvoyée remplace l'état affiché sans attendre le polling.
- État lisible : « Prête à démarrer », « Préparation… 42 / 216 lots », « En cours · journée du 06/11 », « En pause », « Terminée » ; nombre d'alertes créées ; message d'erreur éventuel (`error`) en rouge ; « Simulateur injoignable » si `/simulation` ne répond pas.
- Pendant `preparing`, une barre de progression ; pendant `running`, la progression de la journée (pas envoyés / total).

## Flux d'alertes (gauche)
- Liste des alertes, la plus récente en haut ; une nouvelle alerte apparaît avec une animation discrète.
- Chaque élément : immatriculation, transporteur, heure simulée, type (« Chute de carburant », V2 « Écart de facturation »), litres, **pastille de statut** :
  - Détectée (gris) → En enquête (bleu, animée) → Classée auto (vert) / Escaladée (orange) → Confirmée / Rejetée par un humain.
- Une fois l'enquête finie : libellé de catégorie et confiance (« Vol probable · 86 % »).
- Filtre rapide : toutes / à traiter (escaladées) / classées.
- Clic → sélection. Par défaut, la dernière alerte en enquête est sélectionnée automatiquement.

## Enquête sélectionnée (centre)
**En-tête** : immatriculation, lieu et heure, litres, statut, durée de l'enquête, nombre d'appels d'outils.

**Trace** : les étapes dans l'ordre, ajoutées au fil du polling (« Enquête en cours… » tant qu'elle tourne). Chaque appel d'outil est affiché avec une phrase lisible (« Consulte la courbe du réservoir ») et un **rendu visuel de son résultat** :

| Outil | Rendu |
|---|---|
| `get_truck_profile` | Carte d'identité : modèle, réservoir, badges « Groupe frigo », « Notes sonde » avec le texte |
| `get_tank_curve` | Graphique du niveau (points complets via `/api/trucks/:id/tank-curve`), période de l'alerte surlignée, zones moteur coupé grisées |
| `get_vehicle_activity` | Mini-carte des positions et arrêts (couleur par type de lieu) + liste des arrêts |
| `find_fuel_transactions` | Liste des pleins (heure, station, litres, source carte/facture) ou « Aucun plein sur la période » |
| `read_driver_messages` | Bulles de messages, signées du pseudonyme ; les parties masquées sont visibles comme telles |
| `compute_fuel_balance` | Quatre chiffres (attendu, pleins, baisse observée, **inexpliqué** mis en évidence) |
| `find_similar_events` | Petite frise des chutes passées, avec leur verdict |

Autres étapes :
- `reasoning` : texte du modèle, replié par défaut, en gris ;
- `retry` et `error` : ligne orange ou rouge avec le message (montre la robustesse en démo) ;
- chaque étape porte sa référence (`E1`, `E2`…).

**Verdict** : carte mise en avant avec la catégorie en français, une barre de confiance, le résumé, les preuves (cliquer sur une preuve fait défiler jusqu'à l'étape `E…` correspondante), et la **décision** (« Classée automatiquement » ou « Escaladée à un analyste ») avec sa raison (règle de l'API).

**Revue humaine** (si l'alerte est escaladée ou classée) : boutons « Confirmer » et « Rejeter » + commentaire facultatif.

Libellés des catégories : `theft_suspected` → Vol probable ; `sensor_fault` → Défaillance de sonde ; `equipment_transfer` → Transfert vers équipement ; `legitimate_operation` → Opération légitime ; `billing_discrepancy` → Écart de facturation ; `inconclusive` → Indéterminé.

## Valeur (droite)
Depuis `/api/stats` :
- **Sans agents** : « N alertes à analyser à la main » (toutes les alertes) ;
- **Avec agents** : classées automatiquement, escaladées, en attente ou en cours ;
- temps moyen d'enquête, appels d'outils moyens, enquêtes en échec ;
- accord avec les humains (revues cohérentes / revues) ;
- petit histogramme des catégories.

## V2 — onglet Factures
- Liste : fournisseur, immatriculation, date du plein, litres, montant, statut (Reçue, En lecture, Lue, Rapprochée, **Écart**, À vérifier, Échec), badge rouge **« Contenu suspect »**.
- Détail en deux colonnes : le PDF (`/api/invoices/:id/file`) à gauche ; à droite les champs extraits, le rapprochement (litres facturés, hausse constatée, écart, station reconnue), et le passage suspect surligné s'il y en a un.
- Lien vers l'alerte d'écart de facturation et son enquête.
- Dans le flux d'alertes, les alertes `billing_mismatch` mènent à la même vue d'enquête.

## Critères d'acceptation
1. Après « Démarrer », les alertes apparaissent seules, passent « En enquête » puis « Classée » ou « Escaladée », sans rechargement de la page.
2. La trace d'une enquête en cours s'enrichit étape par étape ; chaque outil a son rendu visuel.
3. Le graphique de S2 montre la chute puis la remontée ; la carte de S1 montre l'arrêt sur l'aire d'autoroute.
4. Cliquer sur une preuve du verdict amène à l'étape citée.
5. Confirmer ou rejeter une alerte met à jour son statut et l'indicateur d'accord.
6. Lisible en partage d'écran à 1 280 × 720 (pas de texte sous 13 px).
7. Toute la démo se pilote depuis l'écran (démarrer, pause, reprise, vitesse, terminer, reset), sans terminal ; les boutons non applicables sont grisés.
8. (V2) La facture B3 affiche le badge « Contenu suspect » et le passage surligné ; la facture B1 mène à l'enquête d'écart.
