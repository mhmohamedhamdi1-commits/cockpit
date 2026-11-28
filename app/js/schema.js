// Description unique des tables : sert à l'adaptateur base <-> interface, à l'export / import Excel
// et au script de migration. k = clé côté interface, db = colonne en base (si différente),
// x = en-tête Excel, t = type (date | money | rate | int | text), w = largeur de colonne Excel.

export const TABLES = [
  { key: 'projets', entity: 'projet', sheet: 'Projets', tbl: 'tblProjets', id: true, cols: [
    { k: 'nom', x: 'Projet', w: 28 }, { k: 'type', x: 'Type', w: 14 }, { k: 'part', x: 'Ma part', t: 'rate', w: 10 },
    { k: 'devise', x: 'Devise', w: 8 }, { k: 'note', x: 'Note', w: 40 }, { k: 'meta', x: 'Paramètres (JSON)', t: 'json', w: 40 }] },
  { key: 'tx', entity: 'tx', sheet: 'Transactions', tbl: 'tblTransactions', id: true, cols: [
    { k: 'date', x: 'Date', t: 'date', w: 12 }, { k: 'activite', x: 'Activité', w: 12 }, { k: 'sens', x: 'Sens', w: 9 },
    { k: 'categorie', x: 'Catégorie', w: 24 }, { k: 'detail', x: 'Détail', w: 18 }, { k: 'libelle', x: 'Libellé', w: 34 },
    { k: 'montant', x: 'Montant', t: 'money', w: 13 }, { k: 'devise', x: 'Devise', w: 8 }, { k: 'taux', x: 'Taux vers EUR', t: 'rate', w: 13 },
    { k: 'montantEur', db: 'montant_eur', x: 'Montant EUR', t: 'money', w: 13 }, { k: 'nature', x: 'Nature', w: 14 },
    { k: 'tiers', x: 'Tiers', w: 22 }, { k: 'lot', x: 'Lot', w: 28 }, { k: 'periode', x: 'Période', w: 10 },
    { k: 'ref', x: 'Réf', w: 14 }, { k: 'note', x: 'Note', w: 30 }, { k: 'projetId', db: 'projet_id', x: 'Projet (ID)', t: 'uuid', w: 38 }] },
  { key: 'categories', entity: 'category', sheet: 'Catégories', tbl: 'tblCategories', id: false, cols: [
    { k: 'activite', x: 'Activité', w: 12 }, { k: 'sens', x: 'Sens', w: 9 }, { k: 'categorie', x: 'Catégorie', w: 28 },
    { k: 'groupe', x: 'Groupe', w: 26 }, { k: 'nature', x: 'Nature par défaut', w: 18 }, { k: 'icone', x: 'Icône', w: 8 }] },
  { key: 'lots', entity: 'lot', sheet: 'Lots', tbl: 'tblLots', id: true, cols: [
    { k: 'code', x: 'Code', w: 8 }, { k: 'nom', x: 'Nom du lot', w: 32 }, { k: 'loyer', x: 'Loyer de référence (MAD)', t: 'money', w: 24 }, { k: 'projetId', db: 'projet_id', x: 'Projet (ID)', t: 'uuid', w: 38 }] },
  { key: 'tenants', entity: 'tenant', sheet: 'Locataires', tbl: 'tblLocataires', id: true, cols: [
    { k: 'lot', x: 'Lot', w: 30 }, { k: 'nom', x: 'Locataire', w: 26 }, { k: 'loyer', x: 'Loyer (MAD)', t: 'money', w: 12 },
    { k: 'charges', x: 'Charges forfait (MAD)', t: 'money', w: 20 }, { k: 'entree', x: 'Date entrée', t: 'date', w: 13 },
    { k: 'sortie', x: 'Date sortie', t: 'date', w: 13 }, { k: 'caution', x: 'Caution (MAD)', t: 'money', w: 14 },
    { k: 'contact', x: 'Contact', w: 18 }, { k: 'metier', x: 'Métier', w: 24 }, { k: 'note', x: 'Note', w: 40 }, { k: 'projetId', db: 'projet_id', x: 'Projet (ID)', t: 'uuid', w: 38 }] },
  { key: 'clients', entity: 'client', sheet: 'Clients', tbl: 'tblClients', id: true, cols: [
    { k: 'nom', x: 'Client', w: 28 }, { k: 'devise', x: 'Devise', w: 8 }, { k: 'tjm', x: 'TJM', t: 'money', w: 10 },
    { k: 'tva', x: 'TVA', t: 'rate', w: 8 }, { k: 'micro', x: 'Compte dans la micro (Oui/Non)', w: 28 }, { k: 'note', x: 'Note', w: 30 }, { k: 'projetId', db: 'projet_id', x: 'Entreprise (ID)', t: 'uuid', w: 38 }] },
  { key: 'invoices', entity: 'invoice', sheet: 'Factures', tbl: 'tblFactures', id: true, cols: [
    { k: 'numero', x: 'N° facture', w: 13 }, { k: 'client', x: 'Client', w: 26 }, { k: 'periode', x: 'Période', w: 10 },
    { k: 'jours', x: 'Jours', t: 'money', w: 8 }, { k: 'tjm', x: 'TJM', t: 'money', w: 10 }, { k: 'devise', x: 'Devise', w: 8 },
    { k: 'ht', x: 'Montant HT', t: 'money', w: 14 }, { k: 'tva', x: 'TVA', t: 'rate', w: 8 }, { k: 'ttc', x: 'Montant TTC', t: 'money', w: 14 },
    { k: 'emission', x: 'Date facture', t: 'date', w: 13 }, { k: 'statut', x: 'Statut', w: 12 },
    { k: 'paiement', x: 'Date paiement', t: 'date', w: 14 }, { k: 'note', x: 'Note', w: 30 },
    { k: 'projetId', db: 'projet_id', x: 'Entreprise (ID)', t: 'uuid', w: 38 }, { k: 'refExt', db: 'ref_ext', x: 'Réf. plateforme de facturation', w: 26 }, { k: 'echeance', x: 'Échéance de paiement', t: 'date', w: 16 }] },
  { key: 'recurring', entity: 'recurring', sheet: 'Récurrents', tbl: 'tblRecurrents', id: true, cols: [
    { k: 'libelle', x: 'Libellé', w: 30 }, { k: 'activite', x: 'Activité', w: 12 }, { k: 'sens', x: 'Sens', w: 9 },
    { k: 'categorie', x: 'Catégorie', w: 24 }, { k: 'montant', x: 'Montant', t: 'money', w: 12 }, { k: 'devise', x: 'Devise', w: 8 },
    { k: 'jour', x: 'Jour du mois', t: 'int', w: 12 }, { k: 'debut', x: 'Début', t: 'date', w: 12 }, { k: 'fin', x: 'Fin', t: 'date', w: 12 },
    { k: 'actif', x: 'Actif (Oui/Non)', w: 14 }, { k: 'nature', x: 'Nature', w: 14 }, { k: 'tiers', x: 'Tiers', w: 20 }, { k: 'lot', x: 'Lot', w: 24 }, { k: 'projetId', db: 'projet_id', x: 'Projet (ID)', t: 'uuid', w: 38 }] },
  { key: 'accounts', entity: 'account', sheet: 'Comptes', tbl: 'tblComptes', id: true, cols: [
    { k: 'nom', x: 'Compte', w: 30 }, { k: 'devise', x: 'Devise', w: 8 }, { k: 'dispo', x: 'Disponible (Oui/Non)', w: 20 },
    { k: 'ordre', x: 'Ordre', t: 'int', w: 8 }] },
  { key: 'snapshots', entity: 'snapshot', sheet: 'Relevés', tbl: 'tblReleves', id: true, cols: [
    { k: 'date', x: 'Date', t: 'date', w: 12 }, { k: 'compte', x: 'Compte', w: 30 }, { k: 'solde', x: 'Solde', t: 'money', w: 14 },
    { k: 'devise', x: 'Devise', w: 8 }, { k: 'soldeEur', db: 'solde_eur', x: 'Solde EUR', t: 'money', w: 14 }] },
  { key: 'params', entity: 'param', sheet: 'Paramètres', tbl: 'tblParametres', id: false, cols: [
    { k: 'cle', x: 'Paramètre', w: 22 }, { k: 'valeur', x: 'Valeur', w: 16 }, { k: 'libelle', x: 'Description', w: 60 }] },
  { key: 'ordres', entity: 'ordre', sheet: 'Bourse', tbl: 'tblBourse', id: true, cols: [
    { k: 'date', x: 'Date', t: 'date', w: 12 }, { k: 'symbole', x: 'Symbole', w: 12 }, { k: 'nom', x: 'Titre', w: 30 }, { k: 'type', x: 'Type', w: 10 },
    { k: 'compte', x: 'Compte', w: 12 }, { k: 'sens', x: 'Sens', w: 10 }, { k: 'quantite', x: 'Quantité', t: 'rate', w: 12 },
    { k: 'prix', x: 'Prix unitaire', t: 'rate', w: 14 }, { k: 'frais', x: 'Frais', t: 'money', w: 10 }, { k: 'devise', x: 'Devise', w: 8 }, { k: 'note', x: 'Note', w: 30 }, { k: 'secteur', x: 'Secteur', w: 22 }] },
  { key: 'rappels', entity: 'rappel', sheet: 'Rappels', tbl: 'tblRappels', id: true, cols: [
    { k: 'titre', x: 'Rappel', w: 36 }, { k: 'categorie', x: 'Catégorie', w: 14 }, { k: 'frequence', x: 'Fréquence', w: 13 },
    { k: 'date', x: 'Échéance', t: 'date', w: 13 }, { k: 'avance', x: 'Prévenir (jours avant)', t: 'int', w: 20 },
    { k: 'actif', x: 'Actif (Oui/Non)', w: 14 }, { k: 'note', x: 'Note', w: 40 }] },
  { key: 'import_lignes', entity: 'ligne', sheet: 'Opérations importées', tbl: 'tblImports', id: true, cols: [
    { k: 'date', x: 'Date', t: 'date', w: 12 }, { k: 'libelle', x: 'Libellé', w: 40 }, { k: 'montant', x: 'Montant (signé)', t: 'money', w: 14 },
    { k: 'devise', x: 'Devise', w: 8 }, { k: 'solde', x: 'Solde', t: 'money', w: 14 }, { k: 'typeOp', db: 'type_op', x: 'Type', w: 16 },
    { k: 'source', x: 'Source', w: 12 }, { k: 'compte', x: 'Compte', w: 16 }, { k: 'statut', x: 'Statut', w: 10 }, { k: 'activite', x: 'Activité', w: 12 },
    { k: 'categorie', x: 'Catégorie', w: 24 }, { k: 'detail', x: 'Détail', w: 18 }, { k: 'nature', x: 'Nature', w: 14 },
    { k: 'projetId', db: 'projet_id', x: 'Projet (ID)', t: 'uuid', w: 38 }, { k: 'hash', x: 'Empreinte', w: 30 }, { k: 'txRef', db: 'tx_ref', x: 'Réf. opération', w: 20 }, { k: 'note', x: 'Note', w: 30 }] },
  { key: 'objectifs', entity: 'objectif', sheet: 'Objectifs', tbl: 'tblObjectifs', id: true, cols: [
    { k: 'nom', x: 'Objectif', w: 30 }, { k: 'type', x: 'Type', w: 14 }, { k: 'cible', x: 'Cible', t: 'money', w: 16 }, { k: 'devise', x: 'Devise', w: 8 },
    { k: 'echeance', x: 'Échéance', t: 'date', w: 13 }, { k: 'depart', x: 'Valeur de départ', t: 'money', w: 16 }, { k: 'mensuel', x: 'Versement mensuel', t: 'money', w: 16 },
    { k: 'rendement', x: 'Rendement annuel', t: 'rate', w: 16 }, { k: 'actif', x: 'Actif (Oui/Non)', w: 14 }, { k: 'note', x: 'Note', w: 30 }] },
  { key: 'fiscal', entity: 'fiscal', sheet: 'Impôt', tbl: 'tblImpot', id: true, cols: [
    { k: 'annee', x: 'Année des revenus', t: 'int', w: 16 }, { k: 'data', x: 'Données (JSON)', t: 'json', w: 60 }] },
  { key: 'declarations', entity: 'declaration', sheet: 'Déclarations', tbl: 'tblDeclarations', id: true, cols: [
    { k: 'projetId', db: 'projet_id', x: 'Entreprise (ID)', t: 'uuid', w: 38 }, { k: 'code', x: 'Code', w: 16 }, { k: 'periode', x: 'Période', w: 12 },
    { k: 'statut', x: 'Statut', w: 10 }, { k: 'date', x: 'Date', t: 'date', w: 13 }, { k: 'montant', x: 'Montant', t: 'money', w: 14 }, { k: 'note', x: 'Note', w: 30 }] },
];

