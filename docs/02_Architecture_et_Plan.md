# Cockpit — Architecture cible et plan de développement (phase 2)

Date : 25/11/2026 · Prérequis : `01_Audit_Existant.md`

Décisions prises avec Mohamed le 25/11/2026 :
- les paramètres freelance actuels (seuils 1 000 000, cotisations 19,2 %) sont volontaires ;
- les données peuvent quitter le OneDrive LVMH pour un service cloud **à son nom personnel** ;
- Excel n'est **pas** utilisé pour modifier des lignes → Excel devient un format d'**export / sauvegarde / restauration** ;
- le `.exe` n'est pas une fin en soi : une application installée depuis Edge convient si c'est mieux ;
- notifications voulues : factures en retard, loyers en retard, rappel de saisie, échéances de paiement et de
  déclaration, jours travaillés en fin de mois, et tout ce qui touche à ses projets ;
- base retenue : **Supabase** (gratuit, volume ≈ 3 Mo).

---

## 1. Limites réelles des offres gratuites (vérifiées le 25/11/2026)

### Supabase Free

| Ressource | Limite Free | Besoin Cockpit | Marge |
|---|---|---|---|
| Base PostgreSQL | 500 Mo | ≈ 3 Mo aujourd'hui, ~1 Mo/an avec l'historique des modifications | > 100 ans |
| Trafic sortant | 5 Go/mois (+ 5 Go en cache) | < 100 Mo/mois avec la synchro différentielle | × 50 |
| Utilisateurs actifs | 50 000 | 1 | — |
| Edge Functions | 500 000 appels/mois | ~100 (notifications quotidiennes) | — |
| Projets actifs | 2 | 1 production + 1 test/restauration | OK |
| **Mise en veille** | après **7 jours d'inactivité** | usage quotidien + tâche de sauvegarde quotidienne qui interroge la base | risque faible |
| **Sauvegardes automatiques** | **non incluses** (ni restauration à une date précise) | indispensables | **à construire nous-mêmes (§ 6)** |
| Journaux | 1 jour | — | — |
| Support | communauté | — | — |

En cas de mise en veille malgré tout : Supabase prévient par e-mail environ une semaine avant. Le projet se restaure en
un clic pendant **1 an**, et on dispose de nos propres sauvegardes. Le Pro (25 $/mois) supprime la veille et ajoute
7 jours de sauvegardes. **Ce n'est pas nécessaire** avec les protections ci-dessous.

### Hébergement de l'application (Cloudflare Pages Free)
HTTPS automatique, 500 déploiements/mois, 20 000 fichiers par site, domaine `*.pages.dev` gratuit (domaine
personnalisé possible, ~10-15 €/an, optionnel).

### Notifications sur iPhone (Web Push)
- Fonctionne depuis iOS 16.4, **uniquement si l'application est ajoutée à l'écran d'accueil**. Elle ne fonctionne pas
  dans un onglet Safari.
- La permission doit être demandée après un appui de l'utilisateur, pas au chargement de la page.
- **Aucun compte Apple Developer requis** : une simple clé VAPID suffit, gratuite.
- Supprimer l'icône de l'écran d'accueil annule l'abonnement. Il faut alors réinstaller et réactiver.
- Pas de notification silencieuse : chaque envoi affiche une notification visible.
- Les mêmes notifications fonctionnent sur Windows (Edge) et sur Android (Chrome).

## 2. Comparatif des architectures

