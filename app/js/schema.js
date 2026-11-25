// Description unique des tables : sert à l'adaptateur base <-> interface, à l'export / import Excel
// et au script de migration. k = clé côté interface, db = colonne en base (si différente),
// x = en-tête Excel, t = type (date | money | rate | int | text), w = largeur de colonne Excel.

export const TABLES = [
  { key: 'tx', entity: 'tx', sheet: 'Transactions', tbl: 'tblTransactions', id: true, cols: [
    { k: 'date', x: 'Date', t: 'date', w: 12 }, { k: 'activite', x: 'Activité', w: 12 }, { k: 'sens', x: 'Sens', w: 9 },
    { k: 'categorie', x: 'Catégorie', w: 24 }, { k: 'detail', x: 'Détail', w: 18 }, { k: 'libelle', x: 'Libellé', w: 34 },
    { k: 'montant', x: 'Montant', t: 'money', w: 13 }, { k: 'devise', x: 'Devise', w: 8 }, { k: 'taux', x: 'Taux vers EUR', t: 'rate', w: 13 },
    { k: 'montantEur', db: 'montant_eur', x: 'Montant EUR', t: 'money', w: 13 }, { k: 'nature', x: 'Nature', w: 14 },
    { k: 'tiers', x: 'Tiers', w: 22 }, { k: 'lot', x: 'Lot', w: 28 }, { k: 'periode', x: 'Période', w: 10 },
    { k: 'ref', x: 'Réf', w: 14 }, { k: 'note', x: 'Note', w: 30 }] },
  { key: 'categories', entity: 'category', sheet: 'Catégories', tbl: 'tblCategories', id: false, cols: [
    { k: 'activite', x: 'Activité', w: 12 }, { k: 'sens', x: 'Sens', w: 9 }, { k: 'categorie', x: 'Catégorie', w: 28 },
    { k: 'groupe', x: 'Groupe', w: 26 }, { k: 'nature', x: 'Nature par défaut', w: 18 }, { k: 'icone', x: 'Icône', w: 8 }] },
  { key: 'lots', entity: 'lot', sheet: 'Lots', tbl: 'tblLots', id: true, cols: [
    { k: 'code', x: 'Code', w: 8 }, { k: 'nom', x: 'Nom du lot', w: 32 }, { k: 'loyer', x: 'Loyer de référence (MAD)', t: 'money', w: 24 }] },
  { key: 'tenants', entity: 'tenant', sheet: 'Locataires', tbl: 'tblLocataires', id: true, cols: [
    { k: 'lot', x: 'Lot', w: 30 }, { k: 'nom', x: 'Locataire', w: 26 }, { k: 'loyer', x: 'Loyer (MAD)', t: 'money', w: 12 },
    { k: 'charges', x: 'Charges forfait (MAD)', t: 'money', w: 20 }, { k: 'entree', x: 'Date entrée', t: 'date', w: 13 },
    { k: 'sortie', x: 'Date sortie', t: 'date', w: 13 }, { k: 'caution', x: 'Caution (MAD)', t: 'money', w: 14 },
    { k: 'contact', x: 'Contact', w: 18 }, { k: 'metier', x: 'Métier', w: 24 }, { k: 'note', x: 'Note', w: 40 }] },
  { key: 'clients', entity: 'client', sheet: 'Clients', tbl: 'tblClients', id: true, cols: [
    { k: 'nom', x: 'Client', w: 28 }, { k: 'devise', x: 'Devise', w: 8 }, { k: 'tjm', x: 'TJM', t: 'money', w: 10 },
    { k: 'tva', x: 'TVA', t: 'rate', w: 8 }, { k: 'micro', x: 'Compte dans la micro (Oui/Non)', w: 28 }, { k: 'note', x: 'Note', w: 30 }] },
  { key: 'invoices', entity: 'invoice', sheet: 'Factures', tbl: 'tblFactures', id: true, cols: [
    { k: 'numero', x: 'N° facture', w: 13 }, { k: 'client', x: 'Client', w: 26 }, { k: 'periode', x: 'Période', w: 10 },
    { k: 'jours', x: 'Jours', t: 'money', w: 8 }, { k: 'tjm', x: 'TJM', t: 'money', w: 10 }, { k: 'devise', x: 'Devise', w: 8 },
    { k: 'ht', x: 'Montant HT', t: 'money', w: 14 }, { k: 'tva', x: 'TVA', t: 'rate', w: 8 }, { k: 'ttc', x: 'Montant TTC', t: 'money', w: 14 },
    { k: 'emission', x: 'Date facture', t: 'date', w: 13 }, { k: 'statut', x: 'Statut', w: 12 },
    { k: 'paiement', x: 'Date paiement', t: 'date', w: 14 }, { k: 'note', x: 'Note', w: 30 }] },
  { key: 'recurring', entity: 'recurring', sheet: 'Récurrents', tbl: 'tblRecurrents', id: true, cols: [
    { k: 'libelle', x: 'Libellé', w: 30 }, { k: 'activite', x: 'Activité', w: 12 }, { k: 'sens', x: 'Sens', w: 9 },
    { k: 'categorie', x: 'Catégorie', w: 24 }, { k: 'montant', x: 'Montant', t: 'money', w: 12 }, { k: 'devise', x: 'Devise', w: 8 },
    { k: 'jour', x: 'Jour du mois', t: 'int', w: 12 }, { k: 'debut', x: 'Début', t: 'date', w: 12 }, { k: 'fin', x: 'Fin', t: 'date', w: 12 },
    { k: 'actif', x: 'Actif (Oui/Non)', w: 14 }, { k: 'nature', x: 'Nature', w: 14 }, { k: 'tiers', x: 'Tiers', w: 20 }, { k: 'lot', x: 'Lot', w: 24 }] },
  { key: 'accounts', entity: 'account', sheet: 'Comptes', tbl: 'tblComptes', id: true, cols: [
    { k: 'nom', x: 'Compte', w: 30 }, { k: 'devise', x: 'Devise', w: 8 }, { k: 'dispo', x: 'Disponible (Oui/Non)', w: 20 },
    { k: 'ordre', x: 'Ordre', t: 'int', w: 8 }] },
  { key: 'snapshots', entity: 'snapshot', sheet: 'Relevés', tbl: 'tblReleves', id: true, cols: [
    { k: 'date', x: 'Date', t: 'date', w: 12 }, { k: 'compte', x: 'Compte', w: 30 }, { k: 'solde', x: 'Solde', t: 'money', w: 14 },
    { k: 'devise', x: 'Devise', w: 8 }, { k: 'soldeEur', db: 'solde_eur', x: 'Solde EUR', t: 'money', w: 14 }] },
  { key: 'params', entity: 'param', sheet: 'Paramètres', tbl: 'tblParametres', id: false, cols: [
    { k: 'cle', x: 'Paramètre', w: 22 }, { k: 'valeur', x: 'Valeur', w: 16 }, { k: 'libelle', x: 'Description', w: 60 }] },
  { key: 'rappels', entity: 'rappel', sheet: 'Rappels', tbl: 'tblRappels', id: true, cols: [
    { k: 'titre', x: 'Rappel', w: 36 }, { k: 'categorie', x: 'Catégorie', w: 14 }, { k: 'frequence', x: 'Fréquence', w: 13 },
    { k: 'date', x: 'Échéance', t: 'date', w: 13 }, { k: 'avance', x: 'Prévenir (jours avant)', t: 'int', w: 20 },
    { k: 'actif', x: 'Actif (Oui/Non)', w: 14 }, { k: 'note', x: 'Note', w: 40 }] },
];

