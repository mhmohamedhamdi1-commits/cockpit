// Écran Entreprise : un projet = une entreprise (comme un projet immobilier). Suivi annuel et mensuel, plafonds,
// charges et impôts estimés, planning de déclarations, facturation du mois, factures, clients, facturation électronique.
// Le moteur de calcul est dans ../entreprise.js (pur, testé) ; les fenêtres de saisie dans ./entreprise-forms.js.
import { h, icon, eur, money, num0, pct, monthLong, monthShort, fmtDate, daysBetween, sum, clear } from '../util.js';
import { S, emit, entreprises, ops, upsert, todayMonth } from '../state.js';
import { segmented, confirmBox, empty, pill, toast } from '../ui.js';
import { kpi } from './common.js';
import * as E from '../entreprise.js';
import * as F from './entreprise-forms.js';

const LS = 'cockpit.ent.v1';
const st = (() => { try { return { projetId: null, year: null, hideDone: true, ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { return { projetId: null, year: null, hideDone: true }; } })();
const save = () => { try { localStorage.setItem(LS, JSON.stringify({ projetId: st.projetId, hideDone: st.hideDone })); } catch { /* ignore */ } };

export function meta() {
  const p = cur();
  return { title: p ? p.nom : 'Entreprise', sub: p ? E.FORMES[E.normalizeMeta(p.meta, p, S).forme].label : 'Tes entreprises, suivies séparément', period: false, immoToggle: false };
}
// Pastille du menu : échéances en retard + factures en retard de paiement
export function badge() {
  try {
    const late = E.upcomingDeadlines(S, S.today, 3).filter((d) => d.late || d.inDays <= 3).length;
    const unpaid = (S.data.invoices || []).filter((i) => i.statut === 'Envoyée' && i.emission && daysBetween(i.emission, S.today) > 30).length;
    return late + unpaid;
  } catch { return 0; }
}

// ───────────────────────── sélection ─────────────────────────
function cur() {
  const list = entreprises();
  if (st.projetId === '') return null;                                  // « Toutes »
  const p = list.find((x) => x.id === st.projetId);
  if (p) return p;
  return list.length === 1 ? list[0] : null;                            // une seule entreprise : on l'ouvre directement
}
const choose = (id) => { st.projetId = id; save(); emit(); };
const eur0 = (v) => eur(v, 0);

// ───────────────────────── page ─────────────────────────
export function render() {
  const list = entreprises();
  if (!list.length) return [welcome()];
  const p = cur();
  const bar = projectsBar(list, p);
  return p ? [bar, ...single(p)] : [bar, ...overview(list)];
}

function welcome() {
  return h('div', { class: 'card ent-welcome' }, empty('Crée ta première entreprise',
    'Une entreprise = un projet, comme un immeuble : on te demande le régime, tes parts, la TVA… puis Cockpit estime tes charges (URSSAF, impôt, IS), suit tes plafonds et prépare ton planning de déclarations.',
    h('button', { class: 'btn primary lg', onClick: () => F.openEntrepriseForm(null, { onDone: (id) => id && choose(id) }) }, icon('plus', 17), 'Nouvelle entreprise')));
}
function projectsBar(list, p) {
  const chip = (id, label, extra) => h('button', { type: 'button', class: 'pchip' + ((p ? p.id : '') === id ? ' on' : ''), onClick: () => choose(id) }, label, extra);
  return h('div', { class: 'card ent-bar' }, h('div', { class: 'pbar' },
    list.length > 1 ? chip('', 'Toutes mes entreprises') : null,
    list.map((x) => { const m = E.normalizeMeta(x.meta, x, S); return chip(x.id, x.nom, !E.started(m, S.today) ? h('span', { class: 'pill mute' }, 'à venir') : null); }),
    h('button', { type: 'button', class: 'pchip add', onClick: () => F.openEntrepriseForm(null, { onDone: (id) => id && choose(id) }) }, icon('plus', 14), 'Nouvelle entreprise')));
}

// ───────────────────────── vue « Toutes mes entreprises » ─────────────────────────
function overview(list) {
  const year = String(st.year || S.today.slice(0, 4));
  const rows = E.entreprisesSummary(S, year);
  const th = (t, r) => h('th', { class: r ? 'r' : '' }, t);
  const table = h('table', { class: 'tbl' }, h('thead', null, h('tr', null, th('Entreprise'), th('Mes parts', 1), th('CA encaissé', 1), th('Facturé / planifié', 1), th('Charges et impôts estimés', 1), th('Résultat estimé', 1), th('Dividendes (mes parts)', 1), th('Flat tax estimée', 1), th('Trésorerie', 1))),
    h('tbody', null, rows.map((r) => h('tr', { class: 'click', onClick: () => choose(r.projet.id) },
      h('td', null, r.projet.nom, h('span', { class: 'sub' }, `${E.FORMES[r.meta.forme].short}${r.started ? '' : ` · démarre le ${fmtDate(r.meta.date_debut)}`}`)),
      h('td', { class: 'r num' }, `${Math.round(r.part * 100)} %`), h('td', { class: 'r num' }, eur0(r.ca)), h('td', { class: 'r num' }, eur0(r.planifie)), h('td', { class: 'r num' }, eur0(r.charges)),
      h('td', { class: 'r num ' + (r.resultat < 0 ? 'neg' : '') }, eur0(r.resultat), r.estimated ? h('span', { class: 'sub' }, 'estimé') : null),
      h('td', { class: 'r num' }, r.dividendesMesParts ? eur0(r.dividendesMesParts) : '—'), h('td', { class: 'r num' }, r.flatTax ? eur0(r.flatTax) : '—'), h('td', { class: 'r num' }, eur0(r.tresorerie))))));
  const cmp = h('div', { class: 'card' }, h('header', null, h('h2', null, `Comparatif ${year}`), h('span', { class: 'sub' }, 'chaque ligne est une entreprise — aucun total'), h('div', { class: 'right' }, yearSeg(year, list))),
    h('div', { class: 'gridwrap' }, table),
    h('div', { class: 'infobox', style: { marginTop: '12px' } }, 'Pas de total volontairement : une facture devient un salaire ou un dividende dans ton budget Perso, additionner les entreprises ferait un doublon. Les dividendes et la flat tax sont calculés sur TES parts.'));
  const up = E.upcomingDeadlines(S, S.today, 60);
  const planning = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Prochaines échéances'), h('span', { class: 'sub' }, 'toutes entreprises, 60 jours')),
    up.length ? h('div', { class: 'ent-decl' }, up.slice(0, 12).map((d) => declRow(entreprises().find((x) => x.id === d.projetId), d, { showNom: true }))) : h('div', { class: 'muted' }, 'Aucune échéance dans les 60 prochains jours.'));
  const health = E.entrepriseHealth(S);
  const hc = health.length ? h('div', { class: 'card' }, h('header', null, h('h2', null, 'Santé des entreprises')), h('div', { class: 'hind' }, health.map(healthRow))) : null;
  return [cmp, h('div', { class: hc ? 'row2e' : '' }, planning, hc)];
}
const healthRow = (i) => h('div', { class: 'hi ' + i.level }, h('i', { style: { background: i.level === 'good' ? 'var(--good)' : i.level === 'warn' ? 'var(--warn)' : 'var(--crit)' } }),
  h('div', null, h('b', null, i.label, ' ', h('span', { class: 'hv' }, i.fmt === 'pct' ? pct(i.value) : String(i.value))), h('span', { class: 'sub' }, i.text)));

function yearSeg(year, list) {
  const y0 = Math.min(...list.map((p) => { const d = E.normalizeMeta(p.meta, p, S).date_debut; return d ? +d.slice(0, 4) : +S.today.slice(0, 4); }), +S.today.slice(0, 4));
  const yMax = Math.max(+S.today.slice(0, 4), ...list.map((p) => { const d = E.normalizeMeta(p.meta, p, S).date_debut; return d ? +d.slice(0, 4) : 0; }));
  const years = []; for (let y = y0; y <= yMax; y++) years.push(String(y));
  if (years.length < 2) return null;
  return segmented(years.map((v) => ({ value: v, label: v })), year, (v) => { st.year = v; emit(); }, 'sm');
}
const pickYear = (p) => {
  const m = E.normalizeMeta(p.meta, p, S), thisY = +S.today.slice(0, 4), sy = m.date_debut ? +m.date_debut.slice(0, 4) : thisY;
  const y = st.year && +st.year >= Math.min(sy, thisY) && +st.year <= Math.max(sy, thisY) ? String(st.year) : String(Math.max(thisY, sy));
  return y;
};

// ───────────────────────── vue d'une entreprise ─────────────────────────
function single(p) {
  const m = E.normalizeMeta(p.meta, p, S), Fm = E.FORMES[m.forme];
  const year = pickYear(p), hasStarted = E.started(m, S.today);
  const fy = E.entrepriseYear(S, p, year), fin = E.entrepriseFinance(S, p, year);
  const out = [header(p, m, Fm, year, hasStarted)];
  if (!hasStarted) out.push(launchCard(p, m));
  out.push(kpis(p, m, fy, fin, year));
  out.push(h('div', { class: 'row2e' }, plafondCard(p, m, fy, year), chargesCard(p, m, fin, year)));
  out.push(monthlyCard(p, m, fy, year));
  out.push(planningCard(p, m, year));
  out.push(invoicesCard(p, m, year));
  out.push(h('div', { class: 'row2e' }, clientsCard(p), einvoiceCard(p, m)));
  return out;
}

function header(p, m, Fm, year, hasStarted) {
  const years = []; const sy = m.date_debut ? +m.date_debut.slice(0, 4) : +S.today.slice(0, 4);
  for (let y = Math.min(sy, +S.today.slice(0, 4)); y <= Math.max(sy, +S.today.slice(0, 4)); y++) years.push(String(y));
  const assoc = m.associes.length > 1 ? `${m.associes.map((a) => `${a.moi ? 'moi' : a.nom || 'associé'} ${Math.round(a.part * 100)} %`).join(' · ')}` : 'seul associé';
  return h('div', { class: 'card ent-head' }, h('div', { class: 'pdetail', style: { marginTop: 0 } },
    h('div', null, h('b', null, p.nom), h('span', { class: 'sub' }, `${Fm.label} · ${assoc}${m.libelle_activite ? ' · ' + m.libelle_activite : ''}`),
      h('span', { class: 'sub' }, hasStarted ? `Activité depuis le ${fmtDate(m.date_debut)}` : `Démarre le ${fmtDate(m.date_debut)} — dans ${daysBetween(S.today, m.date_debut)} jours`)),
    h('div', { class: 'row-actions' }, years.length > 1 ? segmented(years.map((v) => ({ value: v, label: v })), year, (v) => { st.year = v; emit(); }, 'sm') : null,
      h('button', { class: 'btn primary', onClick: () => F.openBilling(p) }, icon('calendar', 16), 'Facturation du mois'),
      h('button', { class: 'btn', onClick: () => F.openInvoiceForm(p) }, icon('plus', 16), 'Facture'),
      h('button', { class: 'btn', onClick: () => F.openEntrepriseForm(p) }, icon('edit', 16), 'Modifier'))));
}

// Avant la date de début : compte à rebours + checklist de lancement
const CHECKLIST = [
  ['siret', 'Immatriculer l’entreprise (guichet unique) et noter le SIRET', 'Le SIRET est obligatoire sur les factures.'],
  ['compte', 'Ouvrir un compte bancaire dédié à l’activité', 'Obligatoire au-delà de 10 000 € de CA deux années de suite en micro ; conseillé dès le départ.'],
  ['rc', 'Souscrire une assurance responsabilité civile professionnelle', 'Souvent exigée par les clients en mission de conseil.'],
  ['tva', 'Choisir le régime de TVA (franchise ou réel)', 'Franchise : mention « TVA non applicable, art. 293 B du CGI » sur les factures.'],
  ['acre', 'Demander l’ACRE si tu y as droit (dans les 60 jours)', 'Depuis le 1er juillet 2026 : cotisations à 75 % du taux normal la 1re année.'],
  ['urssaf', 'Créer ton compte URSSAF et choisir mensuel / trimestriel', 'Première déclaration de CA dans les 90 jours suivant le début.'],
  ['facture', 'Choisir ta plateforme de facturation électronique (ex. Tiime)', 'Réception obligatoire dès sept. 2026, émission dès sept. 2027.'],
  ['mentions', 'Préparer le modèle de facture avec les mentions légales', 'Cockpit génère la facture imprimable avec les mentions.'],
  ['cfe', 'Déclarer la CFE avant le 31 décembre de l’année de création', 'Exonération la 1re année ; paiement dès l’année suivante.'],
];
function launchCard(p, m) {
  const done = m.checklist || {}, n = CHECKLIST.filter(([k]) => done[k]).length;
  const days = daysBetween(S.today, m.date_debut);
  const toggle = (k, v) => { const meta = { ...(p.meta || {}), checklist: { ...(p.meta && p.meta.checklist || {}), [k]: v } }; ops([upsert('projet', { ...p, meta })]); };
  return h('div', { class: 'card ent-launch' }, h('header', null, h('h2', null, 'Pas encore démarrée'), h('span', { class: 'sub' }, `${days} jour${days > 1 ? 's' : ''} avant le début (${fmtDate(m.date_debut)})`), h('div', { class: 'right' }, pill(n === CHECKLIST.length ? 'good' : 'info', `${n}/${CHECKLIST.length} prêt`, n === CHECKLIST.length ? 'check' : 'info'))),
    h('div', { class: 'ent-count' }, h('b', { class: 'num' }, days), h('span', null, days > 1 ? 'jours' : 'jour'), h('i', null)),
    h('div', { class: 'ent-check' }, CHECKLIST.map(([k, label, hint]) => { const cb = h('input', { type: 'checkbox', checked: !!done[k] }); cb.addEventListener('change', () => toggle(k, cb.checked));
      return h('label', null, cb, h('span', null, h('b', null, label), h('small', null, hint))); })));
}

function kpis(p, m, fy, fin, year) {
  const waiting = sum(F.invoicesOf(p).filter((i) => i.statut === 'Envoyée'), (i) => i.ttc * rateOf(i.devise));
  const nWait = F.invoicesOf(p).filter((i) => i.statut === 'Envoyée').length;
  const isSoc = m.regimeIR === 'is';
  return h('div', { class: 'kpis' },
    kpi({ title: `CA encaissé ${year}`, ic: 'check', value: eur0(fy.paid), sub: [h('span', null, `${eur0(fy.billed)} facturés · ${eur0(fy.planned)} planifiés`)] }),
    kpi({ title: 'En attente de paiement', ic: 'calendar', value: eur0(waiting), sub: [h('span', null, `${nWait} facture${nWait > 1 ? 's' : ''} envoyée${nWait > 1 ? 's' : ''} (TTC)`)] }),
    kpi({ title: 'À mettre de côté', ic: 'bank', value: eur0(fin.resteAMettreDeCote), sub: [h('span', null, `${eur0(fin.total)} estimés${fin.payeDeja ? ` − ${eur0(fin.payeDeja)} déjà payés` : ''}`), fin.estimated ? h('span', { class: 'pill mute' }, 'estimation') : null] }),
    kpi({ title: isSoc ? 'Résultat net de la société' : 'Revenu net estimé', ic: 'wallet', value: h('span', { class: fin.resultatNet < 0 ? 'neg' : '' }, eur0(fin.resultatNet)),
      sub: [h('span', null, isSoc && fin.dividendes ? `dont ${eur0(fin.dividendes.mesParts)} de dividendes pour moi` : m.regimeIR === 'micro' ? 'après cotisations et impôt estimés' : 'après cotisations et impôt estimés')] }));
}
const rateOf = (cur) => (cur === 'EUR' || !cur ? 1 : cur === 'MAD' ? S.P.taux : (S.fx && S.fx[cur]) || 1);

function plafondCard(p, m, fy, year) {
  const hasMicro = fy.plafondCA != null, hasTva = fy.tvaSeuil != null;
  const body = [];
  if (!hasMicro && !hasTva) {
    body.push(h('div', { class: 'muted' }, m.regimeIR === 'is' ? 'Société à l’IS avec TVA : pas de plafond de CA. Les seuils de franchise de TVA ne s’appliquent pas.' : 'Pas de plafond de CA dans ce régime.'));
    return h('div', { class: 'card' }, h('header', null, h('h2', null, `Plafonds ${year}`)), ...body);
  }
  const scale = Math.max((fy.plafondCA || fy.tvaSeuilMaj) * 1.1, fy.total * 1.04, 1);
  const w = (v) => Math.min(100, (v / scale) * 100) + '%';
  const mk = (v, label, low) => h('div', { class: 'mk' + (low ? ' low' : ''), style: { left: (v / scale) * 100 + '%' } }, h('span', null, low ? `${label} ${eur0(v)}` : eur0(v)), h('em', null, label));
  let verdict;
  if (hasTva && fy.done >= fy.tvaSeuilMaj) verdict = pill('bad', 'TVA due immédiatement', 'alert');
  else if (hasTva && fy.done >= fy.tvaSeuil) verdict = pill('warn', 'Franchise de TVA dépassée', 'alert');
  else if (hasTva) verdict = pill('good', `Marge avant TVA : ${eur0(fy.tvaSeuil - fy.done)}`, 'check');
  else verdict = pill('good', `Marge avant plafond : ${eur0(Math.max(0, fy.plafondCA - fy.done))}`, 'check');
  const marks = [hasTva ? mk(fy.tvaSeuil, 'franchise TVA') : null, hasTva ? mk(fy.tvaSeuilMaj, 'TVA majorée', true) : null, hasMicro ? mk(fy.plafondCA, 'plafond micro') : null];
  return h('div', { class: 'card' }, h('header', null, h('h2', null, `Plafonds ${year}`), h('span', { class: 'sub' }, `CA HT encaissé et facturé`), h('div', { class: 'right' }, verdict)),
    h('div', { class: 'thr' }, h('div', { class: 'track' }, h('div', { class: 'seg1', style: { width: w(fy.paid) } }), h('div', { class: 'seg2', style: { width: w(fy.billed) } }), h('div', { class: 'seg3', style: { width: w(fy.planned) } })), ...marks),
    h('div', { class: 'legend', style: { flexWrap: 'wrap' } }, h('span', null, h('i', { style: { background: 'var(--flow-in)' } }), `Encaissé ${eur0(fy.paid)}`), h('span', null, h('i', { style: { background: 'var(--flow-out)' } }), `Facturé en attente ${eur0(fy.billed)}`),
      h('span', null, h('i', { style: { background: 'repeating-linear-gradient(135deg,var(--flow-out) 0 3px,transparent 3px 6px)', border: '1px solid var(--flow-out)' } }), `Planifié ${eur0(fy.planned)}`), h('span', { style: { fontWeight: 700 } }, `Total projeté ${eur0(fy.total)}`)),
    hasMicro && fy.total > fy.plafondCA ? h('div', { class: 'infobox', style: { marginTop: '12px' } }, `Avec les factures planifiées, ${year} atteint ${eur0(fy.total)} : ${eur0(fy.total - fy.plafondCA)} au-dessus du plafond micro. Un dépassement isolé ne fait pas sortir du régime micro ; deux années consécutives, si. Fais valider le passage en société (EURL/SASU) avec un expert-comptable.`) : null,
    h('div', { class: 'note', style: { marginTop: '10px' } }, fy.factor < 1 ? `Première année : plafond et seuils proratisés (× ${(fy.factor * 100).toFixed(0)} % = ${Math.round(fy.factor * 365)} jours sur 365). ` : '', fy.estime ? 'Seuils ' + year + ' reconduits de l’année précédente (à confirmer). ' : '', 'Seuls les clients « compte dans le plafond » sont comptés.'));
}

function chargesCard(p, m, fin, year) {
  const R = E.rulesFor(year);
  const rows = fin.details.map((d) => h('div', { class: 'cashrow' }, h('div', null, h('b', null, d.label), d.note ? h('span', { class: 'sub' }, d.note) : null), h('div', { class: 'num v' }, eur0(d.amount))));
  const total = h('div', { class: 'cashrow total' }, h('div', null, h('b', null, m.regimeIR === 'is' ? 'À mettre de côté dans la société' : 'Total estimé à mettre de côté'),
    h('span', { class: 'sub' }, fin.payeDeja ? `déjà payé ${eur0(fin.payeDeja)} → reste ${eur0(fin.resteAMettreDeCote)}` : 'rien payé pour l’instant')), h('div', { class: 'num v' }, eur0(fin.total)));
  const div = fin.dividendes ? h('div', { class: 'ent-div' }, h('div', { class: 'grp' }, 'Dividendes et flat tax (mes parts)'),
    h('div', { class: 'kv' }, h('span', null, 'Résultat net de la société'), h('b', null, eur0(fin.resultatNet))),
    h('div', { class: 'kv' }, h('span', null, 'Distribuable (après réserve légale)'), h('b', null, eur0(fin.dividendes.distribuable))),
    h('div', { class: 'kv' }, h('span', null, `Dividendes qui me reviennent (${Math.round(fin.part * 100)} %)`), h('b', null, eur0(fin.dividendes.mesParts))),
    h('div', { class: 'kv' }, h('span', null, `Flat tax ${(fin.dividendes.flatTax.taux * 100).toFixed(1).replace('.', ',')} %`), h('b', null, '− ' + eur0(fin.dividendes.flatTax.total))),
    fin.dividendes.cotisationsExcedent10pct > 0 ? h('div', { class: 'kv' }, h('span', null, 'Cotisations sur dividendes > 10 % du capital'), h('b', null, '− ' + eur0(fin.dividendes.cotisationsExcedent10pct))) : null,
    h('div', { class: 'kv' }, h('span', null, 'Net dans ma poche'), h('b', null, eur0(fin.dividendes.net)))) : null;
  return h('div', { class: 'card' }, h('header', null, h('h2', null, 'Charges et impôts estimés'), h('span', { class: 'sub' }, year), h('div', { class: 'right' }, pill(R.statut === 'estime' || fin.estimated ? 'warn' : 'good', R.statut === 'estime' ? `taux ${year} reconduits` : fin.estimated ? 'estimation' : 'taux officiels'))),
    fin.ca > 0 || fin.details.length ? h('div', { class: 'cashlist' }, rows, total) : h('div', { class: 'muted' }, 'Aucun encaissement pour l’instant : les estimations apparaissent dès le premier paiement reçu.'),
    div, fin.notes.length ? h('div', { class: 'note', style: { marginTop: '10px' } }, fin.notes.join(' ')) : null,
    h('div', { class: 'note' }, 'Estimation indicative (taux ', R.source.split(',')[0], '). À valider avec ton expert-comptable ; l’impôt exact est dans l’écran Impôt.'));
}

function monthlyCard(p, m, fy, year) {
  const hasPlaf = fy.plafondCA != null;
  const rows = fy.months.filter((mo) => mo.facture || mo.encaisse || mo.planifie || mo.month <= S.today.slice(0, 7));
  const body = rows.length ? h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Mois'), h('th', { class: 'r' }, 'Facturé'), h('th', { class: 'r' }, 'Encaissé'), h('th', { class: 'r' }, 'Planifié'), h('th', { class: 'r' }, 'Encaissé cumulé'), hasPlaf ? h('th', { class: 'r' }, 'Reste avant plafond') : null)),
    h('tbody', null, fy.months.map((mo) => h('tr', { class: mo.month > S.today.slice(0, 7) && !mo.planifie ? 'dim' : '', onClick: () => F.openBilling(p, mo.month), style: { cursor: 'pointer' } },
      h('td', null, monthLong(mo.month).split(' ')[0]), h('td', { class: 'r num' }, mo.facture ? eur0(mo.facture) : '·'), h('td', { class: 'r num' }, mo.encaisse ? eur0(mo.encaisse) : '·'), h('td', { class: 'r num' }, mo.planifie ? eur0(mo.planifie) : '·'),
      h('td', { class: 'r num' }, mo.cumul ? eur0(mo.cumul) : '·'), hasPlaf ? h('td', { class: 'r num' }, eur0(Math.max(0, fy.plafondCA - mo.cumul))) : null))),
    h('tfoot', null, h('tr', null, h('td', null, 'Année'), h('td', { class: 'r num' }, eur0(sum(fy.months, (x) => x.facture))), h('td', { class: 'r num' }, eur0(fy.paid)), h('td', { class: 'r num' }, eur0(fy.planned)), h('td', { class: 'r num' }, eur0(fy.paid)), hasPlaf ? h('td', { class: 'r num' }, eur0(Math.max(0, fy.plafondCA - fy.paid))) : null)))
    : empty('Rien à afficher', '');
  return h('div', { class: 'card' }, h('header', null, h('h2', null, `Suivi mensuel ${year}`), h('span', { class: 'sub' }, 'facturation, encaissement — clique un mois pour facturer')), h('div', { class: 'gridwrap' }, body));
}

