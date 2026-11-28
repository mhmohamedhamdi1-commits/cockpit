// Classification automatique des lignes importées (module PUR, sans DOM).
// Propose pour chaque ligne : activité, catégorie, nature, et repère les virements internes et les doublons.
//   ctx  = { tx: [opérations existantes], categories: [{activite, sens, categorie, nature}], ownNames: ['Mohamed Hamdi', …] }
//   opts = { activite: 'Perso' | 'Entreprise' | 'Immobilier' }   (activité du compte importé)
// Ordre de priorité : (1) type Revolut (change, rechargement, virement entre ses comptes → à ignorer ; frais ; intérêts…),
// (2) historique de l'utilisateur (même commerçant déjà catégorisé), (3) règles de mots-clés.
import { normLabel } from './revolut.js';

const STOP = new Set(['paiement', 'carte', 'card', 'payment', 'to', 'from', 'a', 'de', 'du', 'des', 'la', 'le', 'les', 'sas', 'sarl', 'sa', 'eurl', 'ltd', 'inc', 'gmbh', 'www', 'com', 'fr', 'paris', 'pos', 'cb', 'achat', 'virement', 'transfer', 'sepa', 'ref', 'reference', 'facture', 'frais']);
const tokens = (s) => normLabel(s).split(' ').filter((t) => t.length >= 3 && !/\d/.test(t) && !STOP.has(t));
export const merchantKey = (s) => tokens(s).slice(0, 2).join(' ');

