# 11 — Carte « Où je me situe » : comparaison France / Maroc / Monde

Module : `app/js/compare.js` (pur, sans DOM ni import). Tests : `tests/compare.test.mjs` (`node --test tests/compare.test.mjs`).
Chiffres relevés le **28/11/2026**. **À relire une fois par an** : INSEE publie les déciles de niveau de vie en juillet, UBS son Global Wealth Report en juin-juillet, le FMI le WEO en avril et en octobre, et l'INSEE les comptes nationaux en mai.

## 1. Chiffres retenus

### Revenu (par personne, annuel)

| Zone | Mesure | Année | Valeurs | Méthode | Source |
|---|---|---|---|---|---|
| 🇫🇷 France | Niveau de vie (revenu disponible / UC, après impôts et prestations), € | 2024 | D1 13 970 · D2 17 700 · D3 20 980 · D4 23 880 · **médiane 26 740** · D6 29 880 · D7 33 680 · D8 38 780 · D9 48 580 · P95 61 220 ; Gini 0,302 | déciles (interpolation) + Pareto au-delà du P95 (P99 extrapolé ≈ 105 k€) | INSEE, ERFS 2024, [Distribution des niveaux de vie](https://www.insee.fr/fr/statistiques/2416808) (09/07/2026) ; [Insee Première n° 2117](https://www.insee.fr/fr/statistiques/9019316) |
| 🇲🇦 Maroc | Revenu par personne (revenu du ménage / taille), MAD | 2019 | P10 6 270 · P90 41 705 · moyenne 21 515 · Gini 46,4 % · part des 10 % du haut 37,8 % ; médiane par personne **estimée 16 171** | log-normale (σ = 0,7393 ajusté sur P10/P90) + Pareto α ≈ 2,05 au-delà du P90 — `estimated: true` | HCP, enquête sources de revenus 2019, [note du 28/04/2021](https://www.hcp.ma/Revenus-des-menages-Niveaux-sources-et-distribution-sociale_a2697.html) (chiffres repris par [EcoActu](https://ecoactu.ma/revenus-des-menages/), [Le360](https://fr.le360.ma/economie/hcp-au-maroc-le-revenu-median-par-menage-est-de-5133-dirhams-par-mois-237648/)) |
| 🌍 Monde | Revenu **ou consommation** par personne, $ PPA 2021 | 2024 | P10 1 087 · P20 1 616 · P30 2 071 · P40 2 603 · **médiane 3 360** · P60 4 566 · P70 6 605 · P80 10 557 · P90 19 739 · P95 29 922 · P99 59 435 (= 9,20 $/jour à la médiane) | déciles (interpolation) + Pareto au-delà du P99 | Banque mondiale, [PIP](https://pip.worldbank.org) version 20260922 (PPA 2021) ; seuils obtenus par l'API `pip-grp` (71 seuils de 1 à 400 $/jour, interpolation) |

Repère Maroc plus récent : HCP, ENNVM 2022-2023, revenu annuel moyen par personne **21 949 DH** en 2022 (+2 % vs 2019), dépense moyenne 20 658 DH, Gini des **dépenses** 40,5 % ([note HCP](https://www.hcp.ma/Note-sur-les-principaux-resultats-de-l-Enquete-Nationale-sur-le-Niveau-de-Vie-des-Menages-2022-2023_a4061.html)). L'ENNVM 2022 ne publie pas de distribution du revenu par personne, d'où l'usage de l'enquête 2019.

Contrôle France P99 : Filosofi 2021 donne un seuil des 1 % les plus aisés à 90 140 € de niveau de vie en euros 2021 ([INSEE, Très hauts revenus](https://www.insee.fr/fr/statistiques/7941389)). Revalorisé de l'inflation 2022-2024, cela fait environ 101 à 103 k€, cohérent avec l'extrapolation de Pareto (≈ 105 k€).

### Patrimoine net par adulte (USD courants)

| Zone | Année | Médiane | Moyenne | < 10 k$ | 10–100 k$ | 100 k–1 M$ | > 1 M$ | Méthode | Source |
|---|---|---|---|---|---|---|---|---|---|
| 🇫🇷 France | fin 2022 | 133 137 | 312 235 | 15,5 % | 26,1 % | 52,7 % | 5,6 % | tranches + médiane + effectifs > 5 M$ (0,382 %) et > 10 M$ (0,110 %), interpolation + Pareto | UBS Global Wealth Databook 2023, Tables 3-1 et 3-6 |
| 🇲🇦 Maroc | fin 2022 | 3 896 | 13 862 | 77,6 % | 20,3 % | 2,0 % | 0,1 % | tranches + médiane, interpolation + Pareto ; `estimated: true` (UBS : estimation par régression, qualité « faible ») | idem, Table 3-1 |
| 🌍 Monde | fin 2022 | 8 654 | 84 718 | 52,5 % | 34,4 % | 12,0 % | 1,1 % | seuils mondiaux P10 −168 · P20 855 · P30 2 236 · P40 4 569 · P50 8 654 · P60 14 589 · P70 25 669 · P80 52 187 · P90 137 333 · P95 292 510 · P99 1 081 342 ; > 5 M$ 0,146 % ; > 10 M$ 0,051 % | idem, Tables 4-1, 4-5 et 3-6 |

Source : [UBS Global Wealth Databook 2023](https://www.ubs.com/global/en/family-office-uhnw/reports/global-wealth-report-2023/_jcr_content/mainpar/toplevelgrid_5684475/col2/linklistnewlook/link_copy.0357374027.file/PS9jb250ZW50L2RhbS9hc3NldHMvd20vZ2xvYmFsL2ltZy9nbG9iYWwtZmFtaWx5LW9mZmljZS9kb2NzL2RhdGFib29rLWdsb2JhbC13ZWFsdGgtcmVwb3J0LTIwMjMtZW4ucGRm/databook-global-wealth-report-2023-en.pdf) ([copie](https://elements.visualcapitalist.com/wp-content/uploads/2024/08/global-wealth-databook-2023-ubs.pdf)). C'est la dernière édition qui publie la distribution par pays, Maroc compris.

Repères plus récents, conservés dans `DATA` sans être utilisés pour le calcul : [UBS Global Wealth Report 2026](https://www.ubs.com/global/en/wealthmanagement/insights/global-wealth-report.html) (fin 2025, 56 marchés, Maroc absent).
- France : médiane 121 898 $, moyenne 341 359 $, 2 388 k millionnaires en USD (≈ 4,5 % des adultes).
- Pyramide « monde » (56 marchés, 3,85 Md d'adultes) : < 10 k$ 42,1 % · 10–100 k$ 41,1 % · 100 k–1 M$ 15,3 % · > 1 M$ 1,5 %.

### Taux d'épargne des ménages (épargne brute / revenu disponible brut)

| Zone | Taux | Année | Source |
|---|---|---|---|
| 🇫🇷 France | 17,9 % (moyenne 2009-2019 : 14,7 %) | 2025 | INSEE, [comptes de la Nation 2025](https://www.insee.fr/fr/statistiques/8996855) (Insee Première n° 2105, mai 2026) |
| 🇲🇦 Maroc | 11,3 % (119,98 Md DH / 1 059,7 Md DH) | 2024 | HCP, [comptes des secteurs institutionnels 2024](https://www.hcp.ma/Les-comptes-nationaux-des-secteurs-institutionnels-2024-Base-2014-Decembre-2025-Rapport-complet_a4225.html) (déc. 2025) |
| 🇪🇺 Zone euro | 15,2 % (moyenne des trimestres 2024) | 2024 | Eurostat, [communiqué du 13/01/2026](https://ec.europa.eu/eurostat/web/products-euro-indicators/w/2-13012026-ap) |
| 🌍 Monde | non disponible | — | Aucune moyenne mondiale homogène. L'OCDE publie un taux **net**, non comparable aux taux bruts ci-dessus. |

### Parités de pouvoir d'achat et inflation

| Paramètre | Valeur | Source |
|---|---|---|
| PPA France | 0,643 € par $ international (2026, est.) ; 0,654 en 2025 | FMI, WEO octobre 2026, [PPPEX](https://www.imf.org/external/datamapper/PPPEX@WEO) |
| PPA Maroc | 3,836 MAD par $ international (2026, est.) ; 3,93 en 2025 | idem |
| Inflation FR (IPCH) 2025 / 2026 | 0,9 % / 2,4 % | FMI, WEO octobre 2026, [PCPIPCH](https://www.imf.org/external/datamapper/PCPIPCH@WEO) |
| Inflation MA 2020 → 2026 | 0,7 · 1,4 · 6,6 · 6,1 · 0,9 · 0,8 · 0,9 % | idem |
| Inflation US 2022 → 2026 | 8,0 · 4,1 · 3,0 · 2,7 · 3,6 % | idem |

L'API de la Banque mondiale (facteur PPA de la consommation privée, PA.NUS.PRVT.PP) était bloquée lors de la relève. Les facteurs du FMI reposent sur le même programme PCI 2021, mais ils portent sur le **PIB**.

## 2. Méthode

- **Percentile** = part de la population située en dessous de la valeur, dans [0 ; 0,9999]. `topPct` = 100 × (1 − percentile). L'affichage arrondit à l'entier au-dessus de 10 %, à une décimale entre 1 et 10 %, et à un chiffre significatif sous 1 %.
- **Interpolation (`method: 'deciles'`)** : linéaire en ln(valeur) entre deux points publiés, ce qui la rend monotone. Quand un point est négatif (P10 du patrimoine mondial), l'interpolation est linéaire en valeur. Sous le premier point, on interpole linéairement depuis (0 ; 0).
- **Log-normale (`method: 'lognormal'`)** : Φ((ln v − ln médiane) / σ). Pour le revenu marocain, σ = ln(P90/P10) / (2 × 1,28155) et la médiane vaut √(P10 × P90). La moyenne implicite (21 254 DH) est à 1,2 % de la moyenne publiée.
- **Queue de Pareto** au-delà du dernier point : 1 − F(v) = (1 − p₀)(v/v₀)^−α. α vient des deux derniers points, borné à [1,1 ; 5], ou est fixé (`tailAlpha`, `tail.alpha`). Pour le Maroc, α ≈ 2,05 est calibré sur la part de 37,8 % des revenus détenue par les 10 % du haut. Le résultat est plafonné à 0,9999 (« 0,01 % les plus aisés »).
- **Valeur ≤ 0** : percentile 0, sauf pour le patrimoine mondial. Son P10 étant négatif (−168 $), un patrimoine nul dépasse environ 11,6 % des adultes.
- **Revalorisation (revenu)** : les seuils publiés sont multipliés par l'inflation cumulée jusqu'en 2026 (`inflation: true` par défaut).
  - France : de 2024 à 2026, × 1,033.
  - Maroc : de 2019 à 2026, × 1,185.
  - Monde : prix 2021 → 2026 avec l'inflation américaine, × 1,232.
  - Le patrimoine n'est **pas** revalorisé (USD courants fin 2022).
- **Conversion nominale** : MAD = € / `fx.MAD`, USD = € / `fx.USD`, avec les taux du jour fournis par l'appelant (1 devise en EUR, comme `tx.taux`).
- **Conversion PPA** (`ppp: true`) : équivalent local = € / PPA_FR × PPA_pays. Le monde est exprimé en $ internationaux (€ / 0,643). Pour le patrimoine marocain, l'équivalent MAD est ensuite converti en USD au taux du jour, puisque les tranches UBS sont en USD de marché.

## 3. Limites

- **Revenu ≠ niveau de vie ≠ consommation.**
  - France : niveau de vie par **unité de consommation**. Il faut fournir le revenu disponible du ménage après impôt sur le revenu, divisé par les UC (1 + 0,5 par personne de 14 ans ou plus + 0,3 par enfant de moins de 14 ans). Pour une personne seule, c'est le net après impôt.
  - Maroc : revenu par **personne**.
  - Monde : selon les pays, revenu **ou** consommation par personne. La consommation est inférieure au revenu, ce qui fait paraître le monde plus pauvre.
- **Nominal vs PPA.**
  - La distribution mondiale du revenu n'existe qu'en $ PPA. En mode nominal, ton revenu converti au taux de marché est comparé à des $ PPA, une approximation prudente qui te classe plutôt plus bas.
  - En mode PPA, l'écart avec le Maroc se réduit : le coût de la vie y est environ 2 fois plus faible au taux de marché.
- **Adulte vs ménage.** Le patrimoine UBS est **par adulte**. Pour un couple, on divise le patrimoine du ménage par le nombre d'adultes. Le revenu est par personne ou par UC.
- **Années différentes.**
  - Revenu : France 2024, Maroc 2019, monde 2024. Les seuils sont revalorisés de l'inflation, mais la forme de la distribution est supposée inchangée.
  - Patrimoine : fin 2022 pour les trois zones. Depuis, le patrimoine moyen a progressé (UBS : +4,2 % en 2023, +4,6 % en 2024, +10,8 % en 2025 pour le patrimoine total en USD), alors que la médiane française a baissé (121 898 $ fin 2025).
  - Les variations du taux EUR/USD depuis fin 2022 décalent aussi la comparaison.
- **Maroc** :
  - La médiane du revenu par personne est **estimée** : seuls P10, P90, la moyenne, le Gini et les parts sont publiés.
  - Le patrimoine marocain est une estimation UBS par régression, de qualité « faible ».
  - Le Maroc est absent des Global Wealth Reports 2024 à 2026.
- **Très hauts revenus et patrimoines** : les enquêtes les sous-estiment. Au-delà du dernier point publié, la queue de Pareto reste indicative, et tout est plafonné à « 0,01 % ».
- **Épargne** : il s'agit de taux macroéconomiques (comptes nationaux, épargne brute incluant le remboursement du capital des emprunts immobiliers). Ils ne sont pas strictement comparables à un taux calculé à partir des transactions de l'utilisateur.

## 4. API

```js
import { COUNTRIES, DATA, percentileOf, priceFactor, compareIncome, compareWealth, compareSavings, explain } from './compare.js';
percentileOf(value, dist)                     // → [0..0,9999] (NaN si value est NaN)
compareIncome(annualNetEur, { fx, ppp = false, inflation = true })
compareWealth(netWorthEur, { fx, ppp = false })
// → { kind: 'income'|'wealth', amountEur, ppp, refYear, zones: [{ code, label, flag, currency, value, percentile, topPct,
//      medianLocal, ratioToMedian, method, year, source, url, note, estimated, medianEur, (priceFactor | valueEur) }] }
compareSavings(rate)                          // rate en fraction (0,25) ou en % (25) → { kind: 'savings', rate, zones: [{ code, label, flag, rate, diffPts, ratio, above, year, source, url, note }] }
explain(result)                               // phrase française
priceFactor(country, fromYear, toYear = 2026) // inflation cumulée (FMI WEO)
```