export const BY_KEY = Object.fromEntries(TABLES.map((t) => [t.key, t]));
export const BY_ENTITY = Object.fromEntries(TABLES.map((t) => [t.entity, t]));
export const dbCol = (c) => c.db || c.k;
const isNum = (c) => c.t === 'money' || c.t === 'rate' || c.t === 'int';

// Ligne venant de la base -> objet attendu par l'interface (chaînes vides plutôt que null, nombres en Number)
export function fromDb(def, r) {
  const o = { id: r.id, seq: r.seq, version: r.version };
  for (const c of def.cols) {
    const v = r[dbCol(c)];
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
    if (isNum(c)) { v = v === '' || v == null ? 0 : Number(String(v).replace(',', '.')); if (!isFinite(v)) v = 0; if (c.t === 'int') v = Math.round(v); }
    else if (c.t === 'date') v = v ? String(v).slice(0, 10) : null;
    else v = v == null ? '' : String(v);
    r[dbCol(c)] = v;
  }
  return r;
}

export const DEFAULT_PARAMS = [
  ['taux_mad_eur', '0.093', 'Taux de change : 1 MAD = x EUR (sert à convertir les opérations en MAD)'],
  ['part_immo', '0.67', 'Ma part du projet immobilier (Amal 1), entre 0 et 1'],
  ['micro_debut', '2027-01-01', 'Début de la micro-entreprise : seuls les CA à partir de cette date comptent pour les plafonds (le 1er exercice est proratisé au nombre de jours)'],
  ['seuil_micro', '83600', 'Plafond de CA annuel HT du régime micro-BNC (2026-2028)'],
  ['seuil_tva', '37500', 'Seuil de franchise en base de TVA (prestations de services)'],
  ['seuil_tva_maj', '41250', 'Seuil majoré de TVA (TVA due immédiatement au-delà)'],
  ['taux_cotis', '0.256', 'Cotisations sociales micro-BNC (% du CA encaissé)'],
  ['taux_cfp', '0.002', 'Contribution à la formation professionnelle (% du CA)'],
  ['taux_provision', '0.40', 'Part de chaque encaissement freelance à mettre de côté (cotisations + impôt) — estimation à valider avec un expert-comptable'],
  ['nom', 'Mohamed', 'Prénom affiché dans l\'application'],
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
];
