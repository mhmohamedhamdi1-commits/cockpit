// Santé financière par domaine, règle « l'entreprise n'est jamais additionnée », trésorerie, rappel électricité.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TABLES, fromDb } from '../app/js/schema.js';
import * as core from '../app/js/core.js';
import { buildMockDb } from './mockdata.mjs';

function ctxFrom(db, today = '2026-11-28') {
  const data = {};
  for (const t of TABLES) data[t.key] = (db[t.key] || []).filter((r) => !r.deleted_at).map((r) => fromDb(t, r));
  const ctx = { data, today, immoView: 'mine', ...core.buildIndex(data) };
  return ctx;
}
const db = buildMockDb({ withBackup: false });
const ctx = ctxFrom(db);

test('santé : un score par domaine, global = moyenne des domaines, actions classées par gain', () => {
  const all = core.financialHealth(ctx, { scope: 'Tout', partOf: () => 0.67, projets: ctx.data.projets.filter((p) => p.type === 'Immobilier') });
  assert.ok(all.score >= 0 && all.score <= 100);
  assert.deepEqual(all.domains.map((d) => d.name), ['Perso', 'Immobilier']);
  assert.equal(all.score, Math.round(all.domains.reduce((s, d) => s + d.score, 0) / all.domains.length));
  for (let i = 1; i < all.actions.length; i++) assert.ok(all.actions[i - 1].gain >= all.actions[i].gain);
  assert.ok(all.indicators.every((i) => ['good', 'warn', 'bad'].includes(i.level) && i.label && i.text));
  assert.ok(all.actions.every((a) => a.advice));
  const perso = core.financialHealth(ctx, { scope: 'Perso' });
  assert.deepEqual(perso.domains.map((d) => d.name), ['Perso']);
  assert.ok(perso.indicators.length >= 4 && perso.indicators.every((i) => i.domain === 'Perso'));
  const immo = core.financialHealth(ctx, { scope: 'Immobilier', partOf: () => 0.67, projets: ctx.data.projets.filter((p) => p.type === 'Immobilier') });
  assert.ok(immo.indicators.some((i) => i.id === 'loyers'));
  // entreprise : indicateurs fournis par le module Entreprise
  const ent = core.financialHealth(ctx, { scope: 'Entreprise', entreprise: () => [{ id: 'x', label: 'Test', value: 1, fmt: 'n', level: 'bad', text: 't' }] });
  assert.equal(ent.score, 20); assert.equal(ent.label, 'Fragile');
  // pas de données : pas de score
  assert.equal(core.financialHealth(ctx, { scope: 'Bourse' }).score, null);
  assert.equal(core.financialHealth(ctx, { scope: 'Entreprise' }).score, null);
});

test('santé bourse : concentration, secteurs, frais, devise', () => {
  const pf = core.portfolio([
    { date: '2025-01-01', symbole: 'AAA', nom: 'Titre A', type: 'Action', sens: 'Achat', quantite: 10, prix: 100, frais: 5, devise: 'USD' },
    { date: '2025-01-01', symbole: 'ETF', nom: 'ETF monde', type: 'ETF', sens: 'Achat', quantite: 1, prix: 100, frais: 0, devise: 'EUR' }],
  { AAA: { prix: 150, devise: 'USD' }, ETF: { prix: 110, devise: 'EUR' } }, (d) => (d === 'USD' ? 0.9 : 1));
  const h = core.financialHealth(ctx, { scope: 'Bourse', pf, sectorOf: (p) => (p.type === 'ETF' ? 'ETF / fonds diversifiés' : 'Technologie') });
  const byId = Object.fromEntries(h.indicators.map((i) => [i.id, i]));
  assert.equal(byId.concentration.level, 'bad');       // 1 350 € sur 1 460 € ≈ 92 %
  assert.equal(byId.secteurs.level, 'bad');
  assert.equal(byId.devise.level, 'bad');
  assert.equal(byId.perf.level, 'good');
  assert.ok(byId.frais.value < 0.01 && byId.frais.level === 'good');
});

test('l\'entreprise n\'est jamais additionnée : trésorerie à part, total = perso + immobilier', () => {
  const d2 = buildMockDb({ withBackup: false });
  d2.tx.push({ ...d2.tx[0], id: crypto.randomUUID(), activite: 'Entreprise', projet_id: d2.projets[1].id, sens: 'Revenu', categorie: 'Prestations', montant: 10000, montant_eur: 10000, devise: 'EUR', taux: 1, nature: 'Courant', date: '2026-11-10', periode: '2026-11' });
  const c = ctxFrom(d2);
  const cash = core.cashPosition(c, { partOf: () => 0.67, isMine: () => true });
  assert.equal(cash.entreprises.length, 1); assert.equal(cash.entreprises[0].eur, 10000);
  const perso = c.data.tx.filter((t) => t.activite === 'Perso').reduce((s, t) => s + (t.sens === 'Revenu' ? 1 : -1) * t.montantEur, 0);
  assert.ok(Math.abs(cash.perso.eur - perso) < 0.01, 'le perso n\'inclut pas l\'entreprise');
  assert.ok(Math.abs(cash.totalMineEur - (cash.perso.eur + cash.projets.reduce((s, p) => s + p.mineEur, 0))) < 0.01);
});

test('rappel facture d\'électricité : du 1 au 3, jusqu\'à saisie du paiement, réglable', () => {
  const mk = (today, extra = []) => { const d = buildMockDb({ withBackup: false }); d.tx = d.tx.filter((t) => !(t.categorie === 'Eau & électricité' && t.date.startsWith(today.slice(0, 7)))); d.tx.push(...extra); return ctxFrom(d, today); };
  assert.equal(core.elecDue(mk('2026-11-02')).due, true);
  assert.equal(core.elecDue(mk('2026-11-01')).due, true);
  assert.equal(core.elecDue(mk('2026-11-03')).due, true);
  assert.equal(core.elecDue(mk('2026-11-04')).due, false);
  assert.equal(core.elecDue(mk('2026-11-15')).due, false);
  const paid = mk('2026-12-02', [{ ...buildMockDb({ withBackup: false }).tx.find((t) => t.categorie === 'Eau & électricité'), id: crypto.randomUUID(), date: '2026-12-01', periode: '2026-12' }]);
  assert.equal(core.elecDue(paid).due, false, 'payée : plus de rappel');
  // désactivable
  const c = mk('2026-11-02'); c.P.notif = (k) => k !== 'elec';
  assert.equal(core.elecDue(c).due, false);
  // alerte du tableau de bord
  assert.ok(core.computeAlerts(mk('2026-11-02')).some((a) => a.id === 'elec'));
});
