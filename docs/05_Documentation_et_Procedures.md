# Cockpit multiplateforme — documentation, procédures et coûts

Mise en service : 25/11/2026 · Application : **https://cockpit-finances.pages.dev** · Compte : mh.mohamedhamdi1@gmail.com

---

## 1. Guide d'utilisation

### Installer l'application
| Appareil | Procédure |
|---|---|
| **iPhone** | Safari › https://cockpit-finances.pages.dev › bouton Partager › « Sur l'écran d'accueil » › Ajouter. Ouvre ensuite Cockpit **depuis l'icône** (plein écran, notifications possibles). |
| **Windows** | Edge › https://cockpit-finances.pages.dev › menu « … » › Applications › « Installer Cockpit ». L'appli apparaît dans le menu Démarrer ; clic droit sur l'icône de la barre des tâches › Épingler. |
| **Navigateur** | Simplement l'adresse, depuis n'importe quel ordinateur. |
| **Android (plus tard)** | Chrome › menu › « Installer l'application ». |

Chaque appareil demande une fois : e-mail + mot de passe + code de sécurité (application d'authentification).

### À faire une fois
1. **Ajouter un 2ᵉ code de sécurité** (Paramètres › Compte et sécurité › « Ajouter un code de secours ») sur un autre appareil ou un gestionnaire de mots de passe. Sans lui, perdre ton téléphone bloquerait l'accès (voir § 4.4).
2. **Activer les notifications** sur l'iPhone (depuis l'appli installée) et sur Windows : Paramètres › Notifications › « Activer sur cet appareil », puis « Tester ».
3. **Vérifier les dates des rappels** (Automatismes › Échéances et rappels) : URSSAF, CFE, déclaration de revenus sont préremplies avec des dates à confirmer ; le rappel « Taxes Amal 1 » est désactivé tant que tu n'as pas mis la bonne date.

### Au quotidien
- Bouton **+** (iPhone) ou « Nouvelle opération » / touche **N** (PC) : identique à l'ancienne appli.
- Tout est enregistré dans la base centrale et apparaît sur les autres appareils en quelques secondes.
- **Sans réseau** : l'appli s'ouvre et affiche tes données ; les saisies sont gardées sur l'appareil (« en attente ») et envoyées automatiquement au retour du réseau (sur iPhone : à la réouverture de l'appli).
- Si la même opération est modifiée sur deux appareils en même temps : les changements sur des champs différents sont fusionnés ; s'ils portent sur le même champ, l'appli te demande quelle version garder.
- La pastille rouge sur l'icône indique le nombre d'alertes (loyers en retard, factures…).

### Notifications envoyées (réglables une par une dans Paramètres)
| Notification | Quand |
|---|---|
| Factures en retard de paiement (envoyée depuis +30 j) / à envoyer | Point du matin (8 h par défaut), au plus une fois par semaine |
| Loyers en retard | À partir du 5 du mois (réglable), puis chaque semaine |
| Loyers à encaisser | Le 1ᵉʳ du mois |
| Jours travaillés du mois → facture préremplie | Dernier jour ouvré du mois, 17 h |
| Rappel de saisie | 20 h, si rien n'a été saisi depuis 3 jours (réglable) |
| Opérations récurrentes à générer | Du 1ᵉʳ au 3 du mois |
| Relevé de soldes | Dernier jour ouvré du mois |
| Échéances (URSSAF, impôts, CFE, départs de locataires, tes rappels) | X jours avant (réglable par rappel) puis le jour J |
| Montant à mettre de côté | Après chaque facture payée |
| Seuils micro / TVA | Si dépassés (actuellement neutralisés par tes paramètres à 1 000 000) |

### Ce qui a changé par rapport à Finances.exe
- Les données ne sont plus dans `Finances_Data.xlsx` mais dans la base centrale. **N'utilise plus Finances.exe** : il écrirait dans l'ancien fichier, qui n'est plus synchronisé. L'exe et le fichier sont conservés intacts comme archive.
- « Ouvrir dans Excel » est remplacé par **Exporter en Excel** (même format, une colonne UUID en plus).
- Nouveau : historique de toutes les modifications (avec « Annuler »), points de restauration, notifications, échéances et rappels, version iPhone.

---

## 2. Architecture technique

```
iPhone (app écran d'accueil) ─┐
Windows (app Edge)  ──────────┼─ une seule application web (PWA) — cockpit-finances.pages.dev (Cloudflare Pages)
Navigateur / Android ─────────┘   copie locale IndexedDB + file d'attente hors ligne + service worker
              │ HTTPS (clé publique uniquement)          │ temps réel (websocket, jeton MFA)
┌─────────────▼──────────────────────────────────────────▼───────────────┐
│ Supabase « cockpit » (gliensrtmkczalbhhodm, eu-west-1 Irlande, PG 17)   │
│  Auth : mot de passe ≥ 12 + MFA TOTP obligatoire, inscriptions fermées  │
│  11 tables métier + journal + points de restauration + abonnements push │
│  RLS : propriétaire ET session MFA (aal2) ; client en LECTURE seule      │
│  apply_ops() : écritures atomiques, règles métier, contrôle de version   │
│  pg_cron : instantané quotidien 01:15 UTC ; rappels toutes les heures    │
│  Edge Function « rappels » → Web Push (VAPID)                            │
└─────────────┬──────────────────────────────────────────────────────────┘
              │ chaque nuit 02:30 UTC (export complet)
   Cloudflare Worker « cockpit-backup » → chiffrement AES-256-GCM → Workers KV
   (90 sauvegardes quotidiennes + 1 par mois sans limite)
```