| Critère | A. Excel + OneDrive | **B. Supabase + PWA (recommandée)** | C1. Firebase + PWA | C2. Cloudflare D1 + Workers |
|---|---|---|---|---|
| Coût initial | 0 € | 0 € | 0 € | 0 € |
| Coût mensuel | 0 € | 0 € | 0 € | 0 € |
| Complexité | Élevée : API Graph, verrous de fichier, pas de lignes indépendantes | Moyenne : base SQL + authentification + règles d'accès fournies | Moyenne | Élevée : authentification à écrire soi-même |
| Sécurité | OneDrive LVMH : soumis aux règles de l'employeur. OneDrive perso : correcte | Très bonne : authentification + MFA, règles d'accès par ligne, région UE | Très bonne | Dépend de notre code |
| Synchronisation | Fichier entier, conflits OneDrive, rien au niveau ligne | Par ligne, temps réel, transactions atomiques | Excellente, hors ligne natif | À construire |
| Maintenance | Fragile (Excel ouvert = blocage) | Faible, aucun serveur à gérer | Faible | Moyenne |
| Évolutivité | Faible | Forte : PostgreSQL standard, portable chez n'importe quel hébergeur | Forte, mais base NoSQL propriétaire Google | Forte |
| Correspondance avec ton modèle (10 tableaux liés) | Native | **Native (tables SQL)** | Mauvaise (documents) | Bonne (SQLite) |
| Points faibles | Inutilisable sur le OneDrive LVMH, pas d'accès iPhone fiable | Veille après 7 j, pas de sauvegarde native (compensé § 6) | Sauvegardes payantes, verrouillage Google, export Excel plus difficile | Plus de code, donc plus de risques |

**Verdict : B.** C'est la seule option qui coche à la fois 0 €, un modèle relationnel identique à ton Excel,
l'authentification sécurisée incluse et la portabilité (PostgreSQL standard : on peut partir sans réécrire).

## 3. Architecture recommandée

```
         iPhone                   Windows                  Navigateur          Android (plus tard)
   (PWA écran d'accueil)   (appli installée depuis Edge)   (n'importe où)        (PWA Chrome)
            │                         │                          │                     │
            └──────────── une seule application web (le code actuel, rendu responsive) ┘
                         │  copie locale IndexedDB + file d'attente hors ligne
                         │  HTTPS uniquement
            ┌────────────▼──────────────┐
            │ Cloudflare Pages (gratuit) │  ← fichiers statiques de l'app (aucune donnée)
            └────────────┬──────────────┘
                         │ HTTPS + jeton de session (après connexion e-mail + mot de passe + code MFA)
┌────────────────────────▼──────────────────────────────────────────────────────────────┐
│ SUPABASE (projet perso, région UE — Paris)                                             │
│                                                                                        │
│  Auth (mot de passe + MFA TOTP, inscriptions fermées)                                  │
│  PostgreSQL = SOURCE DE VÉRITÉ UNIQUE                                                  │
│    10 tables (ex-onglets) + rappels + abonnements push + journal des modifications     │
│    Règles d'accès par ligne (RLS) : user_id = moi ET MFA validé                        │
│    Fonction apply_ops() : lots atomiques, contrôle de version, règles métier           │
│  Realtime : diffuse chaque modification aux autres appareils ouverts                   │
│  pg_cron (chaque jour 8 h) ──► Edge Function « rappels » ──► Web Push (iPhone, PC)     │
└────────────────────────┬──────────────────────────────────────────────────────────────┘
                         │ chaque nuit (lecture seule)
            ┌────────────▼────────────────────────────┐
            │ GitHub Actions (dépôt privé, gratuit)    │
            │ dump SQL + export JSON + export Excel    │
            │ chiffrés → conservés 90 j + 1 par mois   │
            │ (maintient aussi le projet « actif »)    │
            └─────────────────────────────────────────┘

  Excel : bouton « Exporter » (même format qu'aujourd'hui + colonne identifiant)
          bouton « Restaurer depuis un Excel » (remplacement complet, après instantané automatique)
          → Excel n'écrit jamais en concurrence avec la base.
```

### Ce que devient chaque morceau actuel

| Aujourd'hui | Demain |
|---|---|
| Interface web embarquée dans l'exe | **Même interface**, hébergée et rendue responsive (mobile + bureau) |
| `state.js` → serveur local | `state.js` → Supabase + cache local + file hors ligne (seul fichier réécrit en profondeur) |
| Règles métier en Go (`ops.go`) | Fonctions PostgreSQL : mêmes règles, appliquées quel que soit l'appareil |
| Calculs et alertes (`calc.js`) | Inchangés. Rendus « purs » pour être réutilisés par la fonction de notifications |
| `Finances_Data.xlsx` = base | Export, sauvegarde et restauration uniquement |
| `Finances.exe` | Remplacé par l'appli installée depuis Edge : icône menu Démarrer et barre des tâches, fenêtre dédiée, hors ligne, mises à jour automatiques, plus d'avertissement SmartScreen. L'ancien exe et son Excel restent intacts en archive |
| Sauvegardes dans OneDrive | Sauvegardes chiffrées hors Supabase + journal des modifications en base |

