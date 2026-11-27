// Jeu de données de démonstration pour les tests d'interface (aucune base réelle).
//   • Immobilier : si la sauvegarde locale backups/avant-fusion-amal1-*.json existe (privée, ignorée par git), on l'utilise ;
//     sinon un immeuble fictif de 8 lots.
//   • Perso, entreprise, comptes, bourse : données fictives déterministes.
// Format : lignes « base de données » (colonnes snake_case) prêtes à servir par une fausse API Supabase.
import fs from 'node:fs';
import path from 'node:path';

export const UID = '2b2c1079-0000-4000-8000-000000000001';
export const PROJET_IMMO = 'dce766d6-a5f2-48ee-b919-6d283c0babbf';
export const PROJET_ENT = '7a1e0000-0000-4000-8000-0000000000e1';
const now = new Date().toISOString();
let seq = 1;
let rnd = 42;
const rand = () => { rnd = (rnd * 1664525 + 1013904223) % 4294967296; return rnd / 4294967296; };
const id = () => crypto.randomUUID();
const row = (o) => ({ id: id(), seq: seq++, legacy_id: null, version: 1, created_at: now, updated_at: now, deleted_at: null, ...o, user_id: UID });
const pad = (n) => String(n).padStart(2, '0');
const today = new Date();
const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const addM = (k, n) => { const y = +k.slice(0, 4), m = +k.slice(5, 7) - 1 + n; return `${y + Math.floor(m / 12)}-${pad(((m % 12) + 12) % 12 + 1)}`; };

const CATS = [
  ['Perso', 'Dépense', 'Logement', 'Courant', ['🏠|Loyer', '💡|Charges']], ['Perso', 'Dépense', 'Alimentation', 'Courant', ['🛒|Courses', '🍴|Restaurant']],
  ['Perso', 'Dépense', 'Mobilité', 'Courant', ['⛽|Carburant', '🚇|Transports en Commun']], ['Perso', 'Dépense', 'Shopping & Loisirs', 'Courant', ['🎬|Loisirs & Divertissements', '👕|Vêtements']],
  ['Perso', 'Dépense', 'Télécoms & abonnements', 'Courant', ['📱|Mobile', '💻|Abonnements Numériques']], ['Perso', 'Dépense', 'Impôts & frais admin', 'Courant', ['🏛️|Impôts', '🏛️|Impôt sur le revenu', '🏦|Frais Bancaires']],
  ['Perso', 'Dépense', 'Investissements', 'Investissement', ['📈|La bourse']], ['Perso', 'Dépense', 'Autres', 'Courant', ['❓|Autres', '🔁|Virement émis']],
  ['Perso', 'Revenu', 'Revenus', 'Courant', ['💶|Salaire & primes', '📈|Revenu boursier', '🏢|Dividendes', '🔁|Virement reçu', '➕|Autres']],
  ['Entreprise', 'Revenu', 'Revenus', 'Courant', ['🧾|Prestations']], ['Entreprise', 'Revenu', 'Financement', 'Financement', ['🧾|TVA collectée', '💰|Apport en compte courant']],
  ['Entreprise', 'Dépense', 'Charges', 'Courant', ['🏛️|Cotisations URSSAF', '🏛️|CFE & taxes', '💻|Logiciels & abonnements', '📒|Comptable & banque', '🚆|Déplacements pro', '➖|Autres frais pro']],
  ['Entreprise', 'Dépense', 'Financement', 'Financement', ['🧾|TVA reversée', '💸|Dividendes versés']],
  ['Immobilier', 'Revenu', 'Revenus', 'Courant', ['🏠|Loyer', '💡|Charges refacturées']], ['Immobilier', 'Revenu', 'Financement', 'Financement', ['💰|Apport en capital', '🤝|Prêt reçu', '🔑|Caution reçue']],
  ['Immobilier', 'Revenu', 'Investissement', 'Investissement', ['🔁|Remboursement travaux']],
  ['Immobilier', 'Dépense', 'Exploitation', 'Courant', ['💡|Eau & électricité', '🧹|Ménage', '🔧|Entretien & bricolage', '🧑‍💼|Agence & commissions', '🧾|Taxes', '🏦|Frais bancaires', '🚗|Déplacements', '📄|Administratif']],
  ['Immobilier', 'Dépense', 'Investissement', 'Investissement', ['🧱|Travaux', '🏢|Acquisition']],
  ['Immobilier', 'Dépense', 'Financement', 'Financement', ['🤝|Remboursement prêt', '🔑|Restitution caution', '💸|Distribution aux associés']],
];
const PARAMS = { nom: 'Mohamed', taux_mad_eur: '0.0913', taux_auto: 'Oui', part_immo: '0.67', micro_debut: '2027-01-01', seuil_micro: '83600', seuil_tva: '37500', seuil_tva_maj: '41250', taux_cotis: '0.256', taux_cfp: '0.002', taux_provision: '0.4' };