// ───────────────────────── planning de déclarations ─────────────────────────
function declRow(p, d, { showNom = false } = {}) {
  const rec = (S.data.declarations || []).find((r) => (r.projetId || '') === (d.projetId || '') && r.code === d.code && r.periode === d.periode);
  const inDays = daysBetween(S.today, d.date), late = inDays < 0 && !rec;
  const status = rec ? pill('good', rec.statut === 'paye' ? 'Payé' : 'Fait', 'check') : late ? pill('bad', `En retard de ${-inDays} j`, 'alert') : inDays <= 7 ? pill('warn', inDays === 0 ? 'Aujourd’hui' : `Dans ${inDays} j`, 'calendar') : pill('mute', `Dans ${inDays} j`);
  const btns = rec ? h('button', { class: 'btn sm ghost', title: 'Remettre à faire', onClick: () => F.markDeclaration(p, d, null, rec) }, icon('undo', 14))
    : [d.kind === 'paiement' ? h('button', { class: 'btn sm primary', onClick: () => F.markDeclaration(p, d, 'paye') }, icon('check', 14), 'Payé') : null, h('button', { class: 'btn sm', onClick: () => F.markDeclaration(p, d, 'fait') }, icon('check', 14), 'Fait')];
  return h('div', { class: 'ent-decl-row' + (late ? ' late' : rec ? ' done' : '') }, h('div', { class: 'dt' }, h('b', null, fmtDate(d.date).replace(/ \d{4}$/, '')), h('span', null, d.date.slice(0, 4))),
    h('div', { class: 'tx' }, h('b', null, d.label), h('small', null, [showNom ? d.nom : null, d.approx ? 'date indicative' : null, d.conditional ? 'si applicable' : null, d.note].filter(Boolean).join(' · '))),
    h('div', { class: 'st' }, status), h('div', { class: 'ac' }, btns));
}
function planningCard(p, m, year) {
  const Y = +year;
  const all = [...E.deadlinesFor(p, Y, S), ...(Y === +S.today.slice(0, 4) ? E.deadlinesFor(p, Y + 1, S).filter((d) => daysBetween(S.today, d.date) <= 60) : [])]
    .filter((d, i, a) => a.findIndex((x) => x.code === d.code && x.periode === d.periode) === i).sort((a, b) => (a.date < b.date ? -1 : 1));
  const isDone = (d) => (S.data.declarations || []).some((r) => (r.projetId || '') === (d.projetId || '') && r.code === d.code && r.periode === d.periode);
  const shown = all.filter((d) => !(st.hideDone && (isDone(d) || (daysBetween(S.today, d.date) < -30 && d.conditional))) && !(m.date_debut && d.date < m.date_debut));
  const t = h('input', { type: 'checkbox', checked: st.hideDone }); t.addEventListener('change', () => { st.hideDone = t.checked; save(); emit(); });
  const list = shown.length ? h('div', { class: 'ent-decl' }, shown.map((d) => declRow(p, d))) : h('div', { class: 'muted' }, all.length ? 'Tout est à jour pour cette année.' : 'Aucune échéance pour cette année (l’activité n’a pas encore démarré).');
  return h('div', { class: 'card' }, h('header', null, h('h2', null, `Planning de déclarations ${year}`), h('span', { class: 'sub' }, E.FORMES[m.forme].short), h('div', { class: 'right' }, h('label', { class: 'split', style: { fontSize: '13px', color: 'var(--ink-2)', fontWeight: 600 } }, t, 'Masquer les faites'))),
    list, h('div', { class: 'note', style: { marginTop: '10px' } }, 'Dates calculées selon ton régime (report au jour ouvré suivant, jours fériés non pris en compte). Coche « Fait » ou « Payé » : le statut est enregistré et les rappels s’arrêtent. Les dates marquées « indicatives » dépendent de ton département / SIREN : vérifie-les sur impots.gouv.fr ou urssaf.fr.'));
}

