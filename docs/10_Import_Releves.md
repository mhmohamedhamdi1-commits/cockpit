# Import de relevés bancaires (écran « À valider »)

Route `#/imports` (menu « À valider », pastille = nombre de lignes en attente). Fichiers : `app/js/revolut.js` (lecture), `app/js/classify.js` (classement),
`app/js/views/imports.js` + `app/css/imports.css` (écran), `app/vendor/pdf.min.mjs` + `pdf.worker.min.mjs` (pdf.js 4.10, licence Apache-2.0, `pdfjs-LICENSE.txt`),
tests : `tests/revolut.test.mjs` (moteur, PDF compris) et `tests/imports-ui.mjs` (parcours navigateur sur fausse API, y compris PDF sous la CSP du site).

## Formats lus
| Format | Détail |
|---|---|
| CSV Revolut personnel | EN `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance` et FR `Type,Produit,Date de début,Date de fin,Description,Montant,Frais,Devise,État,Solde` ; séparateur `,` `;` ou tabulation, décimales `.` ou `,`, milliers « 1 234,56 » ou « 1,234.56 », guillemets, BOM, UTF-8 ou Windows-1252 |
| CSV Revolut Business | `Date started (UTC)…Reference, Payer, Payment currency, Amount, Fee, Fee currency, Balance, Account…` ; la *Reference* est ajoutée au libellé |
| Excel `.xlsx` / `.xls` | mêmes colonnes, dates Excel ou texte, premier onglet reconnu |
| PDF | tableau « Date / Description / Money out / Money in / Balance » (ou « Argent sortant / Argent entrant / Solde ») ; dates « Nov 12, 2025 », « 12 nov. 2025 », ISO, JJ/MM/AAAA ; lignes de suite de libellé rattachées, lignes techniques (« Card: … », taux) écartées, plusieurs pages, items fusionnés par pdf.js redécoupés |

Règles : seules les lignes **terminées** sont gardées (en cours / annulées / refusées sont comptées « écartées ») ; la colonne *Frais* devient une **dépense séparée** (« Frais — … ») ;
devises EUR, MAD, USD, GBP, CHF (autre devise : ligne signalée, pas importée) ; montant signé (+ entrée, − sortie), l'opération créée est toujours positive avec le sens Revenu/Dépense.

## Limites — PDF
Écrit **sans échantillon réel** de relevé Revolut : testé sur un PDF généré avec la même structure de colonnes (EN et FR). Si la mise en page diffère, l'écran affiche
« Mise en page du PDF non reconnue… exporte en CSV ou Excel ». Le CSV/Excel reste le format recommandé (Revolut : Comptes › … › Relevé). Pas d'OCR (PDF scanné refusé avec message).
pdf.js (≈1,7 Mo) n'est chargé qu'à l'import d'un PDF ; il est toutefois pré-cacheté par le service worker (tout `app/` l'est).

## Anti-doublon
Chaque ligne a une empreinte `hash` = source | date | montant | devise | libellé normalisé | rang d'occurrence du même quadruplet dans le fichier. Ré-importer le même relevé, ou un relevé qui
chevauche, ne recrée rien (pré-filtre sur `import_lignes` + index unique en base). Deux achats identiques le même jour restent deux lignes. Les lignes ignorées gardent leur empreinte.
Supprimer les lignes **en attente** d'un fichier (carte « Historique ») libère leurs empreintes : on peut le ré-importer.
La validation pose `ref = 'REV:' + hash` sur l'opération (unique par utilisateur).

## Classement automatique (`classify.js`)
1. **Type Revolut** : change de devise, rechargement, virement vers soi-même (« Mon nom » renseigné, prénom + nom) → statut *ignoré* d'office (retrouvable dans l'historique) ; frais → Frais bancaires (Perso) / Comptable & banque (Entreprise) ; intérêts, cashback, remboursements → revenu.
2. **Historique** : même commerçant déjà catégorisé (libellé normalisé, 2 premiers mots, 1er mot) pour la même activité et le même sens, avec score.
3. **Mots-clés** (supermarchés, restauration, transports, carburant, abonnements, télécoms, santé, énergie, assurances, impôts, comptable, URSSAF…) vers les catégories **qui existent chez l'utilisateur** (nom exact, sinon inclusion) ; règles propres à Entreprise et Immobilier.
4. Sinon « à classer » : la catégorie est demandée à la validation (un choix par activité et sens).
Doublons avec les opérations déjà saisies : même devise et montant, ±2 jours, libellé proche (ou même date) → badge « déjà saisie ? », décoché ; « Tout valider » les épargne.

## Vie privée
Le fichier est lu **dans le navigateur** (aucun envoi, y compris pour le PDF). Seules les lignes que tu ajoutes à la file sont enregistrées (table `import_lignes`, privée, MFA), puis validées en opérations.
Colonne `detail` = étiquette du fichier d'origine (`lot:AAAAMMJJHHMM:nom`) ; `note` = raison d'un ignoré automatique.

## Validation
Un seul lot atomique par paquet de 100 lignes : `upsert('tx', {…, ref:'REV:'+hash})` + `upsert('ligne', {statut:'valide', txRef…})`. Si une opération est refusée, aucun statut du paquet ne change. « Annuler la validation » (historique) supprime l'opération et remet la ligne en attente.
