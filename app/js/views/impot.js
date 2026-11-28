// Écran « Impôt » : estimation de l'impôt sur le revenu du foyer, assistant « Mes infos fiscales », détail du calcul,
// simulateur « et si… » et barème de l'année. Le moteur est dans ../impot.js (pur) ; les barèmes dans ../impot-data.js
// ou, s'ils existent, dans la table commune `bareme_fiscal` (mise à jour sans redéploiement).
import { h, icon, money, pct, sum, num0, parseAmount, clear } from '../util.js';
import { S, ops, upsert, isMine, partOf, rateToEur, emit } from '../state.js';
import { sb } from '../supa.js';
import { segmented, select, toast, empty, pill } from '../ui.js';
import { kpi } from './common.js';
import { portfolio } from '../core.js';
import { resolveBareme, computeTax, inputFromFlat, whatIf, FIELDS, SECTIONS } from '../impot.js';

export function meta() { return { title: 'Impôt', sub: 'Estimation de l’impôt sur le revenu — barème mis à jour chaque année', period: false, immoToggle: false }; }
export function badge() { return 0; }

const E = (v, d = 0) => money(v, 'EUR', d);
const signedE = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${E(Math.abs(v))}`;
const st = { year: null, drafts: {}, dirty: {}, table: null, ent: undefined, deltas: {}, loading: false };
const curYear = () => Number(S.today.slice(0, 4));
const years = () => { const out = []; for (let y = 2024; y <= curYear() + 1; y++) out.push(y); return out; };

// ---------- chargements différés : barèmes communs et module Entreprise ----------
function loadTable() {
  if (st.table !== null || st.loading) return;
  st.loading = true;
  Promise.resolve(sb.from('bareme_fiscal').select('*')).then(({ data }) => { st.table = data || []; }, () => { st.table = []; }).finally(() => { st.loading = false; if (S.route === 'impot') emit(); });
}
function loadEntreprise() {
  if (st.ent !== undefined) return;
  st.ent = null;
  import('../entreprise.js').then((m) => { st.ent = m; if (S.route === 'impot') emit(); }).catch(() => { st.ent = false; });
}

// ---------- pré-remplissage depuis les données de l'application ----------
const yearOf = (d) => Number(String(d).slice(0, 4));
const fxOf = (d) => (d === 'EUR' ? 1 : d === 'GBX' ? rateToEur('GBP') / 100 : rateToEur(d));
function auto(year) {
  const a = {}, notes = {};
  const tx = S.data.tx.filter((t) => yearOf(t.date) === year);
  // salaires
  const sal = sum(tx.filter((t) => t.activite === 'Perso' && t.sens === 'Revenu' && t.categorie === 'Salaire & primes'), (t) => t.montantEur);
  if (sal > 0) { a.salaire1 = Math.round(sal); notes.salaire1 = `Somme de tes revenus « Salaire & primes » ${year} : ${E(sal)}. Attention : c'est ce qui est arrivé sur ton compte. Remplace-le par le net imposable de ta fiche de décembre (il est plus élevé si ce montant est après prélèvement à la source).`; }
  // entreprises
  const ents = entList(year);
  // bourse : comptes imposables (hors PEA / assurance-vie / PER)
  const ord = (S.data.ordres || []).filter((o) => !['PEA', 'Assurance-vie', 'PER'].includes(o.compte));
  if (ord.length) {
    const before = portfolio(ord.filter((o) => o.date < `${year}-01-01`), {}, fxOf).total, after = portfolio(ord.filter((o) => o.date <= `${year}-12-31`), {}, fxOf).total;
    const pv = after.realized - before.realized, dv = after.dividends - before.dividends;
    if (dv > 0.5) { a.dividendes = Math.round(dv); notes.dividendes = `Dividendes de tes ordres de bourse (comptes imposables) en ${year}.`; }
    if (Math.abs(pv) > 0.5) { a.plusValues = Math.round(Math.max(0, pv)); notes.plusValues = `Plus-values réalisées par tes ventes de ${year} (prix de revient moyen pondéré)${pv < 0 ? ` — moins-value de ${E(-pv)} à reporter` : ''}.`; }
  }
  const divTx = sum(tx.filter((t) => t.activite === 'Perso' && t.sens === 'Revenu' && t.categorie === 'Dividendes'), (t) => t.montantEur);
  if (divTx > 0 && !ents.some((e) => e.dividendesBruts > 0)) { a.dividendes = Math.round((a.dividendes || 0) + divTx); notes.dividendes = (notes.dividendes ? notes.dividendes + ' ' : '') + `+ opérations Perso « Dividendes » : ${E(divTx)}.`; }
  // immobilier : résultat courant × ma part, converti en euros (source étrangère)
  const lines = [];
  for (const p of (S.data.projets || []).filter((x) => (x.type || 'Immobilier') === 'Immobilier' && isMine(x))) {
    const t = tx.filter((x) => x.projetId === p.id && x.activite === 'Immobilier' && x.nature === 'Courant');
    const res = sum(t, (x) => (x.sens === 'Revenu' ? 1 : -1) * x.montantEur) * partOf(p.id);
    if (t.length) lines.push([p.nom, res, partOf(p.id)]);
  }
  if (lines.length) {
    a.foncierEtrangerNet = Math.max(0, Math.round(sum(lines, (l) => l[1])));
    notes.foncierEtrangerNet = lines.map(([n, r, pt]) => `${n} : ${E(r)} (ta part ${Math.round(pt * 100)} %)`).join(' · ') + '. Résultat courant avant impôt marocain ; les opérations en MAD sont converties au taux de leur date.';
  }
  return { a, notes, ents };
}
function entList(year) {
  if (!st.ent || typeof st.ent.fiscalIncome !== 'function') return [];
  const out = [];
  for (const p of (S.data.projets || []).filter((x) => x.type === 'Entreprise' && isMine(x))) {
    try { const f = st.ent.fiscalIncome(S, p, year); if (f) out.push({ nom: p.nom, ...f }); } catch (e) { console.warn('fiscalIncome', e); }
  }
  return out;
}