// ───────────────────────── factures ─────────────────────────
const statutPill = (i) => i.statut === 'Payée' ? pill('good', 'Payée', 'check') : i.statut === 'Envoyée' ? pill('info', 'Envoyée', 'send') : pill('mute', 'Planifiée', 'calendar');
function invoicesCard(p, m, year) {
  const rows = F.invoicesOf(p).filter((i) => i.periode.slice(0, 4) === String(year) || (i.emission || '').slice(0, 4) === String(year)).sort((a, b) => (a.periode < b.periode ? 1 : a.periode > b.periode ? -1 : a.client.localeCompare(b.client)));
  const tbl = rows.length ? h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['N°', 'Client', 'Mois', 'Prestation', 'HT', 'TTC', 'Statut', ''].map((x, i) => h('th', { class: i === 4 || i === 5 ? 'r' : '' }, x)))),
    h('tbody', null, rows.map((i) => h('tr', { class: 'click', onClick: () => F.openInvoiceForm(p, i) },
      h('td', { class: 'num' }, i.numero, i.refExt ? h('span', { class: 'sub' }, i.refExt) : null), h('td', null, i.client, i.emission ? h('span', { class: 'sub' }, `Émise le ${fmtDate(i.emission)}${i.paiement ? ` · payée le ${fmtDate(i.paiement)}` : ''}`) : null), h('td', null, monthLong(i.periode).split(' ')[0]),
      h('td', { class: 'muted num' }, `${i.jours} j × ${num0(i.tjm)} ${i.devise === 'EUR' ? '€' : i.devise}`), h('td', { class: 'r num' }, money(i.ht, i.devise)), h('td', { class: 'r num' }, money(i.ttc, i.devise), i.tva ? h('span', { class: 'sub' }, `TVA ${Math.round(i.tva * 100)} %`) : null),
      h('td', null, statutPill(i)),
      h('td', { class: 'r', style: { whiteSpace: 'nowrap' }, onClick: (e) => e.stopPropagation() },
        h('button', { class: 'btn sm ghost', title: 'Voir / imprimer la facture', onClick: () => F.openInvoicePrint(p, i) }, icon('file', 14)), ' ',
        i.statut === 'Planifiée' ? h('button', { class: 'btn sm', onClick: () => F.sendInvoice(i) }, icon('send', 14), 'Marquer envoyée') : i.statut === 'Envoyée' ? h('button', { class: 'btn sm primary', onClick: () => F.payInvoice(p, i) }, icon('check', 14), 'Paiement reçu') : h('button', { class: 'btn sm ghost', title: 'Annuler le paiement', onClick: () => F.unpayInvoice(i) }, icon('undo', 14))))))) : empty(`Aucune facture en ${year}`, 'Utilise « Facturation du mois » pour créer la première.');
  const csv = () => { const blob = new Blob([E.invoiceCsv(p, rows)], { type: 'text/csv;charset=utf-8' }); const a = h('a', { href: URL.createObjectURL(blob), download: `factures_${p.nom.replace(/\W+/g, '_')}_${year}.csv` }); document.body.append(a); a.click(); a.remove(); };
  return h('div', { class: 'card' }, h('header', null, h('h2', null, 'Factures'), h('span', { class: 'sub' }, `${rows.length} en ${year}`), h('div', { class: 'right' }, rows.length ? h('button', { class: 'btn sm', onClick: csv }, icon('download', 14), 'CSV') : null, h('button', { class: 'btn', onClick: () => F.openInvoiceForm(p) }, icon('plus', 16), 'Nouvelle facture'))), tbl);
}
function clientsCard(p) {
  const cl = F.clientsOf(p);
  return h('div', { class: 'card' }, h('header', null, h('h2', null, 'Clients'), h('div', { class: 'right' }, h('button', { class: 'btn sm', onClick: () => F.openClientForm(p) }, icon('plus', 15), 'Client'))),
    cl.length ? h('table', { class: 'tbl' }, h('tbody', null, cl.map((c) => h('tr', { class: 'click', onClick: () => F.openClientForm(p, c) },
      h('td', null, c.nom, h('span', { class: 'sub' }, c.micro === 'Oui' ? 'Compte dans le plafond' : 'Hors plafond')), h('td', { class: 'r num' }, `${num0(c.tjm)} ${c.devise === 'EUR' ? '€' : c.devise} / j`), h('td', { class: 'r muted' }, c.tva ? `TVA ${Math.round(c.tva * 100)} %` : 'Sans TVA'))))) : empty('Aucun client', 'Ajoute un client avec son TJM : la facturation du mois s’en sert.'));
}

