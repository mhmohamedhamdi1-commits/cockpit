# Cockpit — rapport de migration

Date : 25/11/2026 10:54:07 · Source : `Finances_Data.xlsx` (SHA-256 `bb420b64af0eef1e…`) · Compte : mh.mohamedhamdi1@gmail.com

## 1. Nombre de lignes

| Table | Excel | Base centrale | Écart |
|---|---:|---:|---:|
| Transactions | 2565 | 2565 | ✅ 0 |
| Catégories | 77 | 77 | ✅ 0 |
| Lots | 8 | 8 | ✅ 0 |
| Locataires | 23 | 23 | ✅ 0 |
| Clients | 2 | 2 | ✅ 0 |
| Factures | 30 | 30 | ✅ 0 |
| Récurrents | 9 | 9 | ✅ 0 |
| Comptes | 12 | 12 | ✅ 0 |
| Relevés | 4 | 4 | ✅ 0 |
| Paramètres | 21 | 21 | ✅ 0 |
| Rappels | 4 | 4 | ✅ 0 |

## 2. Comparaison champ par champ

- Transactions : 2565/2565 lignes identiques sur toutes les colonnes
- Catégories : 77/77 lignes identiques sur toutes les colonnes
- Lots : 8/8 lignes identiques sur toutes les colonnes
- Locataires : 23/23 lignes identiques sur toutes les colonnes
- Clients : 2/2 lignes identiques sur toutes les colonnes
- Factures : 30/30 lignes identiques sur toutes les colonnes
- Récurrents : 9/9 lignes identiques sur toutes les colonnes
- Comptes : 12/12 lignes identiques sur toutes les colonnes
- Relevés : 4/4 lignes identiques sur toutes les colonnes
- Paramètres : 21/21 lignes identiques sur toutes les colonnes
- Rappels : 4/4 lignes identiques sur toutes les colonnes

## 3. Totaux par activité et par année (Montant EUR, Excel = base)

| Activité | Année | Excel | Base | Écart |
|---|---|---:|---:|---:|
| Freelance (Revenu) | 2026 | 30398.48 | 30398.48 | ✅ |
| Immobilier (Dépense) | 2024 | 236866.75 | 236866.75 | ✅ |
| Immobilier (Revenu) | 2024 | 215087.42 | 215087.42 | ✅ |
| Immobilier (Dépense) | 2025 | 3100.81 | 3100.81 | ✅ |
| Immobilier (Revenu) | 2025 | 18687.29 | 18687.29 | ✅ |
| Immobilier (Dépense) | 2026 | 12266.63 | 12266.63 | ✅ |
| Immobilier (Revenu) | 2026 | 18590.88 | 18590.88 | ✅ |
| Perso (Dépense) | 2021 | 5580.00 | 5580.00 | ✅ |
| Perso (Revenu) | 2021 | 34965.00 | 34965.00 | ✅ |
| Perso (Dépense) | 2022 | 7513.00 | 7513.00 | ✅ |
| Perso (Revenu) | 2022 | 41992.00 | 41992.00 | ✅ |
| Perso (Dépense) | 2023 | 12601.16 | 12601.16 | ✅ |
| Perso (Revenu) | 2023 | 47822.02 | 47822.02 | ✅ |
| Perso (Dépense) | 2024 | 148594.50 | 148594.50 | ✅ |
| Perso (Revenu) | 2024 | 49886.00 | 49886.00 | ✅ |
| Perso (Dépense) | 2025 | 28090.32 | 28090.32 | ✅ |
| Perso (Revenu) | 2025 | 53871.82 | 53871.82 | ✅ |
| Perso (Dépense) | 2026 | 115951.40 | 115951.40 | ✅ |
| Perso (Revenu) | 2026 | 61303.79 | 61303.79 | ✅ |

## 4. Export Excel depuis la base puis relecture

✅ 2755 lignes exportées et relues à l’identique (identifiants UUID conservés)

## 5. Fichier Excel d’origine

✅ Inchangé (SHA-256 identique avant et après : `bb420b64af0eef1e424ab63519a2055e01033ac89200e74dda8a4096eded5723`)

## Verdict : ✅ migration sans perte

Un point de restauration « Avant migration initiale depuis Excel » a été créé dans la base avant le chargement.