// ---------- brouillon par année ----------
const rowOf = (year) => (S.data.fiscal || []).find((r) => Number(r.annee) === year);
function draftOf(year) {
  const row = rowOf(year);
  const stamp = row ? `${row.id}:${row.version}` : 'none';
  const cur = st.drafts[year];
  if (!cur || (!st.dirty[year] && cur.stamp !== stamp)) st.drafts[year] = { stamp, data: { ...((row && row.data) || {}) } };
  return st.drafts[year].data;
}
const cleanDraft = (d) => Object.fromEntries(Object.entries(d).filter(([, v]) => v !== '' && v != null));
async function save(year) {
  const row = rowOf(year);
  const ok = await ops([upsert('fiscal', { id: row ? row.id : 0, version: row ? row.version : undefined, annee: year, data: cleanDraft(draftOf(year)) })], 'Infos fiscales enregistrées');
  if (ok) st.dirty[year] = false;
}

// ---------- calcul courant ----------
function compute(year) {
  const B = resolveBareme(year, { table: st.table || [] });
  const au = auto(year);
  const { input, sources } = inputFromFlat(draftOf(year), au.a, au.ents);
  const res = computeTax(input, B);
  return { B, au, input, sources, res };
}

// ---------- page ----------
export function render() {
  loadTable(); loadEntreprise();
  const yrs = years();
  if (!st.year || !yrs.includes(st.year)) st.year = Math.min(curYear(), yrs[yrs.length - 1]);
  const year = st.year;
  const refs = {};
  const out = h('div', { class: 'imp' });
  const draw = () => {
    const c = compute(year);
    drawResults(refs, year, c);
  };

  const head = h('div', { class: 'card' },
    h('header', null, h('h2', null, 'Mon impôt sur le revenu'), h('span', { class: 'sub' }, `revenus ${year}, déclarés au printemps ${year + 1}`),
      h('div', { class: 'right' }, segmented(yrs.map((y) => ({ value: String(y), label: String(y) })), String(year), (v) => { st.year = Number(v); emit(); }, 'sm'))),
    (refs.status = h('div', { class: 'imp-status' })));
  refs.kpis = h('div', { class: 'kpis' });
  const guide = guideCard();
  const form = formCard(year, refs, draw);
  refs.detail = h('div', { class: 'card' });
  refs.sim = h('div', { class: 'card' });
  refs.bareme = h('div', { class: 'card' });
  out.append(head, refs.kpis, guide, form, refs.detail, refs.sim, refs.bareme);
  draw();
  return out;
}