// ───────────────────────── facturation électronique / Tiime ─────────────────────────
function einvoiceCard(p, m) {
  const t = S.today, recep = '2026-09-01', emis = '2027-09-01';
  const row = (ok, title, sub) => h('div', { class: 'ent-ei' }, h('i', { class: ok ? 'ok' : '' }, icon(ok ? 'check' : 'calendar', 13)), h('div', null, h('b', null, title), h('small', null, sub)));
  return h('div', { class: 'card' }, h('header', null, h('h2', null, 'Facturation électronique'), h('span', { class: 'sub' }, 'obligation et Tiime')),
    row(t >= recep, 'Recevoir des factures électroniques', t >= recep ? 'Obligatoire pour toutes les entreprises depuis le 1er septembre 2026.' : `Obligatoire pour toutes les entreprises dès le 1er septembre 2026 (dans ${daysBetween(t, recep)} jours).`),
    row(t >= emis, 'Émettre des factures électroniques', t >= emis ? 'Obligatoire pour les micro et PME depuis le 1er septembre 2027.' : `Obligatoire pour les micro-entreprises et PME dès le 1er septembre 2027 (dans ${daysBetween(t, emis)} jours) : factures via une plateforme agréée + e-reporting.`),
    h('div', { class: 'infobox', style: { marginTop: '12px' } }, h('b', null, 'Connexion Tiime : '), 'Tiime est une plateforme agréée, mais n’ouvre pas d’API publique : son API est réservée aux éditeurs partenaires sur demande. Cockpit ne peut donc pas se connecter à ton compte Tiime (et ne fait pas semblant). Ce qui fonctionne : préparer la facture ici (jours × TJM, mentions légales), « Copier pour Tiime » pour la recopier, puis noter la référence de la facture émise (champ « Référence sur la plateforme ») pour la retrouver.'),
    h('div', { class: 'row-actions', style: { marginTop: '10px' } }, h('a', { class: 'btn', href: 'https://www.tiime.fr/', target: '_blank', rel: 'noopener noreferrer' }, icon('link', 15), 'Ouvrir Tiime'),
      h('a', { class: 'btn ghost', href: 'https://www.economie.gouv.fr/tout-savoir-sur-la-facturation-electronique-pour-les-entreprises', target: '_blank', rel: 'noopener noreferrer' }, icon('info', 15), 'Calendrier officiel')));
}

// ───────────────────────── liens de notification ─────────────────────────
// #/entreprise?inv=<id> ouvre la facture ; #/entreprise?jours=AAAA-MM ouvre la facturation du mois
export function onArgs(a) {
  const list = entreprises();
  if (a.inv) {
    const i = (S.data.invoices || []).find((x) => x.id === a.inv);
    const p = i && (list.find((x) => x.id === i.projetId) || list[0]);
    if (i && p) { st.projetId = p.id; save(); emit(); F.openInvoiceForm(p, i); }
  } else if (a.jours) {
    const p = cur() || list[0];
    if (p) { st.projetId = p.id; save(); emit(); F.openBilling(p, a.jours); }
  }
}