// Règles de mots-clés → catégories candidates par activité (la première qui existe chez l'utilisateur est retenue)
const R = (re, p, e = p, i = p, sens = 'Dépense') => ({ re, p, e, i, sens });
export const RULES = [
  R(/\b(salaire|salary|payroll|paie)\b/, ['Salaire & primes'], ['Salaire dirigeant'], ['Autres'], 'Revenu'),
  R(/\b(lidl|carrefour|auchan|leclerc|monoprix|franprix|intermarche|aldi|picard|casino|biocoop|naturalia|grand frais|marjane|carrefour market|supermarche|supermarket|tesco|sainsbury|migros|coop)\b/, ['Courses'], ['Repas & réceptions']),
  R(/\b(restaurant|bistro|bistrot|brasserie|mcdonald|burger|kfc|quick|sushi|pizza|domino|uber eats|deliveroo|just eat|bouillon|boulangerie|paul|cantine|traiteur)\b/, ['Restaurant'], ['Repas & réceptions']),
  R(/\b(cafe|coffee|starbucks|columbus)\b/, ['Café', 'Restaurant'], ['Repas & réceptions']),
  R(/\b(sncf|ouigo|ratp|navigo|uber|bolt|taxi|blablacar|trainline|flixbus|eurostar|tgv|transilien|metro)\b/, ['Transports en Commun'], ['Déplacements pro'], ['Déplacements']),
  R(/\b(total|totalenergies|shell|bp|esso|station|carburant|avia|intermarche station)\b/, ['Carburant'], ['Déplacements pro'], ['Déplacements']),
  R(/\b(parking|indigo|saemes|zenpark|stationnement)\b/, ['Stationnement'], ['Déplacements pro']),
  R(/\b(vinci|sanef|autoroute|peage|APRR)\b/i, ['Autoroute'], ['Déplacements pro']),
  R(/\b(netflix|spotify|disney|canal|deezer|youtube|apple com bill|icloud|amazon prime|prime video|openai|chatgpt|anthropic|claude|dropbox|google one|adobe|microsoft|notion|github|slack|zoom|figma|canva|ovh|scaleway|aws|digitalocean|gandi|1password|lastpass)\b/, ['Abonnements Numériques'], ['Logiciels & abonnements']),
  R(/\b(orange|sfr|bouygues|free mobile|sosh|red by sfr|b&you|lebara)\b/, ['Mobile'], ['Logiciels & abonnements']),
  R(/\b(freebox|livebox|internet|fibre)\b/, ['Internet'], ['Logiciels & abonnements']),
  R(/\b(pharmacie|doctolib|medecin|docteur|dentiste|opticien|hopital|clinique|laboratoire|kine|osteopathe)\b/, ['Soins Médicaux']),
  R(/\b(mutuelle|alan|harmonie|malakoff|axa sante|swisslife sante)\b/, ['Assurance Santé']),
  R(/\b(coiffeur|barbier|coiffure|institut|spa)\b/, ['Soin & Coiffure']),
  R(/\b(basic fit|basicfit|fitness|salle de sport|keepcool|decathlon|gym|club med gym)\b/, ['Activité Sportive']),
  R(/\b(zara|h&m|h m|uniqlo|kiabi|nike|adidas|zalando|vinted|asos|celio|jules|primark|bershka)\b/, ['Vêtements']),
  R(/\b(fnac|cinema|ugc|pathe|gaumont|steam|playstation|nintendo|xbox|ticketmaster|concert|theatre|musee|parc)\b/, ['Loisirs & Divertissements']),
  R(/\b(airbnb|booking|hotel|ryanair|easyjet|air france|vueling|transavia|expedia|trip com|agoda|lufthansa|royal air maroc|ram)\b/, ['Voyages'], ['Déplacements pro']),
  R(/\b(edf|engie|veolia|lydec|redal|onee|amendis|eau|electricite|gaz|total direct energie)\b/, ['Charges'], ['Autres frais pro'], ['Eau & électricité']),
  R(/\b(loyer|rent)\b/, ['Loyer'], ['Autres frais pro'], ['Autres']),
  R(/\b(assurance|maif|macif|matmut|allianz|axa|groupama|april|hiscox)\b/, ['Assurance Habitation', 'Assurance Auto'], ['Assurance pro']),
  R(/\b(impots gouv|dgfip|direction generale des finances|tresor public|finances publiques|taxe fonciere|taxe d habitation)\b/, ['Impôts'], ['CFE & taxes'], ['Taxes']),
  R(/\b(urssaf|cipav|ssi)\b/, ['Impôts'], ['Cotisations URSSAF']),
  R(/\b(comptable|expert comptable|tiime|indy|shine|qonto|compta|legalstart|legalplace|greffe|infogreffe)\b/, ['Frais Bancaires'], ['Comptable & banque'], ['Administratif']),
  R(/\b(amende|antai|contravention)\b/, ['Amendes']),
  R(/\b(ikea|leroy merlin|castorama|brico|bricorama|but|conforama|maisons du monde)\b/, ['Entretien & Bricolage', 'Meubles'], ['Matériel'], ['Entretien & bricolage']),
  R(/\b(darty|boulanger|apple store|apple com|ldlc|materiel net|backmarket|back market|cdiscount|amazon)\b/, ['Electroménager', 'Ordinateur'], ['Matériel']),
  R(/\b(interest|interet|interets)\b/, ['Autres'], ['Autres produits'], ['Autres'], 'Revenu'),
  R(/\b(cashback|reward|remboursement|refund)\b/, ['Remboursement', 'Autres'], ['Autres produits'], ['Autres'], 'Revenu'),
  R(/\b(dividende|dividend)\b/, ['Dividendes'], ['Autres produits'], ['Autres'], 'Revenu'),
];

const KIND_CATS = {
  fee: { Dépense: { p: ['Frais Bancaires'], e: ['Comptable & banque'], i: ['Frais bancaires'] } },
  atm: { Dépense: { p: ['Autres'], e: ['Autres frais pro'], i: ['Autres'] } },
  interest: { Revenu: { p: ['Autres'], e: ['Autres produits'], i: ['Autres'] } },
  cashback: { Revenu: { p: ['Remboursement', 'Autres'], e: ['Autres produits'], i: ['Autres'] } },
  refund: { Revenu: { p: ['Remboursement', 'Autres'], e: ['Autres produits'], i: ['Autres'] } },
  tax: { Dépense: { p: ['Impôts', 'Taxes'], e: ['CFE & taxes'], i: ['Taxes'] } },
};
const ACT_KEY = { Perso: 'p', Entreprise: 'e', Immobilier: 'i' };