function drawResults(refs, year, c) {
  const { B, res, input, au } = c;
  // statut du barème
  clear(refs.status);
  refs.status.append(
    B.statut === 'officiel' ? pill('good', `Barème officiel ${B.annee}`, 'check') : pill('warn', `Barème ${B.annee} estimé`, 'alert'),
    h('span', { class: 'note' }, B.statut === 'officiel' ? B.source : `${B.source}. Il sera remplacé automatiquement dès que le barème officiel est publié (ligne dans la table bareme_fiscal).`));

  // chiffres clés
  clear(refs.kpis);
  const soldeLabel = res.solde >= 0 ? 'Reste à payer' : 'À restituer';
  refs.kpis.append(
    kpi({ title: 'Impôt estimé de l’année', ic: 'percent', value: E(res.totalImpots), sub: [h('span', null, `TMI ${pct(res.tmi)} · taux moyen ${pct(res.tauxMoyen, 1)}`)] }),
    kpi({ title: 'Déjà prélevé', ic: 'check', value: E(res.dejaPrelevePAS + res.dejaPreleveCapital), sub: [h('span', null, res.dejaPrelevePAS ? 'prélèvement à la source + capital' : 'renseigne ton prélèvement à la source plus bas')] }),
    kpi({ title: soldeLabel, ic: res.solde >= 0 ? 'alert' : 'wallet', value: h('span', { class: res.solde >= 0 ? '' : 'pos' }, E(Math.abs(res.solde))), sub: [h('span', null, `IR ${E(res.irTotal)} · prélèv. sociaux ${E(res.ps.total)}${res.cehr ? ` · CEHR ${E(res.cehr)}` : ''}`)] }),
    kpi({ title: 'Provision conseillée / mois', ic: 'bank', value: E(res.aPayer / 12), sub: [h('span', null, 'à mettre de côté chaque mois pour le solde')] }));

  // détail pas à pas
  clear(refs.detail);
  refs.detail.append(h('header', null, h('h2', null, 'Détail du calcul'), h('span', { class: 'sub' }, `${res.parts.total} part${res.parts.total > 1 ? 's' : ''} · revenu net imposable ${E(res.rni)}`)),
    h('div', { class: 'imp-steps' }, res.steps.map((s) => h('div', { class: 'imp-step ' + s.kind },
      h('div', null, h('b', null, s.label), s.note ? h('span', { class: 'sub' }, s.note) : null),
      h('div', { class: 'num v ' + (s.unit !== 'parts' && s.value < 0 ? 'neg' : '') }, s.unit === 'parts' ? `${String(s.value).replace('.', ',')} parts` : (s.value < 0 ? '−' : '') + E(Math.abs(s.value), Math.abs(s.value) < 100 && s.value % 1 ? 2 : 0))))),
    res.warnings.length ? h('div', { class: 'imp-warn' }, res.warnings.map((w) => h('div', null, icon('info', 14), h('span', null, w)))) : null);

  drawSim(refs, c);
  drawBareme(refs, c);
}

