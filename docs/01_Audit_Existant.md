# Cockpit — Audit de l'existant (phase 1)

Date : 25/11/2026 · Périmètre : `Finances.exe` v1.0 (build du 24/11/2026 01:57), code source `~/cockpit` (WSL),
données `Finances_Data.xlsx` (176 Ko, modifié le 24/11/2026 20:23).
Aucun fichier de l'utilisateur n'a été modifié pendant l'audit : toutes les analyses ont été faites sur une copie
(empreinte SHA-256 identique à l'original vérifiée : `bb420b64…5723`).

---

## 1. Vue d'ensemble

Cockpit est une application **mono-poste, hors ligne, sans installation** qui consolide trois activités :
Perso (EUR), Freelance (EUR/MAD) et Immobilier (immeuble « Amal 1 », MAD, part détenue 67 %).

Ce n'est pas une application Windows « native » au sens classique : c'est un **petit serveur web local écrit en Go**
qui embarque une **interface HTML/JavaScript** et l'affiche dans une fenêtre Edge/Chrome en mode application.
Le classeur Excel joue le rôle de base de données.

```
┌────────────────────────── Poste Windows ───────────────────────────┐
│                                                                    │
│  Fenêtre Edge --app (profil dédié %LOCALAPPDATA%\CockpitFinances)  │
│  ┌──────────────────────────────────────────────┐                  │
│  │ Interface web (vanilla JS, modules ES)       │                  │
│  │ main.js · state.js · calc.js · txform.js     │                  │
│  │ views/ : dashboard, ops, freelance, immo,    │                  │
│  │          wealth, recurring, settings         │                  │
│  └───────────────┬──────────────────────────────┘                  │
│                  │ HTTP 127.0.0.1:47831 + jeton X-Token            │
│  ┌───────────────▼──────────────────────────────┐                  │
│  │ Finances.exe (Go, 12 Mo, aucun runtime)      │                  │
│  │ main.go  : serveur, API, cycle de vie        │                  │
│  │ ops.go   : règles métier, validations        │                  │
│  │ store.go : lecture/écriture xlsx, backups    │                  │
│  └───────────────┬──────────────────────────────┘                  │
│                  │ excelize (réécriture complète du fichier)       │
│  ┌───────────────▼──────────────────────────────┐                  │
│  │ Finances_Data.xlsx   +  Sauvegardes\*.xlsx   │ ← dossier OneDrive│
│  └──────────────────────────────────────────────┘   LVMH Fashion   │
└────────────────────────────────────────────────────────────────────┘
```

## 2. Pile technique et dépendances

| Élément | Détail |
|---|---|
| Langage serveur | Go 1.26, compilé `CGO_ENABLED=0 GOOS=windows GOARCH=amd64`, sous-système GUI (pas de console) |
| Lib Excel | `github.com/xuri/excelize/v2` v2.11.1 (+ dépendances indirectes : mscfb, msoleps, go-deepcopy, efp, nfp, x/crypto, x/net, x/text) |
| Ressources Windows | `go-winres` : icône, manifeste (DPI per-monitor v2, chemins longs), version 1.0.0.0 |
| Interface | HTML + CSS + JavaScript natif (modules ES), **aucun framework, aucune dépendance npm, aucun build** |
| Graphiques | SVG faits main (`charts.js`) : barres, sparklines, courbe, listes à barres |
| Thème | Variables CSS, clair / sombre / automatique |
| Préférences UI | `localStorage` du profil Edge (période, activité, vue immo, thème) |
| Volume de code | Go ≈ 1 500 lignes · JS ≈ 1 800 lignes · CSS 340 lignes · script d'import Python 228 lignes |
| Tests | 1 test Go (aller-retour lecture/écriture du classeur) : OK. Aucun test automatisé de l'interface |
| Gestion de version | **Aucune (pas de dépôt git)** |

## 3. Fonctionnement à l'exécution

1. **Démarrage** : l'exe cherche `Finances_Data.xlsx` dans son dossier (ou `--dir`). S'il n'existe pas, il le crée avec
   les catégories, paramètres et comptes par défaut.
2. **Instance unique** : si le port 47831 répond déjà avec `{"app":"cockpit"}`, l'exe rouvre seulement la fenêtre.
   Si le port est pris par autre chose, il prend un port libre.
3. **Sauvegarde du jour** : à la 1ʳᵉ ouverture de la journée, copie du classeur dans `Sauvegardes\` (40 dernières gardées).
4. **Fenêtre** : lance Edge (sinon Chrome, sinon navigateur par défaut) en `--app`, 1480×940.
5. **Arrêt automatique** : l'interface envoie un battement toutes les 10 s. L'exe s'arrête 8 s après la fermeture de la
   fenêtre, après 180 s sans battement, ou après 90 s si la fenêtre ne s'est jamais ouverte.

### API locale

| Route | Rôle |
|---|---|
| `GET /` | sert `index.html` en y injectant le jeton de session |
| `GET /api/ping` | identification de l'instance (sans jeton, ne renvoie que le nom de l'app) |
| `GET /api/data` | renvoie **toutes** les données (JSON), après relecture du fichier s'il a changé |
| `POST /api/ops` | applique un **lot d'opérations atomique** puis réécrit le fichier ; renvoie toutes les données |
| `POST /api/hb`, `/api/bye` | battement / fermeture de la fenêtre |
| `POST /api/open-excel`, `/api/open-folder` | ouvre le classeur / le dossier dans Windows |
| `POST /api/backup` | sauvegarde manuelle immédiate |

Format d'une opération : `{e: "tx"|"lot"|"tenant"|"client"|"invoice"|"recurring"|"account"|"snapshot"|"param"|"category"|"action", op: "upsert"|"delete", item, id, key}`.
Actions serveur : `generate_recurring` (mois), `recompute_rates`.

### Mécanisme de lecture

- `load()` lit les 10 onglets **par nom d'onglet et par nom d'en-tête de colonne** (l'ordre des colonnes est libre).
- Les dates sont acceptées en numéro de série Excel ou en texte (`AAAA-MM-JJ`, `JJ/MM/AAAA`…), les nombres avec
  virgule ou espaces.
- `normalizeLoaded()` complète les lignes saisies directement dans Excel : devise (EUR par défaut), taux, montant EUR,
  nature (d'après la catégorie), période, montants négatifs transformés en positifs avec inversion du sens,
  HT/TTC/statut des factures, solde EUR des relevés.
- `assignMissingIDs()` numérote les lignes sans ID (max + 1).
- À **chaque appel** API, `ReloadIfChanged()` compare la date de modification du fichier et recharge tout s'il a changé
  (cas d'une modification dans Excel). L'interface relit aussi les données quand la fenêtre reprend le focus.

### Mécanisme d'écriture

- Chaque lot d'opérations est appliqué en mémoire. En cas d'erreur, l'état précédent est restauré (copie JSON).
- `save()` **recrée un classeur entièrement neuf** (`excelize.NewFile`), écrit les 10 onglets + « Lisez-moi », le met
  en forme (tableaux Excel `tblXxx`, en-tête sombre, volets figés, formats date/monétaire), l'enregistre dans
  `Finances_Data.tmp.xlsx` puis le **renomme** par-dessus l'original (10 essais espacés de 250 ms si OneDrive,
  l'antivirus ou Excel verrouillent le fichier). Si le renommage échoue : message « ferme le fichier dans Excel ».
- Les transactions sont triées par date puis ID à chaque écriture.

> **Conséquence importante (déjà vraie aujourd'hui)** : tout ce qui n'est pas dans le modèle est effacé à la prochaine
> écriture depuis l'application : colonne ajoutée à la main, onglet supplémentaire, formule, couleur, tableau croisé
> dynamique enregistré dans ce classeur. Seules les valeurs des colonnes connues survivent.

## 4. Écrans et fonctionnalités

Navigation latérale (7 écrans), bouton « Nouvelle opération » (raccourci **N**), sélecteur de période mois → mois
(8 préréglages) commun à tous les écrans, filtre d'activité (Tout / Perso / Freelance / Immobilier), bascule
« Ma part 67 % / Projet 100 % » pour l'immobilier, thème clair/sombre, encart « Données enregistrées » avec boutons
Excel / dossier.

| Écran | Fonctionnalités |
|---|---|
| **Tableau de bord** | 4 KPI (revenus, dépenses, résultat + taux d'épargne, investi) avec sparkline et écart vs période précédente ; graphique revenus/dépenses (mois, trimestre ou année selon la durée) ; « À surveiller » (loyers en retard / à encaisser, factures à envoyer / impayées > 30 j, seuils TVA et micro, récurrents à générer, relevé de soldes > 35 j) avec action en 1 clic ; résultat par activité ou revenus par source ; « Où part l'argent » ; suivi mensuel catégories × mois ; 8 dernières opérations. Badge du nombre d'alertes dans le menu |
| **Opérations** | Liste filtrable (recherche plein texte sans accents, sens, catégorie, nature), totaux, pagination 120 + 200, clic = modification |
| **Saisie d'opération** (fenêtre) | Dépense/Revenu, montant (EUR/MAD avec conversion affichée), activité, catégories en boutons (6 plus fréquentes sur 150 j + « Toutes »), libellé avec **suggestions issues de l'historique** (préremplit catégorie, montant, lot, tiers), date (Aujourd'hui / Hier), champs contextuels (lot + locataire pour l'immo, client pour le freelance, tiers pour le perso), nature et note en options, « Enregistrer et en ajouter une autre », suppression, raccourcis Entrée / Ctrl+Entrée |
| **Freelance** | KPI facturé / encaissé / en attente / provision à mettre de côté ; jauge des plafonds micro-BNC et TVA par année (prorata 1ʳᵉ année, clients « hors micro » exclus) ; factures (création avec TJM du client, numérotation auto `F-AAAA-NNN`, Marquer envoyée → Marquer payée qui crée les opérations « Prestations » et « TVA collectée », annulation du paiement qui les supprime) ; clients |
| **Immobilier** | KPI loyers encaissés, occupation, loyers à récupérer, résultat d'exploitation ; **grille des loyers** lots × 15 derniers mois (payé / partiel / à encaisser / impayé / vacant, prorata des mois d'entrée-sortie) ; encaissement d'un loyer en 1 clic ou de tous les loyers du mois ; locataires (ajout, départ, anciens) ; charges d'exploitation ; « le projet en chiffres » (investi, rendement brut 12 mois, trésorerie, dettes) |
| **Patrimoine** | Relevé de soldes multi-comptes (report automatique du dernier solde), KPI total / disponible / bloqué / évolution, courbe, gestion des comptes |
| **Automatismes** | Opérations récurrentes mensuelles (jour, début/fin, pause) ; génération d'un mois en 1 clic, **sans doublon possible** (référence `REC{id}:{mois}`) |
| **Paramètres** | Prénom, taux MAD→EUR (+ recalcul de tout l'historique MAD), part immo, seuils et taux freelance, catégories (groupe, icône, nature), lots, fichier & sauvegarde manuelle, apparence |

## 5. Le fichier Excel `Finances_Data.xlsx`

### 5.1 Onglets

11 onglets, **0 formule**, 0 validation de données, chaque onglet de données est un tableau Excel nommé.

| Onglet (tableau) | Lignes | Clé | Contenu |
|---|---:|---|---|
| Transactions (`tblTransactions`) | **2 565** | ID | Toutes les recettes/dépenses, 01/01/2021 → 28/11/2026 |
| Catégories (`tblCategories`) | 77 | Activité + Sens + Catégorie | Boutons de saisie, groupe, nature par défaut, icône |
| Lots (`tblLots`) | 8 | ID (lien par **nom**) | Appartements d'Amal 1, loyer de référence |
| Locataires (`tblLocataires`) | 23 | ID | Locataires actuels et anciens (15 sortis) |
| Clients (`tblClients`) | 2 | ID (lien par **nom**) | Talan (Givenchy) 810 €/j TVA 20 % micro ; Algofi (OCP) 3 600 MAD/j hors micro |
| Factures (`tblFactures`) | 30 | ID + N° | 26 planifiées, 1 envoyée, 3 payées, jusqu'à déc. 2027 |
| Récurrents (`tblRecurrents`) | 9 | ID | 9 abonnements perso à partir du 01/12/2026 |
| Comptes (`tblComptes`) | 12 | ID (lien par **nom**) | Comptes bancaires, cash, caution… |
| Relevés (`tblReleves`) | 4 | ID | 1 relevé (22/11/2026) sur 4 comptes |
| Paramètres (`tblParametres`) | 10 | Paramètre | Clé / valeur / description |
| Lisez-moi | 7 | — | Mode d'emploi (régénéré à chaque écriture) |

### 5.2 Colonnes

**Transactions** : ID · Date · Activité (Perso/Freelance/Immobilier) · Sens (Revenu/Dépense) · Catégorie · Détail ·
Libellé · Montant (toujours > 0) · Devise (EUR/MAD) · Taux vers EUR · Montant EUR · Nature
(Courant/Investissement/Financement) · Tiers · Lot · Période (AAAA-MM) · Réf · Note

**Catégories** : Activité · Sens · Catégorie · Groupe · Nature par défaut · Icône
**Lots** : ID · Code · Nom du lot · Loyer de référence (MAD)
**Locataires** : ID · Lot · Locataire · Loyer (MAD) · Charges forfait (MAD) · Date entrée · Date sortie · Caution (MAD) · Contact · Métier · Note
**Clients** : ID · Client · Devise · TJM · TVA · Compte dans la micro (Oui/Non) · Note
**Factures** : ID · N° facture · Client · Période · Jours · TJM · Devise · Montant HT · TVA · Montant TTC · Date facture · Statut (Planifiée/Envoyée/Payée) · Date paiement · Note
**Récurrents** : ID · Libellé · Activité · Sens · Catégorie · Montant · Devise · Jour du mois · Début · Fin · Actif · Nature · Tiers · Lot
**Comptes** : ID · Compte · Devise · Disponible (Oui/Non) · Ordre
**Relevés** : ID · Date · Compte · Solde · Devise · Solde EUR
**Paramètres** : Paramètre · Valeur · Description

### 5.3 Relations (toutes par **texte**, sans contrainte)

```
Catégories (Activité+Sens+Catégorie) ◄── Transactions, Récurrents
Lots.Nom du lot ◄── Transactions.Lot, Locataires.Lot, Récurrents.Lot
Locataires.Locataire ◄── Transactions.Tiers (immobilier)
Clients.Client ◄── Factures.Client, Transactions.Tiers (freelance)
Comptes.Compte ◄── Relevés.Compte
Transactions.Réf = lien technique :
    REC{idRécurrent}:{AAAA-MM}   opération générée par un automatisme
    LOY{idLocataire}:{AAAA-MM}   loyer encaissé depuis la grille
    CHG{idLocataire}:{AAAA-MM}   charges encaissées depuis la grille
    FAC{idFacture} / FACTVA{idFacture}   paiement d'une facture (HT / TVA)
```

Renommer un lot, un client, un compte ou un locataire **casse silencieusement** ces liens (c'est pour cela que le nom
d'une catégorie n'est pas modifiable dans l'interface).

### 5.4 Règles de calcul

Aucune formule dans Excel : **tous les calculs sont faits par l'application.**

Côté serveur (Go) :
- Montant arrondi à 2 décimales ; Taux = 1 en EUR, = `taux_mad_eur` en MAD ; Montant EUR = Montant × Taux.
- Nature déduite de la catégorie si vide ; Période = mois de la date si vide.
- Facture : HT = Jours × TJM, TTC = HT × (1 + TVA), numéro `F-{année}-{n° sur 3 chiffres}`.
- Génération des récurrents : jour ramené au dernier jour du mois si besoin, idempotente via la Réf.

Côté interface (JS, `calc.js`) :
- **Résultat** = revenus Courant − dépenses Courant. Investissement et Financement sont hors résultat. En vue « Tout »,
  l'investissement immobilier est exclu (déjà compté via l'apport Perso).
- **Pondération immobilier** : × 0,67 en vue « Ma part ».
- **Statut d'une case loyer** : vacant / payé (≥ attendu − 0,5) / partiel / à venir / à encaisser (mois courant) /
  impayé ; mois d'entrée ou de sortie au prorata des jours, arrondi à 50 MAD.
- **Plafonds freelance** : seuls les clients « micro = Oui » et les périodes ≥ `micro_debut` ; payé compté à la date
  de paiement, envoyé à la date de facture, planifié à la période ; 1ʳᵉ année proratisée au nombre de jours.

### 5.5 Inventaire et qualité des données (contrôles faits sur la copie)

| Contrôle | Résultat |
|---|---|
| Transactions par activité | Perso 1 490 · Immobilier 1 072 · Freelance 3 |
| Par nature | Courant 2 093 · Investissement 289 · Financement 183 |
| Par année | 2021 : 26 · 2022 : 27 · 2023 : 27 · 2024 : 721 · 2025 : 741 · 2026 : 1 023 |
| Catégories orphelines | 0 |
| Lots inconnus (transactions / locataires) | 0 / 0 |
| Clients inconnus dans les factures | 0 |
| Période ≠ mois de la date | 0 |
| Montant EUR ≠ Montant × Taux | 0 |
| N° de facture en double | 0 |
| Lignes strictement identiques (date, activité, sens, catégorie, libellé, montant) | 78 groupes / 182 lignes — en majorité légitimes (ex. plusieurs apports en capital le même jour). **Il n'existe donc pas de clé « naturelle » fiable : seule une clé technique peut éviter les doublons.** |
| Colonne Réf | vide sur les 2 565 lignes (historique importé, aucune génération faite depuis) |
| Données de tiers | 9 numéros de téléphone de locataires, métiers, notes personnelles |

Modifications faites depuis la livraison (comparaison avec la sauvegarde du 24/11 02:00) : 2 dépenses (Pain, Picard),
facture F-2026-004 passée en « Envoyée », et 4 paramètres changés :
`seuil_micro`, `seuil_tva`, `seuil_tva_maj` = **1 000 000** (au lieu de 83 600 / 37 500 / 41 250) et
`taux_cotis` = **19,2 %** (au lieu de 25,6 %). → à confirmer (voir § 8).

## 6. Sécurité actuelle

| Point | État |
|---|---|
| Exposition réseau | Écoute uniquement sur 127.0.0.1 — invisible depuis le réseau |
| Accès à l'API | Jeton aléatoire 128 bits par session + contrôle de l'en-tête Host (anti « DNS rebinding ») |
| Authentification utilisateur | Aucune (repose sur la session Windows) |
| Chiffrement des données | Aucun au niveau de l'app ; le fichier est sur **le OneDrive professionnel LVMH Fashion Group** |
| Sauvegardes | Dans un sous-dossier du même OneDrive (+ historique de versions OneDrive) |
| Signature de l'exe | Non signé (avertissement SmartScreen) |
| Secrets dans le code | Aucun |

## 7. Constats pour le passage au multiplateforme

### Ce qui est réutilisable tel quel (atouts)

1. **L'interface est déjà une application web.** Les écrans, les calculs (`calc.js`), la saisie et les graphiques
   tournent dans un navigateur : ils peuvent devenir une PWA sans être réécrits.
2. **Une seule couture à remplacer** : `state.js` concentre tous les échanges (`load()`, `ops()`). En le branchant
   sur une base cloud au lieu du serveur Go, le reste de l'interface ne change presque pas.
3. **Le modèle est déjà relationnel** : 10 tableaux propres, typés, sans formule → correspondance 1 pour 1 avec des
   tables de base de données.
4. **Volume très faible** : ~2 700 lignes au total, ~1 à 2 Mo en JSON. Les offres gratuites suffisent largement.
5. **Les écritures sont déjà des lots atomiques** (`/api/ops`) : bon point de départ pour des transactions en base.
6. Données saines : aucune incohérence détectée, migration sans perte faisable.

### Ce qui bloque en l'état

| # | Constat | Impact |
|---|---|---|
| 1 | Excel = base de données, **réécrit en entier** à chaque saisie, avec rechargement complet si la date du fichier change | Deux appareils qui écrivent = le dernier écrase l'autre ou OneDrive crée une copie en conflit. Pas d'accès depuis l'iPhone sans le serveur Go |
| 2 | IDs entiers `max + 1` attribués localement | Deux appareils (surtout hors ligne) créent le même ID → collision. Il faut des identifiants uniques (UUID) |
| 3 | Pas de date de modification, de version ni de suppression logique | Impossible de détecter un conflit ou de propager une suppression à un appareil hors ligne |
| 4 | Liens par nom (lot, client, compte, locataire, catégorie) | Un renommage casse les liens ; à remplacer par des clés étrangères |
| 5 | Règles métier dans le serveur Go (validation, numérotation, récurrents, conversion) | Elles doivent vivre au même endroit pour tous les appareils (base de données ou code partagé) |
| 6 | Interface pensée pour un écran large : menu latéral fixe, tableaux larges, fenêtres de 700 px, raccourcis clavier, survols | Une vraie adaptation mobile est nécessaire (navigation en bas, cartes, feuilles de saisie plein écran) |
| 7 | Fonctions propres au PC : ouvrir Excel / le dossier, sauvegarde locale, arrêt automatique | À remplacer par import/export et sauvegardes côté cloud |
| 8 | **Données personnelles stockées sur le OneDrive de l'employeur** | Données financières et données de tiers sur un espace professionnel ; accès perdu en cas de départ ; une connexion iPhone/API à ce OneDrive passe par les règles de LVMH (consentement admin, Intune) — en pratique, l'option « Excel + OneDrive pro » est très probablement inutilisable |
| 9 | Pas de gestion de version du code | À mettre en place avant toute modification |
| 10 | Les ajouts faits à la main dans le classeur (colonnes, onglets, formules) sont effacés | À garder en tête : dans la cible, Excel doit être un format d'import/export, pas un espace de travail |

## 8. Questions à trancher avant la phase 2

1. **Paramètres freelance** : les seuils à 1 000 000 et les cotisations à 19,2 % sont-ils volontaires (pour couper les
   alertes, ou parce que le régime prévu n'est pas la micro) ?
2. **Emplacement des données** : es-tu d'accord pour que la source de données quitte le OneDrive LVMH pour un
   service cloud personnel (à ton nom, hors LVMH) ?
3. **Usage d'Excel** : ouvres-tu `Finances_Data.xlsx` dans Excel pour *modifier* des lignes, ou seulement pour
   consulter / analyser ? (Détermine si l'import Excel doit gérer la fusion ligne à ligne ou seulement la restauration.)
4. **Windows** : « conserver mon application actuelle » = garder le même écran et les mêmes fonctions (qui peuvent
   tourner dans la même appli installée depuis Edge), ou garder spécifiquement un `.exe` ?
5. **Notifications souhaitées** sur l'iPhone : loyers en retard, factures à envoyer, récurrents à générer, autre ?
