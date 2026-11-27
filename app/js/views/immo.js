import { h, icon, eur, mad, num0, pct, monthsBetween, monthShort, monthLong, monthEnd, addMonths, fmtDate, sum, clear, CUR_CODES } from '../util.js';
import { S, ops, upsert, del, todayMonth, emit, savePrefs, isMine, projetsVisibles, immoProjets, membershipOf, partOf, projetOfLot } from '../state.js';
import { sb } from '../supa.js';
import { txs, rentCell, tenancyFor, activeTenants, summarize } from '../calc.js';
import { modal, field, select, confirmBox, empty, toast, segmented } from '../ui.js';
import { openTxForm } from '../txform.js';
import { kpi, catChip, amountEl } from './common.js';
import { barList } from '../charts.js';

export function meta() { const p = curProjet(); return { title: p ? p.nom : 'Immobilier', sub: p ? (isMine(p) ? 'Projet immobilier' : `Partagé avec toi en lecture seule`) : 'Tous tes projets immobiliers', immoToggle: true }; }

// ---------- projet sélectionné ('' = tous) ----------
const curProjet = () => (S.immoProjet && immoProjets().find((p) => p.id === S.immoProjet)) || null;
const inScope = (pid) => { const p = curProjet(); return !p || pid === p.id; };
const scopeLots = () => S.lots.filter((l) => inScope(l.projetId));
const ownProjets = () => immoProjets().filter(isMine);
export function badge() { return 0; }

const toMad = (t) => (t.devise === 'MAD' ? t.montant : t.montantEur / S.P.taux);
// « Ma part » : chaque montant est pondéré par la part de SON projet (aucune part globale) ; « Total » : 100 %
const wOf = (projetId) => (S.immoView === 'full' ? 1 : partOf(projetId));
const madW = (t) => toMad(t) * wOf(t.projetId);
const shortLot = (l) => l.replace(/^\d+\.\s*/, '');
const lotCode = (l) => (l.match(/^(\d+)\./) || [, ''])[1];
const showOld = { v: false };