// ---------- simulateur « et si… » ----------
const SIM = [['pensionAscendants', 'Pension versée à un parent', 3000], ['perVersements', 'Versement PER', 2000], ['dividendes', 'Dividendes supplémentaires', 1000], ['salaire1', 'Salaire net imposable en plus', 5000], ['dons66', 'Dons aux associations', 500]];
function drawSim(refs, c) {
  clear(refs.sim);
  const out = h('div', { class: 'imp-simout' });
  const calc = () => {
    const deltas = {}; for (const [k] of SIM) if (st.deltas[k]) deltas[k] = st.deltas[k];
    const w = whatIf(c.input, c.B, deltas);
    clear(out);
    if (!Object.keys(deltas).length) { out.append(h('div', { class: 'note' }, 'Saisis un montant (ou touche une suggestion) pour voir l’effet sur ton impôt.')); return; }
    out.append(h('div', { class: 'imp-simres ' + (w.ecart <= 0 ? 'good' : 'bad') }, h('b', { class: 'num' }, `${signedE(w.ecart)} d’impôt`), h('span', null, ` ${w.ecart <= 0 ? 'en moins' : 'en plus'} sur l’année → ${E(w.alt.totalImpots)} au total`)),
      h('div', { class: 'note' }, `Nouvelle tranche marginale ${pct(w.alt.tmi)} · revenu net imposable ${E(w.alt.rni)}`));
  };
  const inputs = SIM.map(([k, label, sugg]) => {
    const i = h('input', { type: 'text', inputmode: 'decimal', placeholder: '0', value: st.deltas[k] ? String(st.deltas[k]) : '' });
    i.addEventListener('input', () => { st.deltas[k] = parseAmount(i.value); calc(); });
    return h('div', { class: 'field' }, h('label', null, label), i, h('button', { class: 'btn sm ghost', type: 'button', onClick: () => { i.value = String(sugg); st.deltas[k] = sugg; calc(); } }, `+ ${num0(sugg)} €`));
  });
  refs.sim.append(h('header', null, h('h2', null, 'Et si… ?'), h('span', { class: 'sub' }, 'simule un changement sans toucher à tes données'),
    h('div', { class: 'right' }, h('button', { class: 'btn sm ghost', onClick: () => { st.deltas = {}; emit(); } }, 'Effacer'))),
    h('div', { class: 'imp-fields' }, inputs), out);
  calc();
}

// ---------- barème ----------
function drawBareme(refs, c) {
  const { B } = c;
  clear(refs.bareme);
  const tr = B.tranches;
  refs.bareme.append(h('header', null, h('h2', null, `Barème ${B.annee}`), h('span', { class: 'sub' }, 'par part de quotient familial')),
    h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Tranche de revenu'), h('th', { class: 'r' }, 'Taux'))),
      h('tbody', null, tr.map((t, i) => h('tr', null, h('td', null, i === 0 ? `jusqu’à ${E(t.jusqua)}` : t.jusqua == null ? `au-delà de ${E(tr[i - 1].jusqua)}` : `de ${E(tr[i - 1].jusqua)} à ${E(t.jusqua)}`), h('td', { class: 'r num' }, pct(t.taux)))))),
    h('div', { class: 'imp-params' },
      h('div', null, h('span', null, 'Plafond du quotient familial'), h('b', null, `${E(B.qf.demiPart)} / demi-part`)),
      h('div', null, h('span', null, 'Décote (seul / couple)'), h('b', null, `${E(B.decote.baseSeul)} / ${E(B.decote.baseCouple)}`)),
      h('div', null, h('span', null, 'Abattement 10 % salaires'), h('b', null, `${E(B.abattement10.min)} à ${E(B.abattement10.max)}`)),
      h('div', null, h('span', null, 'Prélèvements sociaux capital'), h('b', null, `${pct(B.ps.dividendes, 1)} dividendes · ${pct(B.ps.plusValues, 1)} plus-values`)),
      h('div', null, h('span', null, 'Pension enfant majeur (plafond)'), h('b', null, E(B.pensionAlimentaire.enfantMajeur)))),
    h('div', { class: 'note', style: { marginTop: '10px' } }, `Source : ${B.source}. Le barème est lu dans la base (table bareme_fiscal) quand une ligne existe pour l’année, sinon dans l’application ; une année sans barème publié est projetée automatiquement (indexation sur l’inflation) et marquée « estimé ».`),
    h('div', { class: 'infobox imp-disclaimer' }, icon('alert', 15), h('span', null, 'Estimation indicative : elle ne remplace ni ta déclaration, ni le simulateur officiel (impots.gouv.fr › Simulateurs), ni l’avis d’un conseiller. Les règles particulières (quotient exceptionnel, abattements spéciaux, régimes d’investissement locatif…) ne sont pas toutes couvertes.')));
}

