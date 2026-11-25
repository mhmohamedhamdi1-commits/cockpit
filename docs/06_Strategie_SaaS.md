# Cockpit — transformer l'application en SaaS par abonnement

Date : 25/11/2026. Étude documentaire faite sur le web (sources indiquées). Beaucoup de prix viennent de comparateurs tiers et changent souvent : **à revérifier sur les sites officiels avant de fixer ta grille**. Aucun développement n'a été fait pour les sujets de ce document.

---

## 1. Synthèse

**Le marché.** Il existe de bons outils pour chaque besoin pris isolément :
- budget : Bankin', Linxo ;
- patrimoine : Finary ;
- freelance : Indy, Abby, Tiime ;
- bailleur : Rentila, Qalimo.

Je n'ai trouvé **aucun outil qui réunisse finances perso, activité indépendante et location, en multi-devises** (MAD notamment). Le plus proche, Monarch Plus, est américain, en dollars, sans la fiscalité française. Aujourd'hui, un francophone multi-activités empile 3 abonnements, pour environ **230 €/an** (Bankin' Plus 39,99 € + Abby Start 108 € HT + Rentila Silver 59 € HT).

**Positionnement proposé.** *« Le cockpit financier des multi-activités francophones »*. Un seul abonnement couvre le perso, la micro-entreprise, la location et la diaspora (EUR/MAD), pour moins cher que l'empilement.

**Niche d'attaque.** Les Marocains résidant à l'étranger (MRE) et les Franco-Marocains qui ont un bien au Maroc, un emploi ou une activité en France, et qui jonglent entre EUR et MAD. Personne ne les sert, c'est exactement ton cas, et la communauté est très soudée (groupes Facebook, WhatsApp, TikTok).

**Ma recommandation principale.** Lancer l'abonnement **sans synchronisation bancaire au départ** :
- saisie rapide ;
- import de relevés CSV/OFX/PDF ;
- automatismes, notifications, multi-devises.

Ajouter la synchro bancaire dans un 2ᵉ temps, une fois que des clients paient. La synchro coûte entre 150 et 500 £/mois de minimum chez les fournisseurs (estimation de source tierce), et elle impose un statut réglementé.

---

## 2. Concurrents (prix constatés, novembre 2026)

| Outil | Gratuit | Payant | Synchro bancaire |
|---|---|---|---|
| Bankin' | Oui | Plus 4,99 €/mois ou 39,99 €/an ; Pro 19,99 €/mois ou 99,99 €/an ([source](https://www.comparonslesbanques.com/banques/bankin/)) | Oui |
| Linxo | Oui | Premium environ 4 à 6 €/mois ([source](https://selectra.info/finance/guides/compte-bancaire/linxo)) | Oui |
| Finary | non vérifié | Lite 54,99 €/an, Plus 149,99 €/an, Pro 349,99 €/an ([source](https://parrainduweb.fr/blog/abonnement-finary)) | Oui |
| YNAB | Essai 34 jours | 14,99 $/mois ou 109 $/an ([source](https://www.ynab.com/pricing)) | Oui (couverture européenne non vérifiée) |
| Monarch | Non | 99,99 $/an ; Plus 199,99 $/an, avec suivi d'une activité et de biens locatifs ([source](https://getfinny.app/blog/monarch-money-pricing-2026)) | États-Unis |
| Copilot | Non | 18 $/mois ou 109 $/an ([source](https://treasury.sh/learn/how-much-does-copilot-money-cost)) | États-Unis, Apple uniquement |
| Emma | Oui | 4,99 à 14,99 £/mois ([source](https://help.emma-app.com/en/article/how-much-does-emma-plusproultimate-cost-1ywhulq/)) | Oui |
| Indy | Oui | 9 à 19 € HT/mois ([source](https://ccima.net/indy-tarifs/)) | Oui |
| Abby | Oui | 9 à 39 € HT/mois ; la banque n'est incluse que dans les offres payantes ([source](https://www.infos-pa.com/plateformes/abby/tarifs)) | Payant |
| Tiime | Oui | 9,99 à 24,99 €/mois ([source](https://comparateur-efacturation.fr/blog/tiime-avis-tarifs-test-complet-2026)) | Oui |
| Rentila | 1 lot | 59 à 119 € HT/an ([source](https://logio.fr/blog/prix-logiciel-gestion-locative-2026)) | — |
| BailFacile | Non | 9,99 €/bien/mois ([source](https://bailpdf.com/gestion-locative/bailfacile)) | — |
| Qalimo | — | 4,90 €/bien/mois ([source](https://www.qalimo.fr/tarif/)) | — |

**Consentement à payer.** 69 % des Français refusent un abonnement mensuel à une app ([source](https://www.softwareadvice.fr/blog/4179/applications-smartphone-utilisation-consommateurs)). Ceux qui acceptent de payer pour un service sans publicité citent 5,5 à 9 €/mois ([CNIL/Harris](https://www.cnil.fr/fr/les-francais-sont-ils-prets-payer-pour-des-services-en-ligne-sans-publicite-ciblee)).

**Conversion.**
- Modèle freemium : environ 2 % des téléchargements deviennent payants à 35 jours, contre environ 10,7 % avec un paywall strict ([RevenueCat](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026)).
- Durée d'essai : les essais longs (17 à 32 jours) convertissent nettement mieux que les essais de moins de 4 jours, 42,5 % contre 25,5 % ([source](https://www.businessofapps.com/data/app-subscription-trial-benchmarks/)).

## 3. Offre et prix recommandés

| Formule | Prix TTC | Contenu |
|---|---|---|
| **Gratuit** | 0 € | Finances perso en saisie manuelle et import de relevés, multi-devises, 1 activité limitée (par ex. 1 bien ou 10 factures par an), 1 appareil |
| **Essentiel** | 4,99 €/mois ou 44,99 €/an | Perso complet, tous appareils, notifications, automatismes, exports. Synchro bancaire des comptes perso quand elle sera disponible |
| **Pro multi-activités** | 9,99 €/mois ou 89,99 €/an | Toutes les activités (freelance, location jusqu'à 10 biens, commerce…), seuils URSSAF et TVA, factures, espaces partagés (associés, conjoint) |

**Leviers commerciaux :**
- essai Pro de 30 jours ;
- remise annuelle d'environ 25 % ;
- option « bien supplémentaire » à environ 2 €/mois ;
- tarif de lancement fondateurs (par ex. -40 % à vie pour les 200 premiers).

**Économie unitaire de la formule Pro mensuelle (9,99 € TTC) :**

| Poste | Montant | Détail |
|---|---|---|
| TVA (20 %) | -1,67 € | Il reste **8,33 € HT** |
| Stripe | -0,47 € environ | 1,5 % + 0,25 € par paiement, + 0,7 % pour la facturation récurrente ([source](https://stripe.com/en-fr/billing/pricing)) |
| Agrégation bancaire | -0,50 à -1 € | Seulement si la synchro est activée |
| Hébergement | -0,05 € environ | Par utilisateur |
| **Marge brute** | **≈ 6,8 à 7,3 €/mois** | |

En annuel, les frais fixes Stripe pèsent beaucoup moins : c'est une raison de pousser l'abonnement annuel.

**Où encaisser :**
- **PWA, paiement web par Stripe.** Aucune commission Apple. C'est l'avantage clé de l'architecture actuelle.
- **App Store, si tu publies un jour.** Achat intégré dans l'UE : 26 %, ou 15 % avec le Small Business Program. Lien vers un paiement web : 10 à 15 % ([Apple, août 2026](https://www.apple.com/newsroom/2026/08/apple-announces-changes-for-apps-in-the-european-union/)).
- **Paddle** (environ 5 % + 0,50 $, il gère la TVA à ta place) : trop cher sur un petit prix.
- **Lemon Squeezy** : il ferme ([source](https://dodopayments.com/blogs/paddle-vs-lemon-squeezy)). Je recommande **Stripe Billing + Stripe Tax** (ou une déclaration de TVA OSS si tu vends dans d'autres pays de l'UE).

---

## 4. Activités à la carte (perso d'abord, le reste au choix)

### Ce qui coince aujourd'hui
Les activités sont figées dans le code et dans la base (`activite in ('Perso','Freelance','Immobilier')`). Les écrans Freelance et Immobilier sont affichés à tout le monde.

### Modèle cible
1. **Inscription = finances perso uniquement.** Un questionnaire de 30 secondes demande : « Tu as aussi… une activité indépendante ? des biens en location ? un commerce ou une boutique en ligne ? des revenus au Maroc ? »
2. **Une table `activites`.** Chaque ligne a : un type (`perso`, `freelance`, `location`, `commerce`, `association`, `autre`), un nom libre (« Amal 1 », « Ma micro-entreprise », « Boutique Vinted »), une devise, des paramètres propres (part détenue, régime fiscal, date de début), un statut actif ou archivé.
   - On peut en avoir **plusieurs du même type** : 2 biens séparés, une SCI, 2 activités.
3. **Chaque type est un module** qui apporte : son modèle de catégories, ses écrans, ses indicateurs, ses alertes et notifications, ses exports.
   - **Freelance** : factures, seuils micro et TVA, provision URSSAF, jours travaillés.
   - **Location** : lots, locataires, grille des loyers, rendement.
   - **Commerce** (nouveau) : ventes et achats, marge, stock simple, seuils micro-BIC, TVA, plateformes (Vinted, Etsy, Amazon).
   - **Autre** : catégories libres.
4. **Navigation dynamique.** Seuls les modules activés apparaissent, avec un tableau de bord consolidé ou par activité.
5. **Opérations rattachées à une activité.** `tx.activite_id` remplace le texte. Les liens par nom (lot, client…) deviennent des clés étrangères.
6. **Abonnement.** Gratuit = perso + 1 activité limitée ; Pro = illimité. Les droits sont **vérifiés côté serveur**, dans `apply_ops`, pas seulement dans l'interface.

### Espaces partagés : à prévoir dès maintenant
Ton propre cas le montre : tu détiens 67 % d'Amal 1, avec des associés. Les couples gèrent aussi un budget commun. Je recommande de faire porter les données par un **espace** (`workspace_id`) plutôt que par un utilisateur :
- membres avec des rôles (propriétaire, éditeur, lecteur) ;
- RLS fondée sur l'appartenance à l'espace ;
- exemple : l'espace « Amal 1 » est partagé avec les associés, et chacun voit sa quote-part dans son espace perso.

C'est **le chantier technique le plus structurant**. Il est bien plus simple à faire maintenant, avec un seul vrai utilisateur, qu'avec 1 000.

---

## 5. Relier les comptes bancaires

### Comment ça marche
L'utilisateur clique « Connecter ma banque ». Une fenêtre du fournisseur agréé s'ouvre, il s'authentifie auprès de sa banque, puis il revient dans l'appli. Côté serveur (Edge Function, avec les secrets uniquement côté serveur) :
1. on enregistre la connexion ;
2. on récupère comptes, soldes et transactions (une fois par jour, et via des notifications du fournisseur en temps réel) ;
3. on les stocke dans `bank_transactions`, avec l'identifiant du fournisseur unique, pour éviter les doublons ;
4. **un moteur de rapprochement** catégorise la transaction (règles, historique de l'utilisateur, libellés comme aujourd'hui, IA plus tard) et propose « c'est le loyer de X ? la facture F-2027-003 ? » ;
5. la transaction devient une opération, validée automatiquement ou en un clic ;
6. 180 jours plus tard, il faut **renouveler le consentement** ([EBA](https://www.eba.europa.eu/publications-and-media/press-releases/eba-publishes-final-report-amendment-its-technical-standards)). Le système de notifications existant le gère très bien.

Les soldes réels alimentent automatiquement le Patrimoine : plus de relevé manuel.

### Fournisseurs

| Fournisseur | France / UE | Maroc | Prix | Sans licence propre ? |
|---|---|---|---|---|
| **Powens** | Oui | non vérifié | sur devis | **Oui : statut d'agent** sous son agrément ACPR, ou marque blanche ([source](https://www.powens.com/fr/customer-stories/azopio/)) |
| **Bridge** (Bankin') | Très bon en France | non vérifié | sur devis | **Oui : agent**, Bankin' fonctionne ainsi ([source](https://bankin.com/fr/cgu.html)) |
| Tink (Visa) | UE | faible | environ 0,50 €/utilisateur/mois (source tierce) ([source](https://blog.finexer.com/tink-pricing/)) | Oui (Tink est l'agrégateur réglementé visible), pas de marque blanche |
| Enable Banking | 2 700+ banques | Non | par compte et par mois, avec un minimum | Oui ([source](https://enablebanking.com/knowledge-base)) |
| Salt Edge | 50+ pays | certaines banques marocaines ([source](https://www.openbankingtracker.com/providers/country/ma)) | sur devis | non vérifié |
| Yapily | UE | Non | sur devis | Oui (Yapily Connect) |
| GoCardless (ex-Nordigen) | — | — | **fermé aux nouveaux clients depuis 2025** ([source](https://bankaccountdata.gocardless.com/new-signups-disabled)) | — |

**Recommandation.** Demander des devis à **Powens, Bridge et Enable Banking**, et démarrer **comme agent**. L'alternative, s'enregistrer comme prestataire d'information sur les comptes auprès de l'ACPR ([source](https://acpr.banque-france.fr/fr/professionnels/lacpr-vous-accompagne/banque/creer-ma-societe/mes-procedures/etablissement-de-paiement-et-prestataire-de-service-dinformation-sur-les-comptes)), prend plus de temps et suppose une assurance RC et un dispositif de sécurité. Exercer sans statut est un délit (3 ans de prison et 375 000 € d'amende, [source](https://www.swim.legal/blog/agent-prestataire-services-paiement)).

### Maroc
Il n'y a pas encore de cadre d'open banking. Bank Al-Maghrib prépare un déploiement progressif **à partir de 2027** ([source](https://boursenews.ma/article/marches/open-banking-maroc-bam-balise-le-terrain)). En attendant : import de relevés CSV ou PDF (lecture automatique des PDF des principales banques marocaines), saisie rapide, et les automatismes déjà en place (loyers, encaissement en 1 clic).

### Sans fournisseur, dès maintenant (0 €)
**Import de relevés** : CSV, OFX ou QIF, que toutes les banques françaises proposent, avec la même catégorisation et le même rapprochement. Ça couvre environ 80 % de la valeur de la synchro, sans coût ni réglementation. C'est **la première chose que je développerais** pour le lancement payant.

---

## 6. Ce qu'il faut changer pour passer en SaaS

### Technique

| Sujet | Aujourd'hui | Cible |
|---|---|---|
| Propriété des données | `user_id` | `workspace_id` + membres (espaces partagés) |
| Activités | 3 activités figées | Table `activites` + modules activables |
| Abonnements | — | Stripe Checkout + portail client + webhook → table `subscriptions` ; droits vérifiés dans `apply_ops` et la RLS |
| E-mails | SMTP Supabase (équipe seulement, 2 par heure) | **SMTP pro** (Resend, Brevo, Postmark) + domaine + DKIM/SPF/DMARC ([Supabase](https://supabase.com/docs/guides/auth/auth-smtp)) |
| Anti-robots | — | CAPTCHA Cloudflare Turnstile + confirmation de l'e-mail |
| Notifications | Une boucle sur tous les utilisateurs, toutes les heures | File de traitement par lots (pgmq / pg_cron par tranches) au-delà de quelques centaines d'utilisateurs |
| Sauvegardes | Worker gratuit (limites de calcul) | Supabase Pro (sauvegardes quotidiennes, restauration à une date en option) + Cloudflare R2 |
| Hébergement | Supabase Free | **Supabase Pro** (25 $/mois) dès le premier client payant : pas de mise en veille, sauvegardes, support |
| Supervision | — | Sentry (erreurs), page d'état, journal d'audit, limitation des appels |
| Connexion | Code de sécurité obligatoire | À garder, avec en plus les passkeys (Face ID) pour réduire la friction |
| App mobile | PWA | Rester en PWA pour encaisser sans commission. Capacitor pour l'App Store seulement si l'acquisition l'exige |

### Juridique et administratif
- **Société.** Une SASU ou une micro-entreprise suffit au début. Pour un SaaS avec abonnements et TVA, une société au réel est plus adaptée dès que ça décolle (à voir avec un expert-comptable).
- **Ton contrat de travail.** Vérifie les clauses d'exclusivité, de non-concurrence et de propriété intellectuelle, et les règles de cumul d'activité. C'est particulièrement important dans un grand groupe comme LVMH.
- **RGPD.** Registre des traitements, **analyse d'impact (AIPD) très probablement obligatoire** pour des données financières ([CNIL](https://www.cnil.fr/fr/listes-des-traitements-pour-lesquels-une-aipd-est-requise-ou-non)), contrats de sous-traitance avec Supabase, Cloudflare et Stripe, hébergement dans l'UE (déjà le cas), droit à l'effacement (déjà fait).
- **CGU/CGV grand public.** Prix TTC, droit de rétractation, **résiliation en ligne en 3 clics** (obligation légale), mentions légales, politique de confidentialité.
- **Conseil financier.** Le statut CIF/ORIAS ne s'applique que si tu recommandes des produits financiers précis ([AMF](https://www.amf-france.org/sites/institutionnel/files/private/2026-07/DOC-2006-23_VF8_QR%20relatives%20au%20r%C3%A9gime%20applicable%20aux%20CIF_0.pdf)). Budget, alertes et seuils n'en relèvent pas : **ne jamais dire « achète tel ETF »**.
- **Gestion locative.** Un outil d'autogestion pour bailleurs ne relève pas de la loi Hoguet.

### Coûts fixes estimés au lancement
- **Hébergement** : Supabase Pro 25 $/mois + domaine environ 15 €/an.
- **E-mails** : SMTP gratuit jusqu'à quelques milliers par mois.
- **Juridique** : CGU/CGV et confidentialité, environ 1 000 à 2 000 € en une fois chez un avocat (ou modèles + relecture).
- **Synchro bancaire, plus tard** : minimum de 150 à 500 £/mois, soit **environ 60 à 80 abonnés Pro pour l'amortir**.

---

## 7. Feuille de route proposée

| Phase | Durée indicative | Contenu | Objectif |
|---|---|---|---|
| **0. Fondations SaaS** | 3-4 semaines | Espaces partagés, activités à la carte, questionnaire d'accueil, SMTP + domaine + CAPTCHA, CGU et confidentialité, Supabase Pro | Une appli « grand public » |
| **1. Import de relevés + abonnement** | 2-3 semaines | Import CSV/OFX/PDF avec rapprochement, Stripe (Gratuit / Essentiel / Pro), essai 30 jours, page de vente | Premiers revenus, sans coût d'agrégation |
| **2. Bêta privée** | 1-2 mois | 30 à 50 testeurs (MRE, freelances, bailleurs), tarif fondateurs, entretiens | Valider le consentement à payer et le positionnement |
| **3. Synchro bancaire** | 1-2 mois | Statut d'agent Powens ou Bridge, connexion, rapprochement automatique, renouvellement à 180 jours | Rendre l'offre Essentiel pertinente |
| **4. Module Commerce + IA** | continu | Ventes et marge, catégorisation intelligente, prévisions de trésorerie, résumé mensuel | Se différencier |
| **5. Maroc et mobile natif** | 2027 | Open banking marocain quand il sera disponible, App Store via Capacitor si utile | Élargir |

## 8. Ce qui rendra l'application vraiment plus forte (avis personnel)
1. **La niche avant le grand public.** « La seule appli qui gère ton salaire en France, ta micro-entreprise et ton appartement loué au Maroc, en euros et en dirhams » se vend en une phrase. « Une appli de budget de plus », non.
2. **Le temps gagné plutôt que les graphiques.** Ce qui fait payer : encaissement des loyers en 1 clic, facture préremplie en fin de mois, rappel URSSAF, provision d'impôt calculée. C'est déjà là : il faut le mettre en avant.
3. **Confiance et sécurité, visibles.** Code de sécurité, chiffrement, hébergement UE, export et suppression en 1 clic. Pour des données financières, c'est un argument de vente, pas une contrainte.
4. **L'abonnement annuel par défaut**, avec essai long. Le mensuel coûte plus en frais fixes et se résilie plus vite.
5. **Pas de dépendance prématurée à la synchro bancaire.** Elle coûte cher, elle est réglementée, elle impose un renouvellement tous les 180 jours. Bien fait, l'import de relevés suffit pour valider le marché.
6. **Le chantier « espaces » d'abord.** C'est la décision d'architecture qu'on regrette le plus quand elle arrive trop tard.