## 4. Modèle de données cible

Chaque onglet devient une table, avec les mêmes colonnes, plus :

| Colonne ajoutée | Rôle |
|---|---|
| `id` (UUID) | Identifiant unique créé **sur l'appareil**. Aucune collision possible, même hors ligne. Renvoyer deux fois la même opération ne crée pas de doublon |
| `legacy_id` | Ancien n° d'ID Excel (traçabilité) |
| `user_id` | Propriétaire de la ligne : base des règles d'accès |
| `created_at`, `updated_at` | Horodatage serveur |
| `version` | Incrémentée à chaque modification : détection des conflits |
| `deleted_at` | Suppression logique : propagée aux autres appareils, annulable |

Liens par **clé étrangère** (lot, client, compte, locataire, catégorie) au lieu du nom : les renommages se
propagent. L'adaptateur `state.js` continue de fournir les noms à l'interface, donc les écrans ne changent pas.

Contraintes anti-doublon :
- `unique(user_id, ref)` : un loyer, un automatisme ou un paiement de facture ne peut pas être généré deux fois,
  même depuis deux appareils en même temps ;
- `unique(user_id, numero)` : numérotation des factures attribuée par le serveur, sous verrou.

Nouvelles tables :
- `rappels` : échéances et rappels paramétrables ;
- `push_subscriptions` : appareils abonnés aux notifications ;
- `change_log` : chaque création, modification ou suppression, avec la ligne avant et après, l'heure et l'appareil.
  Permet de **retrouver ou annuler n'importe quelle modification**.

## 5. Synchronisation

| Besoin | Mécanisme |
|---|---|
| Source unique | PostgreSQL. Les appareils n'ont qu'une copie de travail |
| Modification visible partout | Écriture immédiate en base, puis diffusion Realtime aux appareils ouverts. Les autres se mettent à jour à l'ouverture (synchro différentielle par `updated_at`) |
| Lots atomiques | `apply_ops()` en une transaction. Exemple : « facture payée » = facture + opération HT + opération TVA, tout ou rien |
| Modifications simultanées | Chaque écriture porte la `version` lue. Si la ligne a changé entre-temps : fusion automatique si les champs modifiés sont différents, sinon choix « garder la mienne / garder l'autre » |
| Doublons | UUID créé sur l'appareil (renvoi sans danger) + contraintes `unique` sur les références générées |
| Suppressions | Logiques (`deleted_at`), propagées et annulables. « Modifiée ailleurs » contre « supprimée ici » déclenche une demande de choix |
| Hors connexion | Lecture complète depuis la copie locale. Saisies mises en file d'attente (badge « en attente »), envoyées dès le retour du réseau. Sur iPhone, l'envoi se fait à la réouverture de l'app (iOS n'autorise pas la synchro en arrière-plan) |
| Excel | Export à la demande et chaque nuit. L'import ne sert qu'à **restaurer**, jamais en concurrence avec la base |

## 6. Sauvegarde et récupération (compense l'absence de sauvegarde native en Free)

| Niveau | Ce qui est protégé | Fréquence / durée |
|---|---|---|
| 1. Journal des modifications en base | Chaque ligne, avant et après chaque changement → annuler une erreur, retrouver une ligne supprimée | Permanent |
| 2. Sauvegarde nocturne GitHub Actions | Dump PostgreSQL + JSON + Excel, **chiffrés** (phrase secrète connue de toi seul et des secrets GitHub) | Tous les jours, 90 j + 1 par mois sans limite |
| 3. Export Excel manuel | Tout, au format actuel | À la demande |
| 4. Instantané avant restauration | État complet avant tout import Excel | Automatique |
| 5. Instantané Supabase en cas de veille | Projet complet | 1 an |

Procédure de restauration testée sur le **2ᵉ projet gratuit** (projet de test), jamais directement sur la production.

## 7. Sécurité