// ---------- guide : « que dois-je saisir ? » ----------
function guideCard() {
  return h('div', { class: 'card' },
    h('header', null, h('h2', null, 'Que dois-je saisir ?'), h('span', { class: 'sub' }, 'très peu de chiffres suffisent')),
    h('div', { class: 'imp-guide' },
      h('div', null, icon('wallet', 18), h('div', null, h('b', null, 'Ton net imposable ANNUEL, pas le net mensuel'), h('span', null, 'Prends la fiche de paie de décembre : ligne « cumul net imposable » (ou « net fiscal annuel »). À défaut, 12 × le « net fiscal » mensuel. Cockpit pré-remplit une estimation depuis tes opérations « Salaire & primes » : remplace-la par ce chiffre exact.'))),
      h('div', null, icon('user', 18), h('div', null, h('b', null, 'Ta situation au 31 décembre'), h('span', null, 'Célibataire, marié/pacsé, enfants à charge : cela fixe le nombre de parts. Une fois saisie, elle est mémorisée pour l’année.'))),
      h('div', null, icon('heart', 18), h('div', null, h('b', null, 'Ce qui réduit ton impôt : pension à un parent, PER, dons…'), h('span', null, 'La pension alimentaire versée à un parent se déduit de ton revenu global (sans plafond légal, sur justificatifs) : saisis-la dans « Ce qui réduit ton revenu imposable ».'))),
      h('div', null, icon('bank', 18), h('div', null, h('b', null, 'Le prélèvement à la source déjà payé'), h('span', null, 'Cumul de l’année sur ta fiche de décembre : il permet d’afficher ce qu’il reste à payer ou à récupérer.'))),
      h('div', null, icon('repeat', 18), h('div', null, h('b', null, 'Le reste est automatique'), h('span', null, 'Immeuble marocain (taux effectif), bourse (plus-values, dividendes, PFU ou barème), entreprises, barème et seuils de l’année : calculés et mis à jour pour toi.')))));
}