// Catégorie de l'utilisateur correspondant à l'un des noms candidats (égalité normalisée, puis inclusion)
export function pickCategory(categories, activite, sens, names) {
  const cs = categories.filter((c) => c.activite === activite && c.sens === sens);
  for (const nm of names || []) {
    const n = normLabel(nm);
    const eq = cs.find((c) => normLabel(c.categorie) === n);
    if (eq) return eq;
  }
  for (const nm of names || []) {
    const n = normLabel(nm);
    const inc = cs.find((c) => normLabel(c.categorie).includes(n) || n.includes(normLabel(c.categorie)));
    if (inc) return inc;
  }
  return null;
}

// Historique : commerçant → catégories déjà utilisées (par activité et sens)
export function buildHistory(tx) {
  const full = new Map(), key = new Map(), first = new Map();
  const add = (m, k, t) => { if (!k) return; const e = m.get(k) || new Map(); const c = `${t.activite}|${t.sens}|${t.categorie}`; e.set(c, (e.get(c) || 0) + 1); m.set(k, e); };
  for (const t of tx) {
    if (!t.libelle || t.libelle === t.categorie) continue;
    add(full, normLabel(t.libelle), t); add(key, merchantKey(t.libelle), t);
    const tk = tokens(t.libelle)[0]; if (tk && tk.length >= 4) add(first, tk, t);
  }
  return { full, key, first };
}
function fromHistory(hist, libelle, activite, sens) {
  const tries = [[hist.full, normLabel(libelle), 1], [hist.key, merchantKey(libelle), 0.85], [hist.first, (tokens(libelle)[0] || ''), 0.65]];
  for (const [m, k, base] of tries) {
    const e = k && m.get(k);
    if (!e) continue;
    const mine = [...e].filter(([c]) => c.startsWith(`${activite}|${sens}|`));
    if (!mine.length) continue;
    const tot = mine.reduce((s, [, n]) => s + n, 0);
    const [c, n] = mine.sort((a, b) => b[1] - a[1])[0];
    const share = n / tot;
    if (share < 0.5) continue;
    return { categorie: c.split('|').slice(2).join('|'), score: Math.min(0.99, base * (0.6 + 0.4 * share) * (n > 1 ? 1 : 0.9)) };
  }
  return null;
}

// Un virement « vers / de » soi-même ? (prénom + nom présents dans le libellé)
export function isOwnTransfer(libelle, ownNames = []) {
  const n = normLabel(libelle);
  return ownNames.some((o) => { const t = normLabel(o).split(' ').filter((x) => x.length >= 2); return t.length >= 2 && t.every((x) => n.includes(x)); });
}

// ---------- doublons avec les opérations déjà saisies ----------
const dayNum = (d) => Math.round(new Date(d + 'T00:00:00Z').getTime() / 864e5);
export function similarity(a, b) {
  const x = new Set(tokens(a)), y = new Set(tokens(b));
  if (!x.size || !y.size) return 0;
  let k = 0; for (const t of x) if (y.has(t) || [...y].some((u) => u.length >= 4 && t.length >= 4 && (u.includes(t) || t.includes(u)))) k++;
  return k / Math.min(x.size, y.size);
}
// Pour chaque ligne : l'opération existante qui lui ressemble (même montant et devise, ±2 jours, libellé proche) ou null.
// Chaque opération existante ne peut correspondre qu'à une seule ligne.
export function findDuplicates(lines, tx) {
  const out = new Array(lines.length).fill(null);
  const used = new Set();
  const byAmt = new Map();
  for (const t of tx) { const k = `${t.devise}|${(Math.round(t.montant * 100) / 100).toFixed(2)}`; (byAmt.get(k) || byAmt.set(k, []).get(k)).push(t); }
  lines.forEach((l, i) => {
    const sens = l.montant > 0 ? 'Revenu' : 'Dépense';
    const cands = byAmt.get(`${l.devise}|${Math.abs(Math.round(l.montant * 100) / 100).toFixed(2)}`) || [];
    let best = null, bs = 0;
    for (const t of cands) {
      if (used.has(t.id) || t.sens !== sens || String(t.ref || '').startsWith('REV:')) continue;
      const dd = Math.abs(dayNum(t.date) - dayNum(l.date));
      if (dd > 2) continue;
      const sim = similarity(l.libelle, `${t.libelle} ${t.tiers || ''}`);
      const score = sim + (dd === 0 ? 0.4 : dd === 1 ? 0.2 : 0);
      if ((sim >= 0.3 || dd === 0) && score > bs) { bs = score; best = t; }
    }
    if (best) { used.add(best.id); out[i] = best; }
  });
  return out;
}

