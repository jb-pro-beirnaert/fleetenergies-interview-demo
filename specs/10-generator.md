# 10 — Générateur de documents (`apps/generator`, V2)

CLI lancée **une fois, hors ligne**, pour produire des documents réalistes et variés. Ses sorties sont **versionnées dans le repo** : la démo et les tests ne dépendent jamais d'une nouvelle génération.

> **À trancher en M8** : le jeu de données du simulateur est désormais recalculé à chaque « Démarrer » avec J = date du jour (spec 04), donc les dates et instants des pleins changent d'une simulation à l'autre. Les PDF versionnés ne peuvent plus porter de dates figées : soit le code les produit au `start` en réinjectant les faits du jour dans un habillage versionné (le modèle n'intervient qu'une fois, hors ligne), soit les factures sont générées à chaque simulation sans modèle. Les chiffres restent toujours fixés par le code.

Principe : **le code fixe les faits, le modèle habille.** Les chiffres (litres, prix, montants, dates, immatriculations) viennent toujours des fichiers du simulateur ; le modèle ne produit que la forme (intitulés, mentions, tournures).

## Commandes
| Commande | Effet |
|---|---|
| `generator invoices` | lit `invoices-plan.json`, `live-refuels.json`, `reference.json` (produits par `simulator generate --out`, ou en appelant `generate()` directement) ; écrit `data/generated/live-invoices/*.pdf` et `live-invoices/manifest.json` |
| `generator messages` | réécrit les messages de `live-messages.json` en langage naturel ; écrit `live-messages.json` (l'original est conservé dans `live-messages.templates.json`) |

## Factures
1. Pour chaque facture planifiée, le code assemble les **faits** : fournisseur, station, adresse fictive, date et heure, immatriculation, carburant, litres facturés (différents des litres réels pour B1), prix unitaire, montants HT / TVA 20 % / TTC.
2. Le modèle reçoit ces faits et un **style de fournisseur** (4 gabarits : AS24, TotalEnergies, relevé DKV multi-lignes, station indépendante) et renvoie un JSON d'**habillage** : numéro de facture au format du fournisseur, libellés des lignes, mentions de bas de page, formulation de l'en-tête. Sortie structurée validée par Zod.
3. Le code rend le PDF (bibliothèque à proposer, par exemple `pdfkit`) avec une mise en page propre à chaque gabarit. **Le code réinjecte les chiffres** : le modèle ne les touche jamais.
4. Cas particuliers, produits par le code :
   - **B3** : ajout, en petits caractères dans le pied de page, de la phrase d'injection prévue dans `invoices-plan.json` ;
   - **B4** : virgules décimales, montants HT et TTC, immatriculation sans tirets, date au format « 14 oct. 2026 ».
5. `manifest.json` : fichier, facture planifiée, valeurs exactes attendues (reprises dans `ground-truth.json`).

Le texte doit être **extractible** (PDF texte, pas d'image) : vérifier chaque PDF généré en relisant son texte avec la même bibliothèque que l'API.

## Messages des conducteurs
- Le modèle réécrit chaque message modèle (« bien arrivé chez le client ») dans un style naturel de conducteur : court, parfois sans ponctuation, abréviations courantes, sans changer le sens.
- Les messages des scénarios conservent leurs **faits clés**, vérifiés en code après génération : pour S4, le nom et le numéro de téléphone du mécanicien doivent être présents tels quels (ils servent à démontrer le masquage) ; pour S2, la mention de la jauge ; pour S3, celle du groupe froid. Si la vérification échoue, nouvelle génération (3 essais), puis conservation du message original.

## Critères d'acceptation
1. Chaque PDF de `live-invoices/` est lisible et son texte extrait contient les litres et le total attendus.
2. Les 4 gabarits sont visuellement différents.
3. La phrase d'injection n'apparaît que dans la facture B3.
4. Relancer `generator` ne modifie aucun chiffre (seulement la forme).
5. Les faits clés des messages de scénarios sont présents après réécriture.