- **Connexion** : e-mail + mot de passe + **code MFA** (application d'authentification). Inscriptions désactivées
  après la création de ton compte.
- **Règles d'accès par ligne (RLS)** sur toutes les tables : `user_id = auth.uid()` **et** session MFA validée
  (politique restrictive `aal2`). Même avec la clé publique de l'app, personne d'autre ne lit rien.
- **Clés** : seule la clé publique (*publishable*), prévue pour être visible, est dans l'app. La clé de service et
  la phrase de chiffrement des sauvegardes sont uniquement dans les secrets Supabase et GitHub, jamais dans le code
  ni dans ce dépôt.
- **Transport** : HTTPS partout, en-têtes de sécurité (CSP, HSTS) sur Cloudflare Pages.
- **Données** : région UE (RGPD), chiffrement au repos assuré par Supabase, sauvegardes chiffrées par nous.
- **Comptes d'administration** (Supabase, GitHub, Cloudflare) : MFA obligatoire. Ce sont eux les vraies clés du coffre.
- **Codes de secours MFA** à conserver hors du téléphone.

## 8. Application mobile (PWA)

- **Navigation** : barre d'onglets en bas (Accueil · Opérations · **＋** central · Immobilier · Plus), utilisable au pouce.
- **Saisie** : feuille plein écran depuis le bas, pavé numérique direct, catégories en grosses tuiles, suggestions de
  libellé conservées.
- **Écrans** : tableaux larges transformés en cartes ; grille des loyers avec défilement horizontal et colonne des
  lots figée ; période et activité dans un sélecteur compact.
- **Natif** : zones de sécurité de l'encoche respectées, icône et écran de démarrage, mode sombre, pastille du nombre
  d'alertes sur l'icône (API Badging, iOS 18.4+).
- **Cohérence** : mêmes couleurs, icônes, libellés et calculs que sur PC, puisque c'est le même code.
- **App Store plus tard** : la même app peut être emballée avec Capacitor (99 $/an Apple) ; Google Play via TWA
  (25 $ une fois). Aucune réécriture.

## 9. Notifications et rappels

Une fonction programmée chaque matin (heure réglable) calcule les alertes avec **la même logique que le tableau de
bord**, puis notifie les appareils abonnés. Chaque type peut être activé ou désactivé et reçoit une heure.

| Rappel | Déclencheur proposé |
|---|---|
| Facture en retard | Envoyée depuis plus de 30 j, puis rappel hebdomadaire |
| Facture à envoyer | Planifiée dont le mois est terminé |
| **Jours travaillés du mois** | Dernier jour ouvré du mois, 17 h : « Combien de jours chez Talan en novembre ? » → ouvre la facture préremplie |
| Loyer en retard | Après le 5 du mois (réglable), par locataire |
| Loyers à encaisser | Le 1ᵉʳ du mois |
| Rappel de saisie | Aucune opération saisie depuis N jours (3 par défaut), le soir |
| Récurrents | Le 1ᵉʳ du mois. Option : génération automatique + notification « 9 opérations ajoutées » |
| Relevé de soldes | Dernier jour du mois |
| Échéances fiscales et administratives | Table `rappels` préremplie, **dates à valider avec toi / ton comptable** : déclaration URSSAF micro (mensuelle ou trimestrielle dès 2027), CFE (mi-décembre), déclaration de revenus (printemps), TVA si applicable, taxes Maroc Amal 1, fin de bail / départ prévu d'un locataire, restitution de caution |
| Provision fiscale | À chaque facture payée : « mets X € de côté » |
| Seuils micro / TVA | Si les seuils redeviennent actifs |
| Libres | Tu peux créer tes propres rappels (date unique, mensuel, trimestriel, annuel) |

## 10. Coûts

| | Court terme | Long terme |
|---|---|---|
| Supabase Free | 0 € | 0 € tant que le volume reste < 500 Mo (des décennies au rythme actuel) |
| Cloudflare Pages | 0 € | 0 € |
| GitHub (dépôt privé + Actions) | 0 € | 0 € (2 000 min/mois incluses, besoin ≈ 60) |
| Notifications Web Push | 0 € | 0 € |
| Domaine personnalisé | optionnel | ~10-15 €/an |
| App Store | — | 99 $/an, seulement si publication |
| Google Play | — | 25 $ une fois, seulement si publication |
| Sécurité supplémentaire (Supabase Pro) | — | 25 $/mois, seulement si tu veux supprimer la veille et avoir les sauvegardes Supabase natives |
| **Total** | **0 €/mois** | **0 €/mois** |

## 11. Risques et parades

| Risque | Parade |
|---|---|
| Mise en veille Free | Usage quotidien + sauvegarde nocturne qui interroge la base + e-mail d'alerte Supabase + restauration en 1 clic pendant 1 an |
| Pas de sauvegarde native | § 6 (5 niveaux, dont 2 hors Supabase) |
| Supabase change son offre gratuite | PostgreSQL standard + dumps quotidiens → migration vers un autre hébergeur sans réécrire l'app |
| PC LVMH : proxy ou politique qui bloque `*.supabase.co`, `*.pages.dev` ou l'installation d'apps Edge | **Test dès l'étape 3** ; sinon usage par le navigateur web, ou PC/iPhone perso |
| Perte du téléphone (MFA) | Codes de secours + 2ᵉ facteur sur un autre appareil |
| iOS désactive les notifications si l'icône est supprimée | Écran « Notifications » qui affiche l'état et permet de réactiver |
| Saisies hors ligne non encore envoyées | Badge visible + envoi dès la réouverture ; elles ne sont jamais perdues localement tant que l'app n'est pas désinstallée |

## 12. Plan de développement

Chaque étape est testée avant la suivante. ✋ = arrêt pour ta validation.

| # | Étape | Contenu | Données réelles touchées ? |
|---|---|---|---|
| 0 | Préparation | Dépôt git privé, état de référence de l'app actuelle, tests existants | Non |
| 1 | Base Supabase | Schéma SQL, RLS + MFA, journal, `apply_ops()` et règles métier portées depuis Go, tests automatiques d'accès (un autre compte ne voit rien, une session sans MFA est refusée) — sur le projet de **test** | Non |
| 2 | Migration à blanc | Script qui lit une **copie** de `Finances_Data.xlsx` et charge le projet de test, puis rapport de rapprochement : nombre de lignes, sommes par activité, année et catégorie, empreinte ligne à ligne, ré-export Excel comparé à l'original | Copie seulement ✋ |
| 3 | Appli web branchée sur le cloud | Nouveau `state.js` (cache, file hors ligne, Realtime, conflits), écran de connexion + MFA, export / restauration Excel dans l'app, remplacement des fonctions propres au PC. Test d'accès depuis le PC LVMH | Projet de test ✋ |
| 4 | Version mobile + PWA | Mise en page responsive, manifeste, icônes, service worker, installation sur ton iPhone et dans Edge | Projet de test ✋ |
| 5 | Notifications | Table `rappels`, tâche planifiée, fonction d'envoi, écran de réglages, tests sur iPhone et PC | Projet de test |
| 6 | Sauvegardes | Workflow nocturne chiffré, procédure de restauration testée de bout en bout | Projet de test |
| 7 | Bascule | Sauvegarde finale de l'Excel, migration réelle, rapprochement, contrôle croisé avec toi. L'ancien exe et l'Excel sont conservés intacts (archive en lecture) | **Oui** ✋ |
| 8 | Recette finale | Tous les tests demandés (fonctions PC/iPhone, données importées, synchro dans les deux sens, modifications simultanées, coupure réseau, restauration, sécurité) + documentation (technique, sauvegarde/restauration, déploiement, coûts) | — |
| 9 | Option | App Store (Capacitor) / Google Play | — |

### Ce dont j'aurai besoin de ta part (étape 1)
1. Créer un compte **Supabase** personnel (avec MFA), puis 2 projets en région **EU West (Paris)** :
   `cockpit` et `cockpit-test`.
2. Créer un compte **GitHub** personnel s'il n'existe pas (avec MFA).
3. Plus tard (étape 3) : un compte **Cloudflare** gratuit.
4. Me donner l'accès en ligne de commande via `! supabase login` dans cette session. Aucune clé secrète ne doit
   être collée dans la conversation.
