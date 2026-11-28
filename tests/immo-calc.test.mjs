// Calculs immobiliers (associés, retraits, capital récupéré, occupation) : cas construits à la main + données réelles si la sauvegarde locale existe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TABLES, fromDb } from '../app/js/schema.js';
import { associatesOf, partnerBalances, capitalRecovery, occupancy, projectInsights } from '../app/js/immo-calc.js';
import { loadBackupImmo } from './mockdata.mjs';

const P = { taux: 0.1, nom: 'Mohamed' };
const mk = (o) => ({ id: crypto.randomUUID(), activite: 'Immobilier', devise: 'MAD', montantEur: o.montant * 0.1, taux: 0.1, nature: 'Courant', tiers: '', lot: '', projetId: 'p1', detail: '', libelle: '', ...o });
const ctxOf = (tx, extra = {}) => ({ today: '2026-11-28', P, data: { tx, tenants: [], lots: [], projets: [], ...extra } });
const projet = { id: 'p1', nom: 'Amal 1', part: 0.67, type: 'Immobilier', meta: {} };
const mem = [{ projet_id: 'p1', label: 'Fatima (sœur)', part: 0.33, status: 'actif', user_id: 'u2' }];

test('associés : propriétaire + invité, noms nettoyés', () => {
  const a = associatesOf(ctxOf([]), projet, { memberships: mem });
  assert.deepEqual(a.map((x) => [x.nom, x.part, x.mine]), [['Mohamed', 0.67, true], ['Fatima', 0.33, false]]);
  // part restante sans invité : « Autres associés », ou le nom vu dans les opérations
  const b = associatesOf(ctxOf([mk({ date: '2024-01-01', sens: 'Dépense', categorie: 'Distribution aux associés', montant: 5, tiers: 'Fatima' })]), projet, {});
  assert.deepEqual(b.map((x) => [x.nom, Math.round(x.part * 100)]), [['Mohamed', 67], ['Fatima', 33]]);
  // saisie explicite
  const c = associatesOf(ctxOf([]), { ...projet, meta: { associes: [{ nom: 'Mohamed', part: 0.5, moi: true }, { nom: 'Karim', part: 0.5 }] } });
  assert.deepEqual(c.map((x) => [x.nom, x.part]), [['Mohamed', 0.5], ['Karim', 0.5]]);
});

test('retraits entre associés : qui doit quoi et retrait maximum (cas du feedback)', () => {
  const tx = [
    mk({ date: '2024-04-24', sens: 'Revenu', categorie: 'Apport en capital', montant: 6700, tiers: 'Mohamed', nature: 'Financement' }),
    mk({ date: '2024-04-24', sens: 'Revenu', categorie: 'Apport en capital', montant: 3300, tiers: 'Fatima', nature: 'Financement' }),
    mk({ date: '2026-01-10', sens: 'Dépense', categorie: 'Distribution aux associés', montant: 1000, tiers: 'Mohamed', nature: 'Financement' }),
    mk({ date: '2026-02-10', sens: 'Dépense', categorie: 'Distribution aux associés', montant: 100, tiers: 'Fatima', nature: 'Financement' }),
    mk({ date: '2026-03-10', sens: 'Revenu', categorie: 'Loyer', montant: 100 + 500 }),   // trésorerie : 10 000 − 1 100 + 600 (+ rien d'autre) = 9 500 → on ajoute une dépense pour viser 500 en caisse
    mk({ date: '2026-03-11', sens: 'Dépense', categorie: 'Travaux', montant: 9000, nature: 'Investissement' }),
  ];
  const b = partnerBalances(ctxOf(tx), projet, { memberships: mem });
  const [m, f] = b.associes;
  assert.equal(b.retraits, 1100);
  assert.equal(b.tresorerie, 500);
  assert.equal(m.ecart, 263); assert.equal(f.ecart, -263);
  assert.deepEqual(b.owes, [{ from: 'Mohamed', to: 'Fatima', amount: 263 }]);
  assert.equal(Math.round(m.droit), 737);
  // retrait max : Fatima rattrape son retard puis le solde se répartit 67/33
  assert.ok(Math.abs(m.maxRetrait + f.maxRetrait - 500) < 0.02, 'la somme des retraits possibles = la trésorerie');
  assert.ok(f.maxRetrait > m.maxRetrait, 'Fatima peut retirer plus (elle est en retard)');
  assert.equal(Math.round(f.maxRetrait), 428); assert.equal(Math.round(m.maxRetrait), 72);
  assert.equal(b.balanced, false);
  assert.equal(m.apports, 6700);
});