export const BY_KEY = Object.fromEntries(TABLES.map((t) => [t.key, t]));
export const BY_ENTITY = Object.fromEntries(TABLES.map((t) => [t.entity, t]));
export const dbCol = (c) => c.db || c.k;
export function safeJson(v) { try { const j = JSON.parse(v); return j && typeof j === 'object' ? j : {}; } catch { return {}; } }
const isNum = (c) => c.t === 'money' || c.t === 'rate' || c.t === 'int';

// Ligne venant de la base -> objet attendu par l'interface (chaînes vides plutôt que null, nombres en Number)
export function fromDb(def, r) {
  const o = { id: r.id, seq: r.seq, version: r.version, uid: r.user_id };
  for (const c of def.cols) {
    const v = r[dbCol(c)];
    if (c.t === 'json') { o[c.k] = typeof v === 'string' ? safeJson(v) : (v && typeof v === 'object' ? v : {}); continue; }
    o[c.k] = isNum(c) ? (v == null ? 0 : Number(v)) : (v == null ? '' : String(v).slice(0, c.t === 'date' ? 10 : undefined));
  }
  return o;
}

// Objet de l'interface -> ligne pour la base (seules les clés présentes sont transmises)
export function toDb(def, o) {
  const r = {};
  if (o.id) r.id = o.id;
  if (o.version) r.version = o.version;
  for (const c of def.cols) {
    if (!(c.k in o)) continue;
    let v = o[c.k];
    if (c.t === 'json') { r[dbCol(c)] = typeof v === 'string' ? safeJson(v) : (v && typeof v === 'object' ? v : {}); continue; }
    if (isNum(c)) { v = v === '' || v == null ? 0 : Number(String(v).replace(',', '.')); if (!isFinite(v)) v = 0; if (c.t === 'int') v = Math.round(v); }
    else if (c.t === 'date' || c.t === 'uuid') v = v ? String(v).slice(0, c.t === 'date' ? 10 : 36) : null;
    else v = v == null ? '' : String(v);
    r[dbCol(c)] = v;
  }
  return r;
}

