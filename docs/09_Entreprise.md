# Module Entreprise (v3) — un projet = une entreprise

Fichiers : `app/js/entreprise.js` (moteur pur, testé), `app/js/views/entreprise.js` + `entreprise-forms.js` (écran et fenêtres), `app/css/entreprise.css`,
tests `tests/entreprise.test.mjs` (moteur, 29 cas) et `tests/entreprise-ui.mjs` (scénarios navigateur sur fausse API).

## Modèle
Une entreprise est une ligne de `projets` (`type = 'Entreprise'`, `part` = **ma part**, `devise`, `meta` jsonb libre). Ses clients, factures, opérations
(`activite = 'Entreprise'`) et déclarations portent `projetId`. Les lignes sans `projetId` (anciennes données) sont rattachées à la **première** entreprise.
L'activité « Entreprise » n'est jamais additionnée au Perso / Immobilier (une facture devient un salaire ou un dividende côté Perso : doublon).

### `projets.meta` (toutes les clés sont facultatives ; `normalizeMeta()` complète les défauts)
| clé | sens | défaut |
|---|---|---|
| `forme` | `micro_bnc` `micro_bic_services` `micro_bic_vente` `ei_reel_bnc` `eurl_ir` `eurl_is` `sasu` `sas` `sarl` | `micro_bnc` |
| `date_debut` | début d'activité (avant : « pas encore démarrée », rien n'est compté) | paramètre `micro_debut` si pas de forme, sinon vide |
| `libelle_activite`, `siret` | texte | vide |
| `tva_regime` | `franchise` `reel_simplifie` (≤ 2026) `reel_normal` ; `tva_periodicite` : `mensuelle` `trimestrielle` | franchise (micro) / réel normal (sociétés) ; trimestrielle |
| `urssaf_periodicite` | `mensuelle` `trimestrielle` (micro) | mensuelle |
| `versement_liberatoire`, `acre` | micro uniquement | non |
| `caisse` (`ssi`/`cipav`), `artisan` | taux micro | `ssi`, non |
| `cloture` (MM-JJ), `premiere_cloture` | exercice des sociétés | `12-31` |
| `capital`, `gerant_majoritaire`, `je_suis_dirigeant` | règle des 10 % sur les dividendes TNS, réserve légale | 1 000 €, oui, oui |
| `associes` : `[{nom, part, moi}]` | parts de chacun ; `projets.part` = ma ligne | moi seul / moi + « autres associés » |
| `remuneration` : `{mode, salaire_net_annuel, dividendes_annuels, distribution_pct}` | politique de rémunération prévue | dividendes, 0, 0, 100 % |
| `tmi` | tranche marginale supposée pour l'IR **indicatif** | 30 % |
| `marge_estimee` | part du CA qui reste en bénéfice (provision d'IS sur un paiement) | 70 % |
| `provision_pct` | réservé (surcharge manuelle) | — |
| `checklist` | cases cochées de la liste de lancement | — |

Priorité des valeurs réglementaires : `meta` > paramètre utilisateur (`params`, seulement s'il diffère du défaut historique `83600 / 37500 / 41250 / 0,256 / 0,002`) > table datée `REGLES[année]`.
Une année absente de `REGLES` reprend la dernière année connue, marquée **estimé** (badge dans l'écran). **Mise à jour** : ajouter/corriger `REGLES[AAAA]` dans `entreprise.js`, rien d'autre.

## Valeurs réglementaires (vérifiées le 2026-11-28)
| valeur | 2026 | 2027 | source |
|---|---|---|---|
| Plafond micro BNC / BIC services | 83 600 € | 83 600 € (même période 2026-2028) | décret n° 2026-562 du 29 juin 2026 ; urssaf.fr, economie.gouv.fr |
| Plafond micro BIC vente | 203 100 € | 203 100 € | idem |
| Franchise de TVA services (seuil / majoré) | 37 500 / 41 250 € | idem | CGI 293 B ; inchangé (loi du 3 nov. 2025, art. 25 PLF 2026 rejeté) |
| Franchise de TVA vente (seuil / majoré) | 85 000 / 93 500 € | idem | idem |
| Cotisations micro BNC (SSI) / CIPAV | 25,6 % / 23,2 % | **reconduit (estimé)** | décret n° 2025-943 ; urssaf.fr |
| Cotisations micro BIC services / vente | 21,2 % / 12,3 % | **reconduit (estimé)** | urssaf.fr |
| CFP | 0,2 % libéral, 0,1 % commerçant, 0,3 % artisan | reconduit | urssaf.fr / economie.gouv.fr (la source diverge sur les libéraux SSI : 0,1 % ou 0,2 % — 0,2 % retenu) |
| Versement libératoire BNC / BIC services / vente | 2,2 / 1,7 / 1 % | reconduit | urssaf.fr ; condition RFR N-2 ≤ 29 315 € par part |
| Abattements micro (BNC / BIC services / BIC vente) | 34 / 50 / 71 %, minimum 305 € | idem | impots.gouv.fr, CGI 102 ter et 50-0 |
| ACRE | création avant le 1er juillet 2026 : 50 % du taux ; **à partir du 1er juillet 2026 : 75 % du taux normal** (BNC 19,2 %) ; jusqu'à la fin du 3e trimestre civil suivant le début ; à demander sous 60 jours | idem | décret n° 2026-69 du 6 fév. 2026 |
| IS | 15 % jusqu'à 42 500 € (proratisé si exercice < 12 mois), puis 25 % ; CA < 10 M€, capital détenu à 75 % par des personnes physiques | idem | CGI 219 ; economie.gouv.fr |
| Acomptes d'IS | 15 mars, 15 juin, 15 sept., 15 déc. ; solde le 15 mai (clôture 31/12) ; pas d'acompte la 1re année ni si IS < 3 000 € | idem | impots.gouv.fr |
| PFU (flat tax) | 12,8 % + 18,6 % = **31,4 %** | reconduit | LFSS 2026 (loi n° 2025-1403) : CSG capital 9,2 → 10,6 % ; (2025 : 30 %) |
| Réel simplifié de TVA | supprimé au **1er janvier 2027** : dernière CA12 le 4 mai 2027, puis CA3 (trimestrielle par défaut) | — | LF 2025 art. 38 ; impots.gouv.fr |
| Facturation électronique | réception obligatoire pour toutes les entreprises dès le **1er sept. 2026** ; émission + e-reporting pour micro/TPE/PME dès le **1er sept. 2027** | — | economie.gouv.fr, DGFiP |

**Ordres de grandeur (ESTIMATIONS, pas des taux officiels)** : cotisations du gérant TNS ≈ 45 % du revenu net ; président assimilé salarié ≈ 80 % du net (salariales + patronales) ;
dividendes > 10 % du capital (TNS) soumis aux cotisations ≈ 45 % ; réserve légale 5 % du résultat jusqu'à 10 % du capital.

## Ce que calcule le module
- **Suivi annuel / mensuel** (`entrepriseYear`) : facturé / encaissé / planifié, cumul, plafond et reste avant plafond / TVA, 1re année proratisée au nombre de jours.
  Le CA du plafond = encaissements HT (factures payées + opérations « Prestations » saisies à la main).
- **Charges et impôts** (`entrepriseFinance`) : micro = cotisations (ACRE, CIPAV), CFP, versement libératoire ou IR indicatif (CA après abattement × TMI) ; EURL IR / EI réel = cotisations TNS estimées + IR indicatif ;
  sociétés à l'IS = rémunération, IS (tranche 15 %), réserve légale, dividendes, **flat tax sur MES parts**, cotisations sur dividendes (TNS). « Déjà payé » = opérations « Cotisations URSSAF », « Versement libératoire (IR) », « Impôt sur les sociétés ».
- **À mettre de côté sur un paiement** (`reserveOnPayment`) : TVA collectée, URSSAF + CFP, impôt/versement libératoire (ou IS + flat tax) — affiché avant de confirmer « Paiement reçu ».
- **Planning** (`deadlinesFor`, `upcomingDeadlines`) : URSSAF mensuel / trimestriel, CFE (déclaration initiale, paiement dès l'année suivante), 2042 + 2042-C-PRO, TVA (CA12 jusqu'en 2026, acomptes, CA3 mensuelle/trimestrielle), IS (acomptes, solde, liasse), approbation des comptes (6 mois), dépôt au greffe, DAS2 (si applicable), DSN (SASU avec salaire). Statut fait / payé dans la table `declarations`.
  **Limites** : report au jour ouvré suivant mais **jours fériés non gérés** ; les dates TVA (15-24) et IR (fin mai – juin) dépendent du SIREN / département : marquées « indicatives ».
- **Alertes / santé** (`entrepriseAlerts`, `entrepriseHealth`) : démarrage proche, seuils (TVA majorée / franchise / plafond micro / 85 %), jours travaillés fin de mois, échéances à J-7 ou en retard, plafond, factures en retard, dépendance client, provision vs trésorerie, déclarations en retard.
- **Contrat avec l'écran Impôt** (`fiscalIncome`) : voir `docs/07_Contrats_modules.md` (+ champ `caMicro`, CA brut ma part, pour le revenu fiscal de référence).

## Facturation et Tiime — ce qui est réellement possible
Tiime est une plateforme agréée (immatriculée DGFiP le 18/12/2025) mais **n'a pas d'API publique** : l'API est réservée aux éditeurs sur demande (support.tiime.fr « Proposez-vous une API ? ») ;
des passerelles tierces (Make, Chift) existent, sans garantie de couvrir la facture électronique. Cockpit **ne se connecte donc pas** à Tiime et ne le simule pas. Ce qui est fourni :
facturation du mois (jours × TJM par client), facture imprimable / PDF avec mentions légales (art. 293 B CGI, pénalités, indemnité de 40 €, catégorie d'opération, SIREN du client à compléter),
« Copier pour Tiime » (lignes à recoller), export CSV, champ « Référence sur la plateforme de facturation » (`invoices.refExt`) et échéance de paiement, lien d'ouverture de Tiime.
Une vraie connexion supposerait un partenariat Tiime (ou un connecteur Make/Chift) : à décider par Mohamed.

## Limites connues
- Estimations indicatives : le calcul exact de l'IR est dans l'écran Impôt ; les cotisations TNS/SASU sont des ordres de grandeur.
- 2027 : plafonds officiels, taux de cotisations reconduits de 2026 (à confirmer en janvier 2027).
- Multi-devises : les factures en USD/GBP/CHF sont converties au taux courant (`ctx.fx`) pour les plafonds ; sans `ctx.fx` (fonction serveur) elles comptent 1 pour 1.
- Pas de gestion des jours fériés, des exercices de plus de 12 mois (1er exercice) au-delà de `premiere_cloture`, de l'option IS pour l'EURL/EI, ni de la contribution sociale de solidarité.