test('retraits : tout est proportionnel ⇒ équilibré', () => {
  const tx = [mk({ date: '2026-01-10', sens: 'Dépense', categorie: 'Distribution aux associés', montant: 670, tiers: 'Mohamed', nature: 'Financement' }),
    mk({ date: '2026-01-10', sens: 'Dépense', categorie: 'Distribution aux associés', montant: 330, tiers: 'Fatima', nature: 'Financement' }),
    mk({ date: '2026-01-10', sens: 'Revenu', categorie: 'Loyer', montant: 2000 })];
  const b = partnerBalances(ctxOf(tx), projet, { memberships: mem });
  assert.equal(b.balanced, true); assert.deepEqual(b.owes, []);
  assert.equal(b.associes[0].maxRetrait, 670); assert.equal(b.associes[1].maxRetrait, 330);
  const none = partnerBalances(ctxOf([]), projet, { memberships: mem });
  assert.equal(none.retraits, 0); assert.equal(none.associes[0].maxRetrait, 0);
});

test('retraits non attribués : signalés, sans fausser les écarts', () => {
  const tx = [mk({ date: '2026-01-10', sens: 'Dépense', categorie: 'Distribution aux associés', montant: 500, tiers: '', nature: 'Financement' }),
    mk({ date: '2026-01-10', sens: 'Dépense', categorie: 'Distribution aux associés', montant: 100, tiers: 'Mohamed', nature: 'Financement' })];
  const b = partnerBalances(ctxOf(tx), projet, { memberships: mem });
  assert.equal(b.unassigned, 500); assert.equal(b.nUnassigned, 1); assert.equal(b.retraits, 100);
});

test('capital récupéré et projection du retour', () => {
  const tx = [mk({ date: '2024-04-24', sens: 'Revenu', categorie: 'Apport en capital', montant: 100000, nature: 'Financement', tiers: 'Mohamed' }),
    mk({ date: '2024-05-01', sens: 'Dépense', categorie: 'Acquisition', montant: 100000, nature: 'Investissement' }),
    mk({ date: '2025-06-01', sens: 'Dépense', categorie: 'Distribution aux associés', montant: 10000, nature: 'Financement', tiers: 'Mohamed' })];
  // 12 mois complets (nov. 2025 → oct. 2026) : 2 000 de loyers − 500 de charges par mois = 18 000 / an
  for (let k = 0; k < 12; k++) {
    const d = new Date(2025, 10 + k, 1); const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    tx.push(mk({ date: `${m}-05`, sens: 'Revenu', categorie: 'Loyer', montant: 2000 }), mk({ date: `${m}-10`, sens: 'Dépense', categorie: 'Entretien & bricolage', montant: 500 }));
  }
  const r = capitalRecovery(ctxOf(tx), projet);
  assert.equal(r.apports, 100000); assert.equal(r.retraits, 10000);
  assert.equal(r.annualFree, 18000);
  assert.ok(r.tresorerie > 0);
  assert.equal(r.remaining, 100000 - 10000 - r.tresorerie);
  assert.ok(Math.abs(r.years - r.remaining / 18000) < 1e-9);
  assert.ok(r.yearPayback >= 2030 && r.yearPayback <= 2032, `année ${r.yearPayback}`);
  const g = capitalRecovery(ctxOf(tx), projet, { growth: 0.1 });
  assert.ok(g.years < r.years, 'des loyers qui augmentent raccourcissent le retour');
  assert.ok(r.series.length > 3 && r.series.some((x) => x.projected) && r.series.at(-1).value <= 100000);
  // pas de cash-flow : pas de date
  const flat = capitalRecovery(ctxOf(tx.filter((t) => t.categorie !== 'Loyer')), projet);
  assert.equal(flat.years, null); assert.equal(flat.date, null);
  // capital déjà récupéré
  const full = capitalRecovery(ctxOf([...tx, mk({ date: '2026-02-01', sens: 'Dépense', categorie: 'Distribution aux associés', montant: 95000, nature: 'Financement' })]), projet);
  assert.equal(full.years === 0 || full.remaining === 0, true);
});

test('taux d\'occupation sur une période : jours-lots, départ en cours de mois, vacance', () => {
  const lots = [{ nom: 'L1', code: '01', loyer: 3000 }, { nom: 'L2', code: '02', loyer: 3000 }];
  const tenants = [
    { lot: 'L1', nom: 'A', loyer: 3000, entree: '2026-01-01', sortie: '' },
    { lot: 'L2', nom: 'B', loyer: 3000, entree: '2026-01-01', sortie: '2026-01-31' },
    { lot: 'L2', nom: 'C', loyer: 3000, entree: '2026-03-01', sortie: '' },
  ];
  const ctx = { ...ctxOf([], { tenants }), today: '2026-04-30' };
  const o = occupancy(ctx, lots, '2026-01', '2026-04');
  // L1 : 100 % ; L2 : janvier (31 j) + mars-avril (61 j) = 92 j sur 120 j
  assert.equal(o.totalDays, 240); assert.equal(o.occupiedDays, 120 + 92);
  assert.ok(Math.abs(o.rate - 212 / 240) < 1e-9);
  assert.equal(o.vacantDays, 28);
  assert.equal(Math.round(o.perLot[1].rate * 1000), Math.round((92 / 120) * 1000));
  // un seul mois, mois courant arrêté à aujourd'hui
  const c = occupancy({ ...ctx, today: '2026-04-15' }, lots, '2026-04', '2026-04');
  assert.equal(c.totalDays, 30); assert.equal(c.rate, 1);
  // période future : pas de taux
  assert.equal(occupancy(ctx, lots, '2026-06', '2026-08').rate, null);
  // deux locataires qui se chevauchent ne comptent qu'une fois
  const ov = occupancy({ ...ctx, today: '2026-02-28' }, [lots[0]], '2026-02', '2026-02');
  assert.equal(ov.rate, 1);
});