export function loadBackupImmo() {
  const dir = path.resolve(new URL('../backups', import.meta.url).pathname);
  try {
    const f = fs.readdirSync(dir).filter((x) => x.startsWith('avant-fusion-amal1')).sort().pop();
    if (!f) return null;
    return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))[0].b;
  } catch { return null; }
}

export function buildMockDb({ withBackup = true } = {}) {
  seq = 1; rnd = 42;
  const db = {};
  const back = withBackup ? loadBackupImmo() : null;
  // ---- immobilier
  db.projets = [row({ id: PROJET_IMMO, nom: 'Amal 1', type: 'Immobilier', part: 0.67, devise: 'MAD', note: 'Immeuble — 8 appartements', meta: {} }),
    row({ id: PROJET_ENT, nom: 'Micro-entreprise', type: 'Entreprise', part: 1, devise: 'EUR', note: '', meta: { forme: 'micro_bnc', date_debut: '2027-01-01' } })];
  if (back) {
    db.lots = back.lots.filter((l) => !l.deleted_at).map((l) => row({ ...l, id: l.id, projet_id: PROJET_IMMO }));
    db.tenants = back.tenants.filter((t) => !t.deleted_at).map((t) => row({ ...t, projet_id: PROJET_IMMO }));
    db.tx = back.tx_immo.filter((t) => !t.deleted_at).map((t) => row({ ...t, projet_id: PROJET_IMMO }));
  } else {
    const names = ['00. RDC Appart', '11. 1er étage (Côté Rue)', '12. 1er étage (côté intérieur)', '21. 2eme étage (Côté Rue)', '22. 2eme étage (côté intérieur)', '31. 3eme étage (Côté Rue)', '32. 3eme étage (côté intérieur)', '41. 4eme étage'];
    db.lots = names.map((nom) => row({ code: nom.slice(0, 2), nom, loyer: 1900, projet_id: PROJET_IMMO }));
    db.tenants = names.map((lot, i) => row({ lot, nom: `Locataire ${i + 1}`, loyer: 1900, charges: 150, entree: '2024-06-01', sortie: null, caution: 1900, contact: i % 2 ? '+212620117815' : '', metier: '', note: '', projet_id: PROJET_IMMO }));
    db.tx = [];
    for (let m = '2024-06'; m <= ym(today); m = addM(m, 1)) {
      for (const [i, t] of db.tenants.entries()) {
        if (m === addM(ym(today), -1) && i === 0) continue;   // un loyer impayé
        db.tx.push(row({ date: `${m}-05`, activite: 'Immobilier', sens: 'Revenu', categorie: 'Loyer', detail: '', libelle: `Loyer ${m} — ${t.nom}`, montant: 1900, devise: 'MAD', taux: 0.0913, montant_eur: 173.47, nature: 'Courant', tiers: t.nom, lot: t.lot, periode: m, ref: '', note: '', projet_id: PROJET_IMMO }));
      }
      db.tx.push(row({ date: `${m}-12`, activite: 'Immobilier', sens: 'Dépense', categorie: 'Eau & électricité', detail: '', libelle: 'Facture électricité', montant: 2400, devise: 'MAD', taux: 0.0913, montant_eur: 219.12, nature: 'Courant', tiers: '', lot: '', periode: m, ref: '', note: '', projet_id: PROJET_IMMO }));
    }
    db.tx.push(row({ date: '2024-04-24', activite: 'Immobilier', sens: 'Revenu', categorie: 'Apport en capital', libelle: 'Mohamed Capital', montant: 970000, devise: 'MAD', taux: 0.0913, montant_eur: 88561, nature: 'Financement', tiers: 'Mohamed', projet_id: PROJET_IMMO }),
      row({ date: '2024-04-24', activite: 'Immobilier', sens: 'Revenu', categorie: 'Apport en capital', libelle: 'Fatima Capital', montant: 480000, devise: 'MAD', taux: 0.0913, montant_eur: 43824, nature: 'Financement', tiers: 'Fatima', projet_id: PROJET_IMMO }),
      row({ date: '2024-05-02', activite: 'Immobilier', sens: 'Dépense', categorie: 'Acquisition', libelle: 'Achat immeuble', montant: 1300000, devise: 'MAD', taux: 0.0913, montant_eur: 118690, nature: 'Investissement', projet_id: PROJET_IMMO }));
  }
  const defaults = { detail: '', libelle: '', devise: 'EUR', taux: 1, nature: 'Courant', tiers: '', lot: '', periode: '', ref: '', note: '', projet_id: null };
  db.tx = db.tx.map((t) => ({ ...defaults, ...t, periode: t.periode || t.date.slice(0, 7) }));
  // ---- perso : 22 mois de vie courante
  const start = '2025-01', end = ym(today);
  for (let m = start; m <= end; m = addM(m, 1)) {
    const add = (o) => db.tx.push(row({ ...defaults, activite: 'Perso', devise: 'EUR', taux: 1, periode: m, ...o, montant_eur: o.montant }));
    add({ date: `${m}-27`, sens: 'Revenu', categorie: 'Salaire & primes', libelle: 'Salaire LVMH', montant: 4700 });
    add({ date: `${m}-03`, sens: 'Dépense', categorie: 'Loyer', libelle: 'Loyer appartement', montant: 1150 });
    add({ date: `${m}-05`, sens: 'Dépense', categorie: 'Mobile', libelle: 'Forfait mobile', montant: 19.99 });
    for (let k = 0; k < 6; k++) add({ date: `${m}-${pad(2 + k * 4)}`, sens: 'Dépense', categorie: 'Courses', libelle: ['Lidl', 'Carrefour', 'Monoprix'][k % 3], montant: Math.round((45 + rand() * 60) * 100) / 100 });
    for (let k = 0; k < 3; k++) add({ date: `${m}-${pad(6 + k * 8)}`, sens: 'Dépense', categorie: 'Restaurant', libelle: ['Restaurant', 'Brasserie', 'Sushi'][k], montant: Math.round((22 + rand() * 40) * 100) / 100 });
    add({ date: `${m}-15`, sens: 'Dépense', categorie: 'Carburant', libelle: 'Total', montant: Math.round((55 + rand() * 25) * 100) / 100 });
    if (m.endsWith('-12') || m.endsWith('-07')) add({ date: `${m}-20`, sens: 'Dépense', categorie: 'Voyages', libelle: 'Billets', montant: 420 });
    if (+m.slice(5) % 3 === 0) add({ date: `${m}-10`, sens: 'Dépense', categorie: 'La bourse', libelle: 'Virement courtier', montant: 500, nature: 'Investissement' });
  }
  // ---- entreprise (commence en 2027) : clients et factures planifiées
  db.clients = [row({ nom: 'Talan (Givenchy)', devise: 'EUR', tjm: 650, tva: 0.2, micro: 'Oui', note: '', projet_id: PROJET_ENT }), row({ nom: 'Client B', devise: 'EUR', tjm: 580, tva: 0.2, micro: 'Oui', note: '', projet_id: PROJET_ENT })];
  db.invoices = [];
  for (let k = 0; k < 6; k++) db.invoices.push(row({ numero: `F-2027-${pad(k + 1).padStart(3, '0')}`, client: 'Talan (Givenchy)', periode: addM('2027-01', k), jours: 20, tjm: 650, devise: 'EUR', ht: 13000, tva: 0.2, ttc: 15600, emission: null, statut: 'Planifiée', paiement: null, note: '', projet_id: PROJET_ENT, ref_ext: '', echeance: null }));
  db.recurring = []; db.categories = []; db.params = [];
  for (const [a, s, g, n, items] of CATS) for (const it of items) { const [icone, categorie] = it.split('|'); db.categories.push(row({ activite: a, sens: s, groupe: g, nature: n, icone, categorie })); }
  for (const [cle, valeur] of Object.entries(PARAMS)) db.params.push(row({ cle, valeur, libelle: '' }));
  db.accounts = [row({ nom: 'Compte courant', devise: 'EUR', dispo: 'Oui', ordre: 1 }), row({ nom: 'Livret A', devise: 'EUR', dispo: 'Oui', ordre: 2 }), row({ nom: 'Compte Maroc', devise: 'MAD', dispo: 'Non', ordre: 3 })];
  db.snapshots = [];
  for (let k = 5; k >= 0; k--) { const m = addM(ym(today), -k); db.snapshots.push(row({ date: `${m}-28`, compte: 'Compte courant', solde: 2800 + k * 150, devise: 'EUR', solde_eur: 2800 + k * 150 }), row({ date: `${m}-28`, compte: 'Livret A', solde: 9000 - k * 400, devise: 'EUR', solde_eur: 9000 - k * 400 }), row({ date: `${m}-28`, compte: 'Compte Maroc', solde: 52000 + k * 900, devise: 'MAD', solde_eur: Math.round((52000 + k * 900) * 0.0913) })); }
  db.rappels = [row({ titre: 'Déclaration de revenus', categorie: 'Fiscal', frequence: 'Annuel', date: '2027-05-20', avance: 7, actif: 'Oui', note: '' })];
  db.ordres = [
    row({ date: '2025-02-10', symbole: 'CW8.PA', nom: 'Amundi MSCI World', type: 'ETF', compte: 'PEA', sens: 'Achat', quantite: 10, prix: 480, frais: 2, devise: 'EUR', note: '', secteur: '' }),
    row({ date: '2025-09-15', symbole: 'AIR.PA', nom: 'Airbus SE', type: 'Action', compte: 'CTO', sens: 'Achat', quantite: 5, prix: 170, frais: 1, devise: 'EUR', note: '', secteur: 'Industrie' }),
    row({ date: '2026-03-01', symbole: 'GOOGL', nom: 'Alphabet Inc.', type: 'Action', compte: 'CTO', sens: 'Achat', quantite: 12, prix: 210, frais: 1, devise: 'USD', note: '', secteur: 'Technologie' }),
    row({ date: '2026-06-01', symbole: 'ANTHROPIC', nom: 'Anthropic, PBC', type: 'Action', compte: 'CTO', sens: 'Achat', quantite: 1, prix: 900, frais: 0, devise: 'EUR', note: '', secteur: 'Technologie' }),
  ];
  db.import_lignes = []; db.objectifs = []; db.fiscal = []; db.declarations = [];
  return db;
}

export const MOCK_QUOTES = [
  { symbole: 'CW8.PA', nom: 'Amundi MSCI World', prix: 552.4, veille: 548, devise: 'EUR', place: 'Paris', secteur: '' },
  { symbole: 'AIR.PA', nom: 'Airbus SE', prix: 194.36, veille: 192.1, devise: 'EUR', place: 'Paris', secteur: 'Industrie' },
  { symbole: 'GOOGL', nom: 'Alphabet Inc.', prix: 310.2, veille: 305.0, devise: 'USD', place: 'NASDAQ', secteur: 'Technologie' },
];