export const DEFAULT_PARAMS = [
  ['taux_mad_eur', '0.093', 'Taux de change : 1 MAD = x EUR (sert à convertir les opérations en MAD)'],
  ['part_immo', '0.67', 'Ma part des biens immobiliers suivis, entre 0 et 1'],
  ['micro_debut', '2027-01-01', 'Début de la micro-entreprise : seuls les CA à partir de cette date comptent pour les plafonds (le 1er exercice est proratisé au nombre de jours)'],
  ['seuil_micro', '83600', 'Plafond de CA annuel HT du régime micro-BNC (2026-2028)'],
  ['seuil_tva', '37500', 'Seuil de franchise en base de TVA (prestations de services)'],
  ['seuil_tva_maj', '41250', 'Seuil majoré de TVA (TVA due immédiatement au-delà)'],
  ['taux_cotis', '0.256', 'Cotisations sociales micro-BNC (% du CA encaissé)'],
  ['taux_cfp', '0.002', 'Contribution à la formation professionnelle (% du CA)'],
  ['taux_provision', '0.40', 'Part de chaque encaissement de l’entreprise à mettre de côté (cotisations + impôt) — estimation à valider avec un expert-comptable'],
  ['nom', 'Mohamed', 'Prénom affiché dans l\'application'],
  ['taux_auto', 'Oui', 'Mettre à jour automatiquement le taux MAD/EUR chaque jour (taux réel du marché)'],
  // Notifications
  ['notif_heure', '8', 'Heure (Paris) du point du matin envoyé sur tes appareils'],
  ['notif_factures', 'Oui', 'Notifier les factures en retard de paiement et à envoyer'],
  ['notif_jours', 'Oui', 'Demander les jours travaillés le dernier jour ouvré du mois (17 h)'],
  ['notif_loyers', 'Oui', 'Notifier les loyers en retard et à encaisser'],
  ['notif_loyer_jour', '5', 'Jour du mois à partir duquel un loyer non reçu est considéré en retard'],
  ['notif_saisie', 'Oui', 'Rappeler de saisir les dépenses / revenus si rien n\'a été saisi récemment (20 h)'],
  ['notif_saisie_jours', '3', 'Nombre de jours sans saisie avant le rappel'],
  ['notif_recurrents', 'Oui', 'Notifier les opérations récurrentes à générer'],
  ['notif_releve', 'Oui', 'Rappeler le relevé de soldes en fin de mois'],
  ['notif_echeances', 'Oui', 'Notifier les échéances (onglet Rappels : URSSAF, impôts, CFE…)'],
  ['notif_provision', 'Oui', 'À chaque facture payée, rappeler le montant à mettre de côté'],
  ['notif_elec', 'Oui', 'Rappeler de payer la facture d\'électricité du 1er au 3 de chaque mois'],
  ['notif_elec_debut', '1', 'Premier jour du mois du rappel d\'électricité'],
  ['notif_elec_fin', '3', 'Dernier jour du mois du rappel d\'électricité'],
  ['notif_imports', 'Oui', 'Rappeler les opérations importées en attente de validation'],
  ['notif_declarations', 'Oui', 'Rappeler les échéances de déclaration et de paiement des entreprises'],
];