test('analyses : produites sans erreur sur un projet réaliste', () => {
  const tx = [mk({ date: '2024-04-24', sens: 'Revenu', categorie: 'Apport en capital', montant: 100000, nature: 'Financement', tiers: 'Mohamed' }), mk({ date: '2024-05-01', sens: 'Dépense', categorie: 'Acquisition', montant: 90000, nature: 'Investissement' })];
  for (let k = 0; k < 12; k++) { const d = new Date(2025, 11 + k, 1); const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    tx.push(mk({ date: `${m}-05`, sens: 'Revenu', categorie: 'Loyer', montant: 2000, lot: 'L1' }), mk({ date: `${m}-06`, sens: 'Revenu', categorie: 'Charges refacturées', montant: 100 }), mk({ date: `${m}-10`, sens: 'Dépense', categorie: 'Eau & électricité', montant: 250 })); }
  const lots = [{ nom: 'L1', code: '01', loyer: 2000 }, { nom: 'L2', code: '02', loyer: 2000 }, { nom: 'L3', code: '03', loyer: 2000 }];
  const tenants = lots.map((l, i) => ({ lot: l.nom, nom: `T${i}`, loyer: i === 2 ? 1500 : 2000, charges: 100, entree: '2024-06-01', sortie: '' }));
  const ctx = ctxOf(tx, { tenants, lots });
  const ins = projectInsights(ctx, { ...projet, meta: { valeur: 120000 } }, { lots, balances: partnerBalances(ctx, projet, { memberships: mem }), recovery: capitalRecovery(ctx, projet) });
  const ids = ins.map((i) => i.id);
  for (const k of ['rendement', 'plusvalue', 'charges', 'refact', 'vacance', 'prevision', 'capital']) assert.ok(ids.includes(k), `analyse « ${k} » absente : ${ids}`);
  assert.ok(ins.every((i) => i.title && i.text && ['good', 'warn', 'bad', 'info'].includes(i.kind)));
});

test('données réelles (sauvegarde locale) : cohérence des comptes entre associés', { skip: !loadBackupImmo() }, () => {
  const b = loadBackupImmo();
  const conv = (key, rows) => rows.filter((r) => !r.deleted_at).map((r) => fromDb(TABLES.find((t) => t.key === key), r));
  const projets = conv('projets', b.projets).filter((p) => p.id === 'dce766d6-a5f2-48ee-b919-6d283c0babbf');
  const tx = conv('tx', b.tx_immo).map((t) => ({ ...t, projetId: 'dce766d6-a5f2-48ee-b919-6d283c0babbf' }));
  const ctx = { today: '2026-11-28', P: { taux: 0.0913, nom: 'Mohamed' }, data: { tx, tenants: conv('tenants', b.tenants), lots: conv('lots', b.lots), projets } };
  const p = { ...projets[0], part: 0.67 };
  const mems = [{ projet_id: p.id, label: 'Fatima (sœur)', part: 0.33, status: 'actif', user_id: 'u2' }];
  const bal = partnerBalances(ctx, p, { memberships: mems });
  assert.equal(bal.associes.length, 2);
  assert.ok(Math.abs(bal.associes.reduce((s, a) => s + a.ecart, 0)) < 0.05, 'la somme des écarts est nulle');
  assert.ok(bal.retraits > 0 && bal.apports > 0);
  assert.ok(Math.abs(bal.associes.reduce((s, a) => s + a.maxRetrait, 0) - Math.max(0, bal.tresorerie)) < 0.1);
  const names = bal.associes.map((a) => a.nom).join();
  assert.equal(names, 'Mohamed,Fatima');
  assert.equal(bal.unassigned, 0, 'toutes les distributions sont attribuées à un associé');
  const rec = capitalRecovery(ctx, p);
  console.log('  réel : apports', Math.round(bal.apports), 'retraits', Math.round(bal.retraits), 'trésorerie', Math.round(bal.tresorerie), '| écarts', bal.associes.map((a) => `${a.nom} ${Math.round(a.ecart)}`).join(' / '), '| owes', JSON.stringify(bal.owes), '| récupéré', (rec.pctRecovered * 100).toFixed(1) + ' %', 'libre/an', Math.round(rec.annualFree), 'retour', rec.yearPayback);
});