// ---------- assistant « Mes infos fiscales » ----------
function formCard(year, refs, draw) {
  const box = h('div', { class: 'card' });
  const au = auto(year);
  const sourcesNow = () => inputFromFlat(draftOf(year), au.a, au.ents).sources;
  const rows = {};
  const upd = () => { const s = sourcesNow(); for (const f of FIELDS) if (rows[f.key]) { rows[f.key].badge.className = 'imp-badge ' + s[f.key]; rows[f.key].badge.textContent = s[f.key] === 'défaut' ? '' : s[f.key]; } };
  const saveBtn = h('button', { class: 'btn primary', type: 'button', onClick: () => save(year) }, icon('save', 15), 'Enregistrer');
  box.append(h('header', null, h('h2', null, 'Mes infos fiscales'), h('span', { class: 'sub' }, 'saisie prioritaire · sinon calcul automatique'), h('div', { class: 'right' }, saveBtn)));

  for (const sec of SECTIONS) {
    const fs = FIELDS.filter((f) => f.section === sec.id);
    const hasVal = fs.some((f) => (draftOf(year)[f.key] ?? '') !== '' || (f.auto && au.a[f.key] != null));
    const body = h('div', { class: 'imp-fields' });
    for (const f of fs) {
      const d = draftOf(year);
      let inp;
      if (f.type === 'select') {
        inp = select(f.options.map(([v, l]) => ({ value: v, label: l })), d[f.key] ?? f.def);
        inp.addEventListener('change', () => { d[f.key] = inp.value; st.dirty[year] = true; upd(); draw(); });
      } else if (f.type === 'bool') {
        inp = select([{ value: '0', label: 'Non' }, { value: '1', label: 'Oui' }], String(d[f.key] ?? f.def ?? 0));
        inp.addEventListener('change', () => { d[f.key] = inp.value === '1' ? 1 : 0; st.dirty[year] = true; upd(); draw(); });
      } else {
        const ph = au.a[f.key] != null && f.auto ? String(au.a[f.key]) : String(f.def ?? 0);
        inp = h('input', { type: 'text', inputmode: f.type === 'int' ? 'numeric' : 'decimal', placeholder: ph, value: d[f.key] != null ? String(d[f.key]).replace('.', ',') : '' });
        inp.addEventListener('input', () => { const v = inp.value.trim(); if (v === '') delete d[f.key]; else d[f.key] = parseAmount(v); st.dirty[year] = true; upd(); draw(); });
      }
      const badge = h('span', { class: 'imp-badge' });
      rows[f.key] = { badge };
      const reset = h('button', { class: 'btn sm ghost imp-reset', type: 'button', title: 'Revenir au calcul automatique', onClick: () => { delete d[f.key]; st.dirty[year] = true; if (f.type === 'select' || f.type === 'bool') inp.value = String(f.def ?? 0); else inp.value = ''; upd(); draw(); } }, icon('undo', 13));
      const note = au.notes[f.key];
      body.append(h('div', { class: 'field imp-field' + (f.type === 'select' ? ' wide' : '') },
        h('label', null, f.label, badge), h('div', { class: 'imp-inwrap' }, inp, f.auto || f.type !== 'select' ? reset : null),
        h('div', { class: 'hint' }, f.hint),
        note ? h('div', { class: 'imp-auto' }, icon('info', 13), h('span', null, note)) : null));
    }
    if (sec.id === 'entreprise') body.append(entreprisesBlock(au.ents, st.ent));
    box.append(h('details', { class: 'details imp-sec', open: hasVal || sec.id === 'foyer' || sec.id === 'activite' }, h('summary', null, icon(sec.ic, 17), h('b', null, sec.titre), icon('chevdown', 14)), h('div', { class: 'note imp-secaide' }, sec.aide), body));
  }
  box.append(h('div', { class: 'row-actions', style: { marginTop: '14px' } }, h('button', { class: 'btn primary lg', type: 'button', onClick: () => save(year) }, icon('save', 16), 'Enregistrer mes infos fiscales'),
    h('span', { class: 'note', style: { alignSelf: 'center' } }, st.dirty[year] ? 'Modifications non enregistrées' : 'Les infos sont enregistrées par année de revenus et synchronisées sur tous tes appareils.')));
  upd();
  return box;
}

function entreprisesBlock(ents, mod) {
  const wrap = h('div', { class: 'imp-ents' });
  const projets = (S.data.projets || []).filter((x) => x.type === 'Entreprise' && isMine(x));
  if (!projets.length) { wrap.append(h('div', { class: 'note' }, 'Aucune entreprise créée : crée-en une dans l’onglet Entreprise pour que son revenu soit repris ici automatiquement.')); return wrap; }
  if (!mod || typeof mod.fiscalIncome !== 'function') { wrap.append(h('div', { class: 'note' }, 'Le calcul fiscal de tes entreprises sera repris ici automatiquement dès que le module Entreprise le fournit.')); return wrap; }
  wrap.append(h('div', { class: 'grp' }, 'Tes entreprises (calculées automatiquement)'),
    h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Entreprise', 'CA encaissé', 'Bénéfice imposable (ma part)', 'Rémunération', 'Dividendes'].map((x, i) => h('th', { class: i ? 'r' : '' }, x)))),
      h('tbody', null, ents.map((e) => h('tr', null, h('td', null, e.nom, e.versementLiberatoire ? h('span', { class: 'sub' }, 'versement libératoire') : null, e.estimated ? h('span', { class: 'sub' }, 'estimation') : null),
        h('td', { class: 'r num' }, E(e.ca || 0)), h('td', { class: 'r num' }, E((e.bnc || 0) + (e.bic || 0))), h('td', { class: 'r num' }, E(e.salaireNetImposable || 0)), h('td', { class: 'r num' }, E(e.dividendesBruts || 0)))))));
  return wrap;
}