### Arborescence du code (`~/cockpit`, dépôt git local)
| Dossier | Contenu |
|---|---|
| `app/` | Application (HTML/CSS/JS sans framework ni build). `js/state.js` = moteur de synchro ; `js/core.js` = calculs partagés avec les notifications ; `js/schema.js` = description des tables ; `js/xlsxio.js` = Excel ; `js/auth.js` = connexion/MFA ; `views/` = écrans ; `sw.js` = hors ligne + push |
| `supabase/migrations/` | `0001_schema.sql` tables, index, RLS · `0002_logic.sql` règles métier et fonctions publiques · `0003_platform.sql` temps réel, cron, droits du rôle de service |
| `supabase/functions/rappels/` | Calcul et envoi des notifications |
| `tools/cloud/` | `deploy.mjs` (déploiement), `migrate.mjs` (import Excel + rapprochement), `verify-backup.mjs`, `backup-worker.js`, `serve.mjs` |
| `tests/` | `db.test.mjs` (14 tests base), `xlsx.test.mjs` (3), `e2e.mjs` (13 tests de bout en bout), `notif-preview.mjs` |
| `web/`, `*.go` | Ancienne application Windows (inchangée) |
| `.env` | **Secrets** (jamais versionné, droits 600) |

### Modèle de données
Chaque ancien onglet = une table aux mêmes colonnes, plus : `id` (UUID créé par l'appareil), `seq`, `legacy_id` (ID Excel d'origine), `created_at`, `updated_at`, `version`, `deleted_at` (suppression logique). Tables supplémentaires : `rappels`, `push_subscriptions`, `notif_log`, `change_log`, `restore_points`. Les liens restent par nom (compatibilité Excel) ; renommer un lot, client, compte ou locataire met à jour automatiquement les références.

### Synchronisation
- Écriture : `apply_ops(lot)` en une transaction ; chaque modification porte la version lue à l'ouverture de la fiche → conflit détecté (code CK409) → fusion automatique ou choix.
- Anti-doublons : UUID créé sur l'appareil (renvoi sans danger) + unicité des références générées (loyers, récurrents, paiements de factures) et des numéros de facture (attribués par le serveur sous verrou).
- Lecture : synchro différentielle sur `updated_at` + événements temps réel ; suppressions propagées via `deleted_at`.
- Hors ligne : file d'attente IndexedDB rejouée dans l'ordre au retour du réseau.

