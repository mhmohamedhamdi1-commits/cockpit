# Cockpit v3 — retours de la recette (28 novembre 2026)

Branche `main` (dev) puis `release` (production). Migration `supabase/migrations/0007_v3.sql` (rejouable). Tests : `node --test tests/`, `node tests/ui-flows.mjs` (57 contrôles sur fausse API), `tests/e2e.mjs` (17 sur la vraie base DEV).

| # | Retour | Réalisation |
|---|---|---|
| 1 | Santé financière qui suit le filtre, « Tout » = toutes les recommandations, « propose-moi mieux » | Filtre Tout / Perso / Entreprise / Immobilier / **Bourse** : un score par domaine, un conseil par indicateur non vert, « À améliorer en priorité » avec les points à gagner (`core.financialHealth`) |
| 2 | Écran flou en agrandissant une carte | Cause : la synchro (30 s) redessinait l'écran et laissait le voile sans la carte. L'état « agrandi » survit aux rafraîchissements, plus aucun flou (`enhance.js`, `style.css`) |
| 3 | Import Revolut → opérations à valider | Écran « À valider » (CSV FR/EN, Business, Excel, PDF), classement automatique, détection des doublons, validation en un lot (docs/10) |
| 4 | « 83, c'est quoi ? » + comparaison France / Maroc / monde | « Comprendre mon score » (formule, détail, gains) ; carte « Où je me situe » (revenu, patrimoine, épargne ; INSEE, HCP, Banque mondiale, UBS ; docs/11) |
| 5 | Retraits au-delà de 67 % : qui doit quoi, retrait max | Carte « Comptes entre associés » (apports, retraits, écart, dette, retrait maximum) — `immo-calc.partnerBalances` |
| 6 | Capital récupéré + projection | Carte « Capital récupéré » : % récupéré, reste, année de retour, hypothèse de hausse des loyers |
| 7 | Double confirmation avant de supprimer un projet | Deux fenêtres, la 2ᵉ en recopiant le nom (projet immobilier et entreprise) |
| 8 | Lots en fin de page | Carte « Lots » tout en bas |
| 9 | Message WhatsApp / SMS au locataire | Boutons Relancer / Message sur chaque locataire, carte « Loyers à relancer », 4 modèles FR/AR |
| 10 | Notification facture d'électricité du 1 au 3 | Une notification par jour du 1ᵉʳ au 3 (réglable) tant que la dépense « Eau & électricité » du mois n'est pas saisie + alerte du tableau de bord |
| 11 | Idées d'analyses immobilières | Carte « Analyses et recommandations » (rendement net, charges, refacturation eau/élec., vacance, loyers sous la moyenne, cautions à restituer, mauvais payeurs, dette, prévision de cash-flow) + valeur estimée du bien |
| 12 | Taux d'occupation sur la période | KPI en jours-lots sur la période sélectionnée |
| 13 | Répartition par secteur en bourse | Secteur détecté (Yahoo) ou choisi, répartition par secteur, tableau de bord Bourse |
| 14 | Brique Impôt | Écran Impôt : barèmes 2024-2026 vérifiés + projection automatique, pension à un parent, taux effectif Maroc… (docs/08) |
| 15 | Bourse dans le patrimoine | Ajoutée automatiquement (KPI, courbe, tableau, répartition) |
| 16 | Entreprise jamais additionnée | « Tout » = Perso + Immobilier ; l'entreprise est affichée à part (« non cumulée ») |
| 17 | Module Entreprise (projet = entreprise) | Assistant de création, facturation du mois, plafonds, charges estimées, planning de déclarations, plusieurs entreprises (docs/09) |
| 18 | Devises EUR, MAD, USD, GBP, CHF | Saisie, comptes, factures, affichage ; taux réels quotidiens et historique |
| 19 | Code de lot incrémental | Vide = code suivant attribué automatiquement |
| 20 | Fonctions « Finary » | Objectifs et projections, indépendance financière, revenus passifs, répartition du patrimoine, dividendes, mode confidentialité |