// ---------- classification ----------
export function classifyLine(l, { categories = [], hist = null, ownNames = [] } = {}, { activite = 'Perso' } = {}) {
  const sens = l.montant > 0 ? 'Revenu' : 'Dépense';
  const ak = ACT_KEY[activite] || 'p';
  const res = { activite, sens, categorie: '', nature: '', tiers: '', score: 0, how: '', ignore: false, ignoreReason: '', review: false };
  const label = normLabel(l.libelle);
  const set = (cat, how, score) => { res.categorie = cat.categorie; res.nature = cat.nature || ''; res.how = how; res.score = score; return res; };

  // 1. virements internes
  if (l.kind === 'exchange') return { ...res, ignore: true, ignoreReason: 'Change de devise (mouvement interne)', how: 'type', score: 1 };
  if (l.kind === 'internal') return { ...res, ignore: true, ignoreReason: 'Mouvement entre tes poches / comptes Revolut', how: 'type', score: 1 };
  if (l.kind === 'topup') return { ...res, ignore: true, ignoreReason: 'Rechargement du compte (virement interne probable)', how: 'type', score: 0.9 };
  if (l.kind === 'transfer' && isOwnTransfer(l.libelle, ownNames)) return { ...res, ignore: true, ignoreReason: 'Virement entre tes propres comptes', how: 'type', score: 0.95 };

  // 2. historique de l'utilisateur
  if (hist && l.kind !== 'fee') {
    const h = fromHistory(hist, l.libelle, activite, sens);
    if (h) { const c = categories.find((x) => x.activite === activite && x.sens === sens && x.categorie === h.categorie); if (c) return set(c, 'historique', h.score); }
  }
  // 3. types Revolut puis mots-clés
  const kc = KIND_CATS[l.kind] && KIND_CATS[l.kind][sens];
  if (kc) { const c = pickCategory(categories, activite, sens, kc[ak]); if (c) return set(c, 'type', 0.8); }
  for (const r of RULES) {
    if (r.sens !== sens) continue;
    if (!r.re.test(label)) continue;
    const c = pickCategory(categories, activite, sens, r[ak]);
    if (c) return set(c, 'règle', 0.7);
  }
  if (activite === 'Entreprise' && sens === 'Revenu') { const c = pickCategory(categories, activite, sens, ['Prestations']); if (c) return set(c, 'règle', 0.6); }
  if (l.kind === 'transfer') { const c = pickCategory(categories, activite, sens, sens === 'Revenu' ? ['Virement reçu'] : ['Virement émis']); if (c) { set(c, 'type', 0.3); res.review = true; return res; } }
  res.review = true;
  return res;
}

export function classifyLines(lines, ctx, opts) {
  const hist = buildHistory(ctx.tx || []);
  const dups = findDuplicates(lines, ctx.tx || []);
  return lines.map((l, i) => ({ ...classifyLine(l, { ...ctx, hist }, opts), duplicate: dups[i] }));
}
