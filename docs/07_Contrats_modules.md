# v3 — contrats entre modules (travail en parallèle)

Branche `main` (dev). Chaque module a ses fichiers ; ne pas toucher à ceux des autres. Les points d'intégration (core.js, calc.js, state.js,
main.js, dashboard.js, immo.js, bourse.js, wealth.js, settings.js, style.css, rappels/index.ts, deploy.mjs…) sont faits par le chef de projet.

## Données (migration 0007, déjà en place — `supabase/migrations/0007_v3.sql`, tests `tests/v3.test.mjs`)
- `projets` : `type` = `Immobilier` | `Entreprise`, `part` = **ma part** (0..1), `devise`, `meta` (jsonb libre, objet).
  Helpers `state.js` : `immoProjets()`, `entreprises()`, `isImmo(p)`, `partOf(projetId)`.
- `clients`, `invoices` : `projetId` (= l'entreprise), `invoices.refExt` (réf. plateforme de facturation, ex. Tiime), `invoices.echeance`.
  Numérotation des factures `F-AAAA-NNN` automatique, **une séquence par entreprise**.
- `tx` : activité `Perso` | `Entreprise` | `Immobilier` (l'ancien « Freelance » est devenu « Entreprise », « Freelance » est converti à l'entrée).
  `tx.projetId` est conservé pour `Immobilier` ET `Entreprise`. Devises : `EUR MAD USD GBP CHF` (`taux` = 1 devise en EUR, rempli par le serveur).
- `import_lignes` (entité `ligne`) : lignes de relevé bancaire en attente (statut `attente` | `valide` | `ignore`), unicité (`hash`).
- `objectifs` (`objectif`), `fiscal` (`fiscal` : une ligne par année de revenus, `data` jsonb), `declarations` (`declaration` : suivi fait/payé d'une échéance,
  clé unique projet+code+période), `bareme_fiscal` (table commune lecture seule : `annee`, `data` jsonb, `statut` officiel|estime, `source`).
- Écriture : toujours `ops([upsert('tx', {...}), ...])` de `state.js` (jamais d'écriture directe). Lecture : `S.data.<table>` (ex. `S.data.import_lignes`, `S.data.fiscal`).
  Les champs d'interface sont en camelCase (voir `schema.js` : `projetId`, `refExt`, `typeOp`, `txRef`…).

## Contrat Entreprise → Impôt (`app/js/entreprise.js`, module PUR : aucun DOM, importe seulement util.js, utilisable dans Deno)
```js
export function fiscalIncome(ctx, projet, year) // ctx = { data, today, P, ... } comme core.js ; projet = ligne `projets` (type Entreprise)
→ { projetId, nom, forme, regimeIR: 'micro' | 'reel_ir' | 'is',
    part,                       // ma part (0..1)
    ca,                         // CA encaissé HT de l'année (100 % de l'entreprise, en EUR)
    bnc, bic,                   // bénéfice imposable à l'IR **ma part**, en EUR (micro : CA×part − abattement ; réel IR : résultat×part) ; l'autre vaut 0
    microAbattement,            // { taux, montant } | null
    versementLiberatoire,       // true : l'IR est déjà payé par versement libératoire → ces revenus sortent du barème (mais comptent dans le RFR)
    salaireNetImposable,        // rémunération de dirigeant versée à moi (ma part), en EUR
    dividendesBruts,            // dividendes qui me sont distribués (ma part), en EUR
    cotisationsDeductibles,     // cotisations sociales TNS déductibles du revenu (ma part)
    estimated: boolean, notes: string[] }
```
Le module Impôt n'importe PAS `entreprise.js` dans son moteur (`impot.js` reçoit un tableau de ces objets en paramètre) ; seule la vue `views/impot.js`
l'appelle, en vérifiant `typeof ent.fiscalIncome === 'function'`.

Autres exports attendus d'`entreprise.js` (utilisés par le chef de projet pour le tableau de bord, la santé financière et les notifications) :
```js
export function entrepriseYear(ctx, projet, year)        // { paid, billed, planned, total, plafondCA, tvaSeuil, tvaSeuilMaj, factor, ... } (remplace core.freelanceYear)
export function upcomingDeadlines(ctx, today, days = 45) // [{ projetId, nom, code, label, date, inDays, amount?, done }] (déclarations / paiements à venir)
export function entrepriseAlerts(ctx)                    // alertes {id, kind, ic, title, sub, go, label} (plafonds, retards, échéances) — mêmes formes que core.computeAlerts
export function entrepriseHealth(ctx, projets)           // indicateurs de santé {id,label,value,fmt,level,text} propres à l'entreprise (voir core.financialHealth)
```
Données de test : `tests/mockdata.mjs` (+ `buildMockDb()`), fausse API `tests/mock-api.mjs`, tests d'interface par `DIST_DIR=/tmp/dist-<nom> PORT=<port> node tests/ui-mock.mjs --quick`
(chaque module utilise **son propre** DIST_DIR et PORT pour ne pas se marcher dessus : impôt 8792, entreprise 8793, import 8794).