### Sécurité
| Mesure | Détail |
|---|---|
| Authentification | Mot de passe ≥ 12 caractères + TOTP obligatoire ; inscriptions fermées (1 seul compte) |
| Autorisations | RLS sur toutes les tables : `user_id = auth.uid()` **et** `aal = aal2` (politique restrictive) ; le client n'a que SELECT ; toute écriture passe par 5 fonctions qui revérifient compte + MFA ; rien n'est accessible en anonyme |
| Clés | Seule la clé « publishable » est dans l'app. Clé de service, clés VAPID, secret cron, clé de chiffrement des sauvegardes : secrets Supabase / Cloudflare / `.env` uniquement |
| Transport | HTTPS partout, HSTS, CSP stricte (`default-src 'self'`), X-Frame-Options DENY, no-referrer |
| Sauvegardes externes | AES-256-GCM, lisibles uniquement avec `BACKUP_KEY` ; accès de l'appli réservé au propriétaire avec session MFA |
| Contrôle | Conseiller sécurité Supabase : seuls restent les 5 avertissements « fonction SECURITY DEFINER appelable », voulus (ce sont les points d'entrée contrôlés) |

---

## 3. Procédure de sauvegarde

| Niveau | Quoi | Où | Rétention |
|---|---|---|---|
| 1 | Chaque création / modification / suppression (avant + après) | Base, `change_log` | Illimitée |
| 2 | Instantané complet automatique | Base, `restore_points` | 30 derniers (quotidiens + manuels + avant restauration) |
| 3 | Sauvegarde chiffrée hors Supabase | Cloudflare KV | 90 jours + 1 par mois sans limite |
| 4 | Export Excel manuel | Où tu veux (iCloud, disque perso…) | — |
| 5 | Instantané Supabase en cas de mise en veille | Supabase | 1 an |

**Conseil** : une fois par mois, Paramètres › Données › « Exporter en Excel » et range le fichier hors du PC LVMH.

Vérifier la sauvegarde externe : `node tools/cloud/verify-backup.mjs` (déclenche, télécharge, déchiffre, compare à la base).

## 4. Procédures de restauration

### 4.1 Annuler une erreur ponctuelle
Paramètres › Données › **Historique des modifications** › « Annuler » (remet la ligne dans son état d'avant) ou « Récupérer » (ligne supprimée).

### 4.2 Revenir à un état antérieur complet
Paramètres › Données › Points de restauration › « Revenir ici ». L'état actuel est d'abord sauvegardé dans un nouveau point.

### 4.3 Restaurer depuis un fichier
- **Excel** : Paramètres › Données › « Restaurer depuis un fichier Excel » (export Cockpit ou ancien `Finances_Data.xlsx`). Aperçu des quantités, refus si une ligne est invalide, point de restauration créé avant.
- **Sauvegarde externe** : Paramètres › Données › Sauvegardes externes › « Restaurer » ou icône Excel (téléchargement).

### 4.4 Situations exceptionnelles
| Situation | Procédure |
|---|---|
| Mot de passe oublié | Écran de connexion › « Mot de passe oublié » (e-mail de réinitialisation) |
| Téléphone perdu, code de secours disponible | Se connecter avec le 2ᵉ code, retirer l'ancien dans Paramètres |
| Téléphone perdu, aucun code de secours | Tableau de bord Supabase › Authentication › Users › ton compte › supprimer le facteur MFA, puis se reconnecter et en réactiver un |
| Projet Supabase mis en veille | E-mail Supabase › « Restore project » (1 clic, possible pendant 1 an) |
| Projet Supabase perdu | Nouveau projet → `deploy.mjs supabase` → dans l'appli, restaurer la dernière sauvegarde externe ou un export Excel |

## 5. Procédure de déploiement

Prérequis : `~/cockpit/.env` contenant `SUPABASE_ACCESS_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (+ secrets générés automatiquement).
Sur le PC LVMH (proxy Zscaler) préfixer les commandes par :
`export PATH=~/.local/node/bin:$PATH; unset NODE_TLS_REJECT_UNAUTHORIZED; export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt`

| Commande | Effet |
|---|---|
| `node --test tests/` | Tests base + Excel (local, aucune donnée réelle) |
| `node tools/cloud/deploy.mjs supabase` | Schéma, règles, cron, fonction de notifications, réglages d'authentification (idempotent) |
| `node tools/cloud/deploy.mjs app` | Construit `dist/` et publie sur Cloudflare Pages (les appareils se mettent à jour seuls) |
| `node tools/cloud/deploy.mjs worker` | Sauvegarde externe |
| `node tests/e2e.mjs https://cockpit-finances.pages.dev` | 13 tests de bout en bout avec des comptes jetables (supprimés à la fin) |
| `node tools/cloud/migrate.mjs <xlsx>` | Import complet + rapport (`docs/03_Rapport_Migration.md`) |

## 6. Coûts réels

| Service | Offre | Utilisation actuelle | Limite gratuite | Coût |
|---|---|---|---|---|
| Supabase | Free | ~5 Mo de base, 1 utilisateur | 500 Mo, 5 Go de trafic/mois, 500 000 appels de fonction | **0 €** |
| Cloudflare Pages | Free | 37 fichiers, quelques déploiements | 500 déploiements/mois | **0 €** |
| Cloudflare Workers + KV | Free | 1 exécution/jour, ~1,4 Mo/sauvegarde (~130 Mo à terme) | 100 000 requêtes/jour, 1 Go KV, 1 000 écritures/jour | **0 €** |
| Notifications Web Push | — | — | Gratuit (pas de compte Apple nécessaire) | **0 €** |
| **Total** | | | | **0 €/mois** |

Options futures, seulement si tu le décides : nom de domaine (~10-15 €/an), App Store (99 $/an), Google Play (25 $ une fois), Supabase Pro (25 $/mois : supprime la mise en veille et ajoute des sauvegardes Supabase natives — inutile tant que les sauvegardes ci-dessus fonctionnent).

Risque de mise en veille Supabase (7 jours sans activité) : très faible — ton usage, la tâche de rappels horaire et la sauvegarde nocturne interrogent la base chaque jour.

## 7. Points d'attention
- **Jetons d'accès** transmis dans la conversation : à révoquer puis recréer (Supabase › Account › Access Tokens ; Cloudflare › My Profile › API Tokens), et mettre les nouveaux dans `.env`.
- **BACKUP_KEY** (dans `.env`) : recopie-la dans ton gestionnaire de mots de passe. Sans elle, les sauvegardes externes sont indéchiffrables (l'appli, elle, continue de fonctionner).
- **PC LVMH** : le proxy Zscaler inspecte le trafic chiffré. Pour tes données financières, privilégie l'iPhone ou un ordinateur personnel.
- **Région** : le projet Supabase est en Irlande (eu-west-1), dans l'UE (RGPD).