// ---------- encaissement ----------
function tenantChargesCollected(tenant, month) {
  return S.data.tx.some((t) => t.activite === 'Immobilier' && t.categorie === 'Charges refacturées' && t.periode === month && (t.tiers === tenant.nom || t.lot === tenant.lot) && t.sens === 'Revenu');
}
function rentTxs(tenant, month, loyer, charges, date) {
  const base = { activite: 'Immobilier', sens: 'Revenu', devise: 'MAD', date, periode: month, tiers: tenant.nom, lot: tenant.lot, nature: 'Courant', projetId: tenant.projetId || projetOfLot(tenant.lot) };
  const out = [];
  // référence unique (anti-doublon entre appareils) ; un complément de loyer reçoit un suffixe
  const refs = new Set(S.data.tx.map((t) => t.ref));
  const ref = (p) => { let r = `${p}${tenant.id}:${month}`, n = 2; while (refs.has(r)) r = `${p}${tenant.id}:${month}:${n++}`; return r; };
  if (loyer > 0) out.push(upsert('tx', { ...base, categorie: 'Loyer', libelle: `Loyer ${monthLong(month)} — ${tenant.nom}`, montant: loyer, ref: ref('LOY') }));
  if (charges > 0) out.push(upsert('tx', { ...base, categorie: 'Charges refacturées', detail: 'Eau, électricité, ménage', libelle: `Charges ${monthLong(month)} — ${tenant.nom}`, montant: charges, ref: ref('CHG') }));
  return out;
}
export function openCollect(lot, month) {
  const c = rentCell(lot, month), ten = c.tenant;
  if (!ten) return toast('Aucun locataire sur ce lot pour ce mois.', 'error');
  if (!isMine(ten)) return toast('Projet partagé en lecture seule.', 'error');
  const remaining = Math.max(0, ten.loyer - c.paid);
  const chargesDue = tenantChargesCollected(ten, month) ? 0 : ten.charges;
  const loyer = h('input', { type: 'text', inputmode: 'decimal', value: String(remaining).replace('.', ','), class: 'amount num', style: { height: '56px', fontSize: '26px !important' } });
  const charges = h('input', { type: 'text', inputmode: 'decimal', value: String(chargesDue).replace('.', ',') });
  const date = h('input', { type: 'date', value: month === todayMonth() ? S.today : month < todayMonth() ? monthEnd(month) : S.today });
  const total = h('div', { class: 'muted num' });
  const upd = () => { const a = parseFloat(loyer.value.replace(',', '.')) || 0, b = parseFloat(charges.value.replace(',', '.')) || 0; total.textContent = `Total encaissé : ${mad(a + b)} (≈ ${eur((a + b) * S.P.taux)})`; };
  loyer.addEventListener('input', upd); charges.addEventListener('input', upd); upd();
  const go = async () => {
    const a = parseFloat(loyer.value.replace(',', '.')) || 0, b = parseFloat(charges.value.replace(',', '.')) || 0;
    if (a + b <= 0) return toast('Saisis un montant.', 'error');
    if (await ops(rentTxs(ten, month, a, b, date.value), `Loyer de ${ten.nom} encaissé`)) m.close();
  };
  loyer.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  const m = modal({ title: `Encaisser le loyer`, sub: `${ten.nom} · ${shortLot(lot)} · ${monthLong(month)}`, width: 480,
    body: [h('div', { class: 'field' }, h('label', null, 'Loyer (MAD)'), loyer, h('div', { class: 'hint' }, `Loyer convenu : ${mad(ten.loyer)}${c.paid ? ` · déjà reçu : ${mad(c.paid)}` : ''}`)),
      h('div', { class: 'grid2' }, field('Charges eau / élec. / ménage (MAD)', charges), field('Date de réception', date)), total],
    footer: [h('button', { class: 'btn', onClick: () => { m.close(); openRelance(ten, month, Math.max(0, (c.expected || ten.loyer) - c.paid)); } }, icon('message', 16), 'Relancer'), h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'), h('button', { class: 'btn primary lg', onClick: go }, icon('check', 17), 'Encaisser')] });
  loyer.focus(); loyer.select();
}
export function openCollectAll(month) {
  const rows = [];
  for (const lot of scopeLots().filter(isMine)) {
    const c = rentCell(lot.nom, month);
    if (c.tenant && (c.status === 'due' || c.status === 'late' || c.status === 'part')) rows.push({ lot: lot.nom, ten: c.tenant, loyer: Math.max(0, c.tenant.loyer - c.paid), charges: tenantChargesCollected(c.tenant, month) ? 0 : c.tenant.charges, on: true });
  }
  if (!rows.length) return toast(`Tous les loyers de ${monthLong(month)} sont déjà encaissés 🎉`);
  const date = h('input', { type: 'date', value: month === todayMonth() ? S.today : month < todayMonth() ? monthEnd(month) : S.today });
  const totalEl = h('b', { class: 'num' });
  const upd = () => { totalEl.textContent = mad(sum(rows.filter((r) => r.on), (r) => r.loyer + r.charges)); };
  const list = h('table', { class: 'tbl' }, h('tbody', null, rows.map((r) => {
    const cb = h('input', { type: 'checkbox', checked: true }); cb.addEventListener('change', () => { r.on = cb.checked; upd(); });
    return h('tr', null, h('td', { style: { width: '30px' } }, cb), h('td', null, r.ten.nom, h('span', { class: 'sub' }, shortLot(r.lot))), h('td', { class: 'r num' }, mad(r.loyer), r.charges ? h('span', { class: 'sub' }, `+ ${mad(r.charges)} charges`) : null));
  })));
  upd();
  const go = async () => {
    const list = rows.filter((r) => r.on).flatMap((r) => rentTxs(r.ten, month, r.loyer, r.charges, date.value));
    if (!list.length) return;
    if (await ops(list, `${rows.filter((r) => r.on).length} loyer(s) encaissé(s)`)) m.close();
  };
  const m = modal({ title: `Encaisser les loyers de ${monthLong(month)}`, sub: 'Décoche ceux qui ne sont pas encore arrivés', width: 520,
    body: [list, field('Date de réception', date)],
    footer: [h('span', null, 'Total : ', totalEl), h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'), h('button', { class: 'btn primary lg', onClick: go }, icon('check', 17), 'Tout encaisser')] });
}
function openCellDetails(lot, month) {
  const c = rentCell(lot, month);
  const rows = c.txs.map((t) => h('tr', null, h('td', null, fmtDate(t.date)), h('td', null, t.libelle), h('td', { class: 'r' }, amountEl(t)),
    h('td', { class: 'r' }, h('button', { class: 'btn sm', onClick: () => { m.close(); openTxForm(t); } }, icon(isMine(t) ? 'edit' : 'info', 14), isMine(t) ? 'Modifier' : 'Voir'))));
  const m = modal({ title: `${shortLot(lot)} — ${monthLong(month)}`, sub: c.tenant ? `${c.tenant.nom} · loyer ${mad(c.tenant.loyer)}` : '', width: 560,
    body: [h('table', { class: 'tbl' }, h('tbody', null, rows)), c.status === 'part' ? h('div', { class: 'infobox' }, `Reste à encaisser : ${mad(c.expected - c.paid)}`) : null],
    footer: [h('span', { class: 'sp' }), c.status === 'part' && isMine(c.tenant) ? h('button', { class: 'btn primary', onClick: () => { m.close(); openCollect(lot, month); } }, 'Compléter le loyer') : null, h('button', { class: 'btn', onClick: () => m.close() }, 'Fermer')] });
}

// ---------- locataires ----------
function openTenantForm(t = {}) {
  const editing = !!t.id;
  const lotSel = select([{ value: '', label: '— Choisir —' }, ...scopeLots().filter(isMine).map((l) => ({ value: l.nom, label: l.nom }))], t.lot || '');
  const nom = h('input', { type: 'text', value: t.nom || '', placeholder: 'Prénom Nom' });
  const loyer = h('input', { type: 'number', value: t.loyer || '', min: 0, step: 50 });
  const charges = h('input', { type: 'number', value: t.charges ?? 150, min: 0, step: 5 });
  const entree = h('input', { type: 'date', value: t.entree || S.today });
  const sortie = h('input', { type: 'date', value: t.sortie || '' });
  const caution = h('input', { type: 'number', value: t.caution || '', min: 0, step: 50 });
  const contact = h('input', { type: 'text', value: t.contact || '' });
  const metier = h('input', { type: 'text', value: t.metier || '' });
  const note = h('textarea', null, t.note || '');
  lotSel.addEventListener('change', () => { const l = S.lots.find((x) => x.nom === lotSel.value); if (l && !loyer.value) loyer.value = l.loyer || ''; });
  const err = h('div', { class: 'err' });
  const save = async () => {
    if (!lotSel.value || !nom.value.trim()) { err.textContent = 'Le lot et le nom sont obligatoires.'; return; }
    const item = { id: t.id || 0, version: t.version, projetId: projetOfLot(lotSel.value), lot: lotSel.value, nom: nom.value.trim(), loyer: +loyer.value || 0, charges: +charges.value || 0, entree: entree.value, sortie: sortie.value, caution: +caution.value || 0, contact: contact.value.trim(), metier: metier.value.trim(), note: note.value.trim() };
    if (await ops([upsert('tenant', item)], editing ? 'Locataire modifié' : 'Locataire ajouté')) m.close();
  };
  const m = modal({ title: editing ? 'Modifier le locataire' : 'Nouveau locataire', width: 620,
    body: [h('div', { class: 'grid2' }, field('Lot', lotSel), field('Nom du locataire', nom)),
      h('div', { class: 'grid3' }, field('Loyer (MAD / mois)', loyer), field('Charges forfait (MAD)', charges, 'Eau, électricité, ménage'), field('Caution (MAD)', caution)),
      h('div', { class: 'grid2' }, field('Date d’entrée', entree), field('Date de sortie', sortie, 'Laisse vide si le locataire est toujours présent')),
      h('div', { class: 'grid2' }, field('Contact', contact), field('Métier', metier)), field('Note', note), err],
    footer: [editing ? h('button', { class: 'btn danger', onClick: async () => { if (await confirmBox('Supprimer ce locataire de la liste ? Les loyers déjà encaissés restent dans les opérations.', { ok: 'Supprimer', danger: true })) { if (await ops([del('tenant', t.id)], 'Locataire supprimé')) m.close(); } } }, icon('trash', 15), 'Supprimer') : null,
      h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'), h('button', { class: 'btn primary lg', onClick: save }, 'Enregistrer')] });
}
function openDeparture(t) {
  const d = h('input', { type: 'date', value: S.today });
  const m = modal({ title: `Départ de ${t.nom}`, sub: shortLot(t.lot), width: 440, body: [field('Date de sortie', d, 'Le lot apparaîtra vacant à partir du mois suivant.')],
    footer: [h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'), h('button', { class: 'btn primary', onClick: async () => { if (await ops([upsert('tenant', { ...t, sortie: d.value })], 'Départ enregistré')) m.close(); } }, 'Enregistrer le départ')] });
}

// ---------- page ----------
export function render() {
  const cur = todayMonth();
  const P = curProjet(), ro = P && !isMine(P);
  const lots = scopeLots();
  const list = txs({ activity: 'Immobilier' }).filter((t) => inScope(t.projetId));
  const loyers = sum(list.filter((t) => t.categorie === 'Loyer' && t.sens === 'Revenu'), madW);
  const charges = sum(list.filter((t) => t.categorie === 'Charges refacturées' && t.sens === 'Revenu'), madW);
  const revC = sum(list.filter((t) => t.nature === 'Courant' && t.sens === 'Revenu'), madW), depC = sum(list.filter((t) => t.nature === 'Courant' && t.sens === 'Dépense'), madW);
  const res = revC - depC;
  // occupation
  const occ = lots.filter((l) => rentCell(l.nom, cur).tenant).length;
  // impayés sur la période
  const months = monthsBetween(S.period.from, S.period.to).filter((m) => m <= cur);
  let unpaid = 0, unpaidN = 0, expectedTot = 0;
  for (const l of lots) for (const m of months) { const c = rentCell(l.nom, m); expectedTot += c.expected; if (c.status === 'late' || c.status === 'part' || (c.status === 'due')) { unpaid += (c.expected - c.paid) * wOf(l.projetId); unpaidN++; } }
  const kpis = h('div', { class: 'kpis' },
    kpi({ title: 'Loyers encaissés', ic: 'building', value: mad(loyers), sub: [h('span', null, `+ ${mad(charges)} de charges refacturées`)] }),
    kpi({ title: 'Taux d’occupation', ic: 'key', value: `${occ} / ${lots.length}`, sub: [h('span', { class: 'delta ' + (occ === lots.length ? 'good' : 'bad') }, pct(lots.length ? occ / lots.length : 0)), h('span', null, 'lots loués aujourd’hui')] }),
    kpi({ title: 'Loyers à récupérer', ic: 'alert', value: h('span', { class: unpaid > 0 ? 'neg' : 'pos' }, mad(unpaid)), sub: [unpaid > 0 ? h('span', null, `${unpaidN} loyer${unpaidN > 1 ? 's' : ''} manquant${unpaidN > 1 ? 's' : ''} sur la période`) : h('span', { class: 'delta good' }, 'Tout est encaissé')] }),
    kpi({ title: 'Résultat d’exploitation', ic: 'wallet', value: h('span', { class: res >= 0 ? '' : 'neg' }, (res > 0 ? '+' : '') + mad(res)), sub: [h('span', null, `≈ ${eur(res * S.P.taux)}${S.immoView === 'mine' ? ' (ma part)' : ''}`)] }));

  // grille des loyers
  const allMonths = monthsBetween(S.period.from, S.period.to);
  const gm = allMonths.slice(-15);
  const grid = h('table', { class: 'rent' });
  grid.append(h('thead', null, h('tr', null, h('th', null, 'Lot'), gm.map((m) => h('th', { style: m === cur ? { background: 'var(--info-bg)', color: 'var(--info-ink)' } : null }, monthShort(m), h('div', { style: { fontWeight: 500, opacity: .7 } }, m.slice(2, 4)))))));
  const tb = h('tbody');
  for (const l of lots) {
    const cT = tenancyFor(l.nom, cur);
    const tr = h('tr', null, h('td', { class: 'lot' }, h('b', null, `${lotCode(l.nom)} · ${shortLot(l.nom)}`), h('span', null, cT ? cT.nom : 'Vacant')));
    for (const m of gm) {
      const c = rentCell(l.nom, m);
      const txt = { paid: [num0(c.paid), 'payé'], part: [num0(c.paid), `sur ${num0(c.expected)}`], late: ['—', 'impayé'], due: [num0(c.expected), 'à encaisser'], vac: ['·', ''], fut: ['', ''] }[c.status];
      const clickable = ['due', 'late', 'part', 'paid'].includes(c.status) && (c.tenant || c.paid > 0) && (isMine(l) || c.paid > 0);
      const cell = h('div', { class: 'c ' + c.status, title: c.tenant ? `${c.tenant.nom} — loyer ${mad(c.tenant.loyer)}` : '', onClick: clickable ? () => (c.status === 'paid' ? openCellDetails(l.nom, m) : c.status === 'part' ? openCellDetails(l.nom, m) : isMine(l) ? openCollect(l.nom, m) : openCellDetails(l.nom, m)) : null }, txt[0], txt[1] ? h('small', null, txt[1]) : null);
      tr.append(h('td', { class: 'cell' }, cell));
    }
    tb.append(tr);
  }
  grid.append(tb);
  grid.append(h('tfoot', null, h('tr', null, h('td', { style: { textAlign: 'left' } }, 'Encaissé / attendu'), gm.map((m) => {
    let p = 0, e = 0; for (const l of lots) { const c = rentCell(l.nom, m); p += c.paid; e += c.expected; }
    return h('td', { class: 'num' }, num0(p), h('div', { class: 'muted', style: { fontWeight: 500, fontSize: '11px' } }, e ? '/ ' + num0(e) : ''));
  }))));
  const gridCard = h('div', { class: 'card' },
    h('header', null, h('h2', null, 'Suivi des loyers'), h('span', { class: 'sub' }, 'clique sur une case pour encaisser'),
      ro || !lots.some(isMine) ? null : h('div', { class: 'right' }, h('button', { class: 'btn primary', onClick: () => openCollectAll(cur) }, icon('check', 16), `Encaisser les loyers de ${monthLong(cur).split(' ')[0]}`))),
    (() => { const w = h('div', { class: 'gridwrap' }, grid); requestAnimationFrame(() => { w.scrollLeft = w.scrollWidth; }); return w; })(),
    h('div', { class: 'legend', style: { marginTop: '12px', flexWrap: 'wrap' } },
      h('span', null, h('i', { style: { background: 'var(--good-bg)', border: '1px solid var(--good)' } }), 'Payé'), h('span', null, h('i', { style: { background: 'var(--warn-bg)', border: '1px solid var(--warn)' } }), 'Partiel / à encaisser'),
      h('span', null, h('i', { style: { background: 'var(--crit-bg)', border: '1px solid var(--crit)' } }), 'Impayé'), allMonths.length > gm.length ? h('span', { class: 'muted' }, `Affichage des ${gm.length} derniers mois de la période`) : null));

  // locataires
  const tenants = [...S.data.tenants].filter((t) => inScope(t.projetId || projetOfLot(t.lot))).filter((t) => showOld.v || (!t.sortie || t.sortie >= S.today)).sort((a, b) => (a.lot.localeCompare(b.lot)) || ((b.entree || '').localeCompare(a.entree || '')));
  const nAct = activeTenants().filter((t) => inScope(t.projetId || projetOfLot(t.lot))).length;
  const tCard = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Locataires'), h('span', { class: 'sub' }, `${nAct} actif${nAct > 1 ? 's' : ''}`),
    h('div', { class: 'right' }, h('label', { class: 'split', style: { fontSize: '13px', color: 'var(--ink-2)', fontWeight: 600 } }, (() => { const c = h('input', { type: 'checkbox', checked: showOld.v }); c.addEventListener('change', () => { showOld.v = c.checked; emit(); }); return c; })(), 'Anciens'),
      ro ? null : h('button', { class: 'btn', onClick: () => openTenantForm() }, icon('plus', 16), 'Nouveau locataire'))),
    tenants.length ? h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Lot', 'Locataire', 'Loyer', 'Charges', 'Entrée', 'Caution', 'Contact', ''].map((x, i) => h('th', { class: i >= 2 && i <= 3 || i === 5 ? 'r' : '' }, x)))),
      h('tbody', null, tenants.map((t) => { const active = !t.sortie || t.sortie >= S.today;
        return h('tr', { class: (isMine(t) ? 'click' : '') + (active ? '' : ' dim'), onClick: () => { if (isMine(t)) openTenantForm(t); } }, h('td', null, shortLot(t.lot)), h('td', null, t.nom, !active ? h('span', { class: 'sub' }, `Parti le ${fmtDate(t.sortie)}`) : t.sortie ? h('span', { class: 'sub' }, `Sortie prévue le ${fmtDate(t.sortie)}`) : null),
          h('td', { class: 'r num' }, mad(t.loyer)), h('td', { class: 'r num' }, t.charges ? mad(t.charges) : '—'), h('td', null, fmtDate(t.entree)), h('td', { class: 'r num' }, t.caution ? mad(t.caution) : '—'), h('td', { class: 'muted' }, t.contact || ''),
          h('td', { class: 'r', style: { whiteSpace: 'nowrap' } }, (() => { const u = active && isMine(t) ? unpaidOf(t) : []; return u.length ? h('button', { class: 'btn sm', title: 'Relancer par SMS / WhatsApp', onClick: (e) => { e.stopPropagation(); openRelance(t, u[0].month, u.reduce((s, x) => s + x.amount, 0)); } }, icon('message', 14), 'Relancer') : null; })(), ' ', active && !t.sortie && isMine(t) ? h('button', { class: 'btn sm', onClick: (e) => { e.stopPropagation(); openDeparture(t); } }, 'Départ') : null)); }))) : empty('Aucun locataire', 'Ajoute ton premier locataire.'));

  // dépenses du projet
  const m = new Map();
  for (const t of list) if (t.nature === 'Courant' && t.sens === 'Dépense') m.set(t.categorie, (m.get(t.categorie) || 0) + madW(t));
  const dep = [...m.entries()].sort((a, b) => b[1] - a[1]);
  const depCard = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Charges d’exploitation'), h('span', { class: 'sub' }, 'sur la période')),
    dep.length ? barList(dep.map(([l, v]) => ({ label: l, value: v })), { fmt: mad, total: depC }) : empty('Aucune charge', ''));

  // projet en chiffres (toutes périodes)
  const all = S.data.tx.filter((t) => t.activite === 'Immobilier' && inScope(t.projetId));
  const invNet = sum(all.filter((t) => t.nature === 'Investissement'), (t) => (t.sens === 'Dépense' ? 1 : -1) * madW(t));
  const treso = sum(all, (t) => (t.sens === 'Revenu' ? 1 : -1) * madW(t));
  const debt = sum(all.filter((t) => t.categorie === 'Prêt reçu'), madW) - sum(all.filter((t) => t.categorie === 'Remboursement prêt'), madW);
  const since = addMonths(cur, -11) + '-01';
  const loy12 = sum(all.filter((t) => t.categorie === 'Loyer' && t.sens === 'Revenu' && t.date >= since), madW);
  const stat = (l, v, s) => h('div', null, h('div', { class: 'muted', style: { fontSize: '12px', fontWeight: 650 } }, l), h('div', { class: 'num', style: { fontSize: '20px', fontWeight: 700 } }, v), s ? h('div', { class: 'muted num', style: { fontSize: '12px' } }, s) : null);
  const projCard = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Le projet en chiffres'), h('span', { class: 'sub' }, 'depuis l’acquisition')),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '18px' } },
      stat('Investi (acquisition + travaux)', mad(invNet), `≈ ${eur(invNet * S.P.taux)}`),
      stat('Rendement brut (12 mois)', invNet > 0 ? pct(loy12 / invNet, 1) : '—', `${mad(loy12)} de loyers`),
      stat('Trésorerie du projet', mad(treso), `≈ ${eur(treso * S.P.taux)}`),
      stat('Dettes restantes', mad(debt), debt <= 0.5 ? 'Tous les prêts sont remboursés' : 'Prêts non remboursés')));

  return [projectsBar(), kpis, gridCard, h('div', { class: 'row2' }, tCard, h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } }, projCard, depCard))];
}

// ---------- Projets : barre de sélection, fiches, partage ----------
function projectsBar() {
  const list = projetsVisibles(), P = curProjet();
  const chip = (id, label, extra) => h('button', { type: 'button', class: 'pchip' + ((S.immoProjet || '') === id ? ' on' : ''), onClick: () => { S.immoProjet = id; savePrefs(); emit(); } }, label, extra);
  const head = h('div', { class: 'pbar' },
    chip('', 'Tous les projets'),
    list.map((p) => chip(p.id, p.nom, isMine(p) ? null : h('span', { class: 'pill mute', title: 'Partagé avec toi (lecture seule)' }, icon('user', 12), 'partagé'))),
    h('button', { type: 'button', class: 'pchip add', onClick: () => openProjet() }, icon('plus', 14), 'Nouveau projet'));
  if (!P) {
    if (!list.length) return h('div', { class: 'card' }, head, h('div', { class: 'infobox', style: { marginTop: '12px' } }, 'Crée un projet (ex. « Immeuble Amal 1 ») puis ajoute ses lots : tu pourras ensuite le partager en lecture seule avec tes associés.'));
    return h('div', { class: 'card' }, head, h('div', { class: 'pcards' }, list.map(projectCard)));
  }
  const mine = isMine(P);
  const m = mine ? null : membershipOf(P.id);
  const invited = mine ? S.memberships.filter((x) => x.projet_id === P.id) : [];
  const lots = S.lots.filter((l) => l.projetId === P.id);
  return h('div', { class: 'card' }, head,
    h('div', { class: 'pdetail' },
      h('div', null, h('b', null, P.nom), h('span', { class: 'sub' }, `${lots.length} lot${lots.length > 1 ? 's' : ''} · ma part ${Math.round(partOf(P.id) * 100)} %${P.note ? ' · ' + P.note : ''}`),
        mine ? h('span', { class: 'sub' }, invited.length ? `Partagé avec : ${invited.map((x) => `${x.label || 'invité'}${x.status === 'invite' ? ' (invitation en attente)' : ` (${Math.round(x.part * 100)} %)`}`).join(', ')}` : 'Non partagé')
          : h('span', { class: 'sub' }, `Partagé par ${m ? m.owner_email : 'le propriétaire'} — lecture seule`)),
      mine ? h('div', { class: 'row-actions' },
        h('button', { class: 'btn primary', onClick: () => openShare(P) }, icon('user', 16), 'Partager'),
        h('button', { class: 'btn', onClick: () => openLot({ projetId: P.id }) }, icon('plus', 16), 'Ajouter un lot'),
        h('button', { class: 'btn', onClick: () => openProjet(P) }, icon('edit', 16), 'Modifier'))
        : h('button', { class: 'btn ghost', onClick: async () => { if (!(await confirmBox(`Quitter le projet « ${P.nom} » ? Tu n’y auras plus accès (sauf nouvelle invitation).`, { ok: 'Quitter', danger: true }))) return; const { error } = await sb.rpc('remove_membre', { p_id: m.id }); if (error) return toast(error.message, 'error'); S.immoProjet = ''; savePrefs(); const { pull } = await import('../state.js'); await pull(); emit(); } }, 'Quitter ce projet')),
    mine && lots.length ? h('div', { class: 'catgrid', style: { marginTop: '10px' } }, lots.map((l) => h('button', { class: 'cat', onClick: () => openLot(l) }, `${lotCode(l.nom) || l.code} · ${shortLot(l.nom)}`, h('span', { class: 'muted' }, `${num0(l.loyer)} MAD`)))) : null);
}

function projectCard(p) {
  const lots = S.lots.filter((l) => l.projetId === p.id);
  const cur = todayMonth();
  const occ = lots.filter((l) => rentCell(l.nom, cur).tenant).length;
  const since = addMonths(cur, -11);
  const loy12 = sum(S.data.tx.filter((t) => t.projetId === p.id && t.categorie === 'Loyer' && t.sens === 'Revenu' && t.date.slice(0, 7) >= since), madW);
  const invited = isMine(p) ? S.memberships.filter((x) => x.projet_id === p.id).length : 0;
  return h('div', { class: 'pcard', onClick: () => { S.immoProjet = p.id; savePrefs(); emit(); } },
    h('div', { class: 'split' }, h('b', null, p.nom), isMine(p) ? (invited ? h('span', { class: 'pill info' }, icon('user', 12), `${invited} invité${invited > 1 ? 's' : ''}`) : null) : h('span', { class: 'pill mute' }, 'partagé · lecture seule')),
    h('div', { class: 'muted' }, `${lots.length} lot${lots.length > 1 ? 's' : ''} · ${occ}/${lots.length} loués · ma part ${Math.round(partOf(p.id) * 100)} %`),
    h('div', { class: 'num', style: { fontWeight: 700, fontSize: '18px', marginTop: '6px' } }, mad(loy12), h('span', { class: 'muted', style: { fontSize: '12px', fontWeight: 500 } }, S.immoView === 'full' ? ' de loyers sur 12 mois' : ' de loyers sur 12 mois (ma part)')));
}

function openProjet(p = {}) {
  const editing = !!p.id;
  const nom = h('input', { type: 'text', value: p.nom || '', placeholder: 'ex. Immeuble Amal 1' });
  const part = h('input', { type: 'number', min: 0, max: 100, step: 1, value: Math.round((p.part ?? 1) * 100) });
  const dev = select(CUR_CODES, p.devise || 'MAD');
  const note = h('textarea', null, p.note || '');
  const err = h('div', { class: 'err' });
  const m = modal({ title: editing ? `Projet « ${p.nom} »` : 'Nouveau projet immobilier', width: 520,
    body: [field('Nom du projet', nom), h('div', { class: 'grid2' }, field('Ma part (%)', part, 'Ta quote-part : pondère le tableau de bord « Ma part »'), field('Devise', dev)), field('Note', note), err],
    footer: [editing ? h('button', { class: 'btn danger', onClick: async () => { if (await confirmBox(`Supprimer le projet « ${p.nom} » ? Ses ${S.data.tx.filter((t) => t.projetId === p.id).length} opérations ne seront plus prises en compte dans les calculs. (Possible seulement s’il ne contient plus de lots.)`, { ok: 'Supprimer', danger: true })) { if (await ops([del('projet', p.id)], 'Projet supprimé')) { S.immoProjet = ''; savePrefs(); m.close(); } } } }, icon('trash', 15), 'Supprimer') : null,
      h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'),
      h('button', { class: 'btn primary lg', onClick: async () => {
        if (!nom.value.trim()) { err.textContent = 'Nom obligatoire.'; return; }
        const id = p.id || crypto.randomUUID();
        if (await ops([upsert('projet', { ...p, id: p.id ? p.id : 0, ...(p.id ? {} : { id }), nom: nom.value.trim(), part: Math.min(100, Math.max(0, +part.value || 0)) / 100, devise: dev.value, note: note.value.trim(), type: 'Immobilier' })], editing ? 'Projet modifié' : 'Projet créé')) {
          if (!editing) { S.immoProjet = id; savePrefs(); emit(); }
          m.close();
        }
      } }, 'Enregistrer')] });
}

export function openLot(l = {}) {
  const editing = !!l.id;
  const projs = ownProjets();
  if (!projs.length) return toast('Crée d’abord un projet.', 'error');
  const proj = select(projs.map((p) => ({ value: p.id, label: p.nom })), l.projetId || S.immoProjet || projs[0].id);
  const code = h('input', { type: 'text', value: l.code || '', placeholder: '11' }), nom = h('input', { type: 'text', value: l.nom || '', placeholder: '11. 1er étage (Côté rue)' });
  const loyer = h('input', { type: 'number', value: l.loyer || '', step: 50 });
  const m = modal({ title: editing ? 'Modifier le lot' : 'Nouveau lot', width: 500, body: [field('Projet', proj, editing ? 'Changer de projet déplace aussi ses locataires et ses opérations.' : null), h('div', { class: 'grid2' }, field('Code', code), field('Loyer de référence (MAD)', loyer)), field('Nom du lot', nom)],
    footer: [editing ? h('button', { class: 'btn danger', onClick: async () => { if (await confirmBox('Supprimer ce lot ?', { ok: 'Supprimer', danger: true })) { if (await ops([del('lot', l.id)], 'Lot supprimé')) m.close(); } } }, icon('trash', 15), 'Supprimer') : null,
      h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'),
      h('button', { class: 'btn primary lg', onClick: async () => { if (!nom.value.trim()) return toast('Nom obligatoire', 'error'); if (await ops([upsert('lot', { id: l.id || 0, version: l.version, code: code.value.trim(), nom: nom.value.trim(), loyer: +loyer.value || 0, projetId: proj.value })], 'Lot enregistré')) m.close(); } }, 'Enregistrer')] });
}

function openShare(p) {
  const box = h('div');
  const draw = () => {
    clear(box);
    const list = S.memberships.filter((x) => x.projet_id === p.id);
    box.append(list.length ? h('table', { class: 'tbl' }, h('tbody', null, list.map((x) => h('tr', null,
      h('td', null, x.label || 'Invité', h('span', { class: 'sub' }, x.status === 'actif' ? `Accès actif depuis le ${fmtDate((x.accepted_at || '').slice(0, 10))} · lecture seule` : `Invitation en attente — expire le ${fmtDate((x.expires_at || '').slice(0, 10))}`)),
      h('td', { class: 'r num' }, `${Math.round(x.part * 100)} %`),
      h('td', { class: 'r', style: { whiteSpace: 'nowrap' } },
        h('button', { class: 'btn sm', onClick: async () => { const v = prompt(`Part de ${x.label || 'cet invité'} (%) :`, Math.round(x.part * 100)); if (v == null) return; const { error } = await sb.rpc('update_membre', { p_id: x.id, p_label: x.label, p_part: Math.min(100, Math.max(0, +v || 0)) / 100 }); if (error) return toast(error.message, 'error'); const { pull } = await import('../state.js'); await pull(); emit(); draw(); } }, icon('edit', 13)), ' ',
        h('button', { class: 'btn sm ghost danger', title: 'Retirer l’accès', onClick: async () => { if (!(await confirmBox(`Retirer l’accès de ${x.label || 'cet invité'} au projet « ${p.nom} » ? Effet immédiat sur tous ses appareils.`, { ok: 'Retirer', danger: true }))) return; const { error } = await sb.rpc('remove_membre', { p_id: x.id }); if (error) return toast(error.message, 'error'); const { pull } = await import('../state.js'); await pull(); emit(); draw(); toast('Accès retiré'); } }, icon('trash', 13))))))) : h('div', { class: 'muted' }, 'Personne n’a encore accès à ce projet.'));
  };
  draw();
  const label = h('input', { type: 'text', placeholder: 'ex. Fatima (sœur)' });
  const part = h('input', { type: 'number', min: 0, max: 100, step: 1, placeholder: '33' });
  const out = h('div');
  const m = modal({ title: `Partager « ${p.nom} »`, sub: 'Les invités voient uniquement ce projet (lots, locataires, loyers, charges), en lecture seule.', width: 600, body: [
    h('div', { class: 'grp' }, 'Personnes ayant accès'), box,
    h('div', { class: 'grp', style: { marginTop: '8px' } }, 'Inviter quelqu’un'),
    h('div', { class: 'grid2' }, field('Nom affiché', label), field('Sa part du projet (%)', part, 'Pour son tableau de bord « Ma part »')),
    h('button', { class: 'btn primary', onClick: async () => {
      const { data, error } = await sb.rpc('invite_to_projet', { p_projet: p.id, p_label: label.value.trim(), p_part: Math.min(100, Math.max(0, +part.value || 0)) / 100 });
      if (error) return toast(error.message, 'error');
      const link = `${location.origin}/#/invitation?i=${data.code}`;
      clear(out);
      out.append(h('div', { class: 'infobox' }, h('b', null, 'Lien d’invitation créé'), h('div', null, 'Envoie-le à la personne (WhatsApp, SMS…). Il est secret, valable 14 jours et utilisable une seule fois. Elle crée son compte (ou se connecte) puis ouvre le lien.')),
        h('div', { class: 'invlink' }, h('code', { class: 'secret' }, link)),
        h('div', { class: 'row-actions' },
          navigator.share ? h('button', { class: 'btn primary', onClick: () => navigator.share({ title: `Accès au projet ${p.nom}`, text: `Je t’invite à consulter le projet « ${p.nom} » sur Cockpit (lecture seule) :`, url: link }).catch(() => {}) }, icon('send', 15), 'Envoyer') : null,
          h('button', { class: 'btn', onClick: async () => { try { await navigator.clipboard.writeText(link); toast('Lien copié'); } catch { toast('Copie impossible : sélectionne le lien', 'error'); } } }, 'Copier le lien')));
      const { pull } = await import('../state.js'); await pull(); emit(); draw(); label.value = ''; part.value = '';
    } }, icon('plus', 15), 'Créer un lien d’invitation'), out],
    footer: [h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Fermer')] });
}

// ---------- Relance d'un locataire (SMS / WhatsApp, envoyée par toi) ----------
const MOIS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'ماي', 'يونيو', 'يوليوز', 'غشت', 'شتنبر', 'أكتوبر', 'نونبر', 'دجنبر'];
function relanceText(lang, ten, month, amount) {
  const m = +month.slice(5, 7) - 1, y = month.slice(0, 4);
  const amt = Math.round(amount).toLocaleString('fr-FR').replace(/ /g, ' ');
  if (lang === 'ar') return `السلام عليكم ${ten.nom}،\nنذكركم بأداء واجب الكراء لشهر ${MOIS_AR[m]} ${y} بمبلغ ${amt} درهم.\nالمرجو تسوية المبلغ في أقرب الآجال.\nشكرا جزيلا.`;
  return `Bonjour ${ten.nom},\nNous vous rappelons le paiement du loyer de ${monthLong(month)} (${amt} MAD).\nMerci de le régler dès que possible.\nCordialement.`;
}
const phoneDigits = (p) => String(p || '').replace(/[^\d+]/g, '').replace(/^00/, '+').replace(/^0(?=[67])/, '+212');
export function openRelance(ten, month, amount) {
  if (!isMine(ten)) return toast('Projet partagé en lecture seule.', 'error');
  let lang = 'ar';
  const phone = h('input', { type: 'tel', value: phoneDigits(ten.contact), placeholder: '+2126…' });
  const text = h('textarea', { rows: 6, dir: 'auto', style: { fontSize: '16px' } }, relanceText(lang, ten, month, amount));
  const langSeg = segmented([{ value: 'ar', label: 'العربية' }, { value: 'fr', label: 'Français' }], lang, (v) => { lang = v; text.value = relanceText(v, ten, month, amount); });
  const log = h('input', { type: 'checkbox', checked: true });
  const note = async (canal) => {
    if (!log.checked) return;
    const line = `Relance ${canal} du ${new Date().toLocaleDateString('fr-FR')} (loyer ${monthLong(month)}, ${Math.round(amount)} MAD)`;
    await ops([upsert('tenant', { ...ten, note: [line, ten.note].filter(Boolean).join('\n') })]);
  };
  const go = async (canal) => {
    const num = phoneDigits(phone.value);
    if (!/^\+?\d{8,15}$/.test(num)) return toast('Numéro de téléphone invalide.', 'error');
    const body = encodeURIComponent(text.value);
    const url = canal === 'SMS' ? `sms:${num}${/iPhone|iPad|Mac/.test(navigator.userAgent) ? '&' : '?'}body=${body}` : `https://wa.me/${num.replace('+', '')}?text=${body}`;
    window.open(url, canal === 'SMS' ? '_self' : '_blank');
    await note(canal);
    m.close();
  };
  const m = modal({ title: `Relancer ${ten.nom}`, sub: `${shortLot(ten.lot)} · loyer de ${monthLong(month)} · ${mad(amount)} attendus`, width: 520, body: [
    h('div', { class: 'split' }, h('span', { class: 'lbl' }, 'Langue du message'), langSeg),
    field('Téléphone du locataire', phone, ten.contact ? null : 'Aucun numéro dans la fiche : saisis-le (il sera conservé si tu le notes dans la fiche).'),
    field('Message (modifiable)', text),
    h('label', { class: 'split', style: { fontSize: '13px' } }, log, 'Noter la relance dans la fiche du locataire'),
    h('div', { class: 'note' }, 'Le message s’ouvre dans Messages ou WhatsApp : c’est toi qui appuies sur Envoyer.')],
  footer: [h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => go('WhatsApp') }, icon('message', 16), 'WhatsApp'), h('button', { class: 'btn primary lg', onClick: () => go('SMS') }, icon('send', 16), 'SMS')] });
}
// Loyers impayés d'un locataire (mois en retard / partiels sur 6 mois)
export function unpaidOf(ten) {
  const cur = todayMonth(), out = [];
  for (let i = 0; i < 6; i++) { const m = addMonths(cur, -i); const c = rentCell(ten.lot, m); if (c.tenant && c.tenant.id === ten.id && ['late', 'part', 'due'].includes(c.status)) out.push({ month: m, amount: c.expected - c.paid }); }
  return out;
}
