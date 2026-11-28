# Brique Impôt (v3, point 14)

Fichiers : `app/js/impot-data.js` (barèmes sourcés), `app/js/impot.js` (moteur pur), `app/js/views/impot.js` + `app/css/impot.css` (écran),
`tests/impot.test.mjs` (30 tests), `tests/impot-ui.mjs` (contrôle de l'écran sur fausse API).

## Ce qui est calculé (par année de revenus, déclarée l'année suivante)
Revenus : salaires (net imposable, abattement 10 % min/max **par déclarant** ou frais réels) ; pensions (10 %, min par pensionné, plafond foyer) ;
micro-BNC / micro-BIC (abattements 34 % / 50 % / 71 %, minimum 305 €) et bénéfices réels ; **versement libératoire** (sort du barème, reste dans le RFR) ;
revenus fonciers France (micro 30 % ≤ 15 000 € ou réel, déficit imputable plafonné à 10 700 €) ; **revenus fonciers de source étrangère (Maroc)** ;
dividendes, intérêts, plus-values mobilières (moins-values reportables imputées).
Déductions du revenu global : **pension alimentaire à un ascendant (sans plafond légal, sur justificatifs)**, pension à un enfant majeur (plafond par enfant),
forfait d'hébergement d'un ascendant, PER (plafond calculé ou saisi depuis l'avis d'imposition), cotisations TNS, CSG déductible, autres charges.
Calcul : parts (situation, enfants, garde alternée, parent isolé, case L, demi-parts), quotient familial, **plafonnement de l'avantage**, **décote**, réductions
(dons 66 % / 75 %), crédits remboursables (emploi à domicile, garde d'enfants), **PFU ou barème** (le plus favorable est retenu automatiquement, ou choix forcé),
prélèvements sociaux (taux par nature de revenu et par année), CEHR, prélèvement à la source déjà versé → **reste à payer / à restituer**, TMI, taux moyen,
provision mensuelle conseillée, détail pas à pas et avertissements.

### Revenus fonciers marocains
Convention France–Maroc du 29/05/1970 (art. 9 et 25) : l'imposition des loyers d'un immeuble situé au Maroc revient au Maroc ; la France les exonère mais les retient
pour fixer le **taux effectif** (impôt calculé sur la base élargie × revenu imposable ÷ base élargie ; aucun prélèvement social). C'est l'option par défaut. Deux autres options :
« imposés en France avec crédit d'impôt » (crédit limité à l'impôt français correspondant) et « ignorer ». Les sources divergent sur la case à utiliser
(2042-C cases 4EA/4EB, ou formulaire 2047/8TI) : l'écran avertit de **faire valider** ce point (BOFiP `BOI-INT-CVB-MAR`). Les loyers marocains restent à déclarer au Maroc.

## Que saisir ? (réponse à la question de Mohamed)
1. **Net imposable ANNUEL** (fiche de paie de décembre, « cumul net imposable » / « net fiscal annuel » ; sinon 12 × le net fiscal mensuel), pas le net mensuel versé.
   Cockpit pré-remplit une estimation depuis les opérations « Salaire & primes » — à remplacer par le chiffre exact.
2. Situation de famille au 31/12, enfants à charge.
3. Pension versée à un parent, PER, dons… (section « Ce qui réduit ton revenu imposable »).
4. Prélèvement à la source déjà versé (cumul de la fiche de décembre).
Tout le reste est automatique : immobilier (résultat courant × ma part, converti en €), bourse (dividendes et plus-values réalisées des comptes imposables, hors PEA/AV/PER),
entreprises (`fiscalIncome` d'`entreprise.js`), barème et seuils. Chaque champ affiche « calculée » ou « saisie » ; la saisie est prioritaire (↺ pour revenir au calcul).
Les infos sont enregistrées par année de revenus dans la table `fiscal` (jsonb), synchronisées sur tous les appareils.

## Pérennité : barèmes mis à jour chaque année
Ordre de résolution (`resolveBareme(annee, { table })`) :
1. **Table `bareme_fiscal`** (commune, lecture seule pour l'application) : une ligne par année `{ annee, data, statut, source }`. Une ligne **complète** (mêmes clés que `impot-data.js`)
   remplace le barème ; une ligne **partielle** (ex. `{"qf":{"demiPart":1900}}`) corrige seulement les clés présentes.
2. Barème embarqué (`impot-data.js` : 2024 et 2025 officiels, 2026 = PLF 2027 « estimé »).
3. **Projection automatique** de la dernière année connue (indexation de 2 % par an par défaut, paramétrable) marquée « estimé » : l'outil continue de fonctionner sans changer une ligne de code.
L'écran affiche « Barème officiel » ou « Barème estimé ». Mise à jour sans redéploiement (SQL Supabase, rôle de service) :
```sql
insert into bareme_fiscal (annee, statut, source, data) values (2027, 'officiel', 'LF 2027 art. X', '{ ...objet complet comme BAREMES[2025]... }'::jsonb)
on conflict (annee) do update set data = excluded.data, statut = excluded.statut, source = excluded.source, maj = now();
```
Chaque décembre : vérifier la loi de finances de l'année et remplacer la projection par la ligne officielle.

## Valeurs vérifiées (28/11/2026) et sources
| Donnée | Valeur | Source |
|---|---|---|
| Barème revenus 2025 (LF 2026 art. 4, +0,9 %) | 11 600 / 29 579 / 84 577 / 181 917 € — 0/11/30/41/45 % | LégiFiscal n°4474, BOFiP 7/04/2026 |
| Plafond QF 2025 ; parent isolé ; « élevé seul » | 1 807 € ; 4 262 € ; 1 079 € | idem |
| Décote 2025 | 897 € / 1 483 € (seuils 1 982 / 3 277 €), 45,25 % | idem |
| Barème revenus 2024 (LF 2025, +1,8 %) | 11 497 / 29 315 / 83 823 / 180 294 € ; QF 1 791 € ; décote 889 / 1 470 € | LégiFiscal n°4102 |
| Abattement 10 % salaires | 2025 : 509–14 555 € ; 2024 : 504–14 426 € | simulateur-gratuit.fr, Kohen Avocats |
| Abattement 10 % pensions 2025 | 454 € min, 4 439 € max / foyer | efforts.fr (recoupé) |
| PS capital | LFSS 2026 art. 12 : 18,6 % (CSG 10,6 %) sur dividendes/intérêts perçus dès le 1/1/2026 ; fonciers et assurance-vie restent à 17,2 % ; CSG déductible 6,8 % | Hagnéré Patrimoine, DLA Piper, Actu-Juridique |
| Pension alimentaire | enfant majeur 6 855 € (2025) / 6 794 € (2024) ; hébergement 4 075 € ; ascendant : sans plafond | economie.gouv.fr, service-public.gouv.fr A15453 |
| Micro | 34 % / 50 % / 71 %, min 305 € ; versement libératoire 2,2 % / 1,7 % / 1 % | economie.gouv.fr, Calcunet |
| PER salarié | 10 % des revenus N-1, max 8 PASS, plancher 10 % du PASS (PASS 2024 46 368 €, 2025 47 100 €) | Linxea, Hagnéré |
| Emploi à domicile / garde / dons | 50 % (12 000 € +1 500 €/enfant, max 15 000 €) ; 50 % (3 500 €/enfant) ; 66 % et 75 % (plafond 1 000 €, 2 000 € depuis le 14/10/2025) | impots.gouv.fr, economie.gouv.fr |
| CEHR | 3 % / 4 % (seul 250 k–500 k–, couple 500 k–1 M) | art. 223 sexies CGI ; BOFiP BOI-IR-CDHR |

## Estimé / à surveiller
- **Revenus 2026 (déclaration 2027)** : barème du **PLF 2027, non voté** (+2,1 % : 11 844 / 30 200 / 86 353 / 185 737 €, QF 1 845 €, décote 915 / 1 513 €) ; autres plafonds indexés de 2,1 % ; le Sénat vote le 9/12/2026 ; sans budget le barème 2025 resterait en vigueur. **Statut « estimé »**.
- Taux de prélèvements sociaux sur **plus-values mobilières 2025** : les sources divergent (17,2 % ou 18,6 %) → 18,6 % retenu par prudence ; modifiable via `bareme_fiscal` (`ps.plusValues`).
- Plafond du versement libératoire (RFR) et CDHR (impôt minimum 20 % des hauts revenus) : non calculés.

## Limites connues
Estimation indicative. Non couvert : quotient exceptionnel, abattements spéciaux (65 ans / invalidité), plafonnement global des niches (10 000 € — simple avertissement),
LMNP/Pinel et autres régimes d'investissement, assurance-vie, PEA (exclus des plus-values automatiques), CSG déductible différée (à saisir : case 6DE), moins-values en report détaillé,
demi-parts invalidité/ancien combattant (plafond général appliqué). Toujours confronter au simulateur officiel impots.gouv.fr.
