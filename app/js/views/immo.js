import { h, icon, eur, mad, num0, pct, monthsBetween, monthShort, monthLong, monthEnd, addMonths, fmtDate, sum, clear } from '../util.js';
import { S, ops, upsert, del, todayMonth, emit } from '../state.js';
import { txs, rentCell, tenancyFor, activeTenants, summarize } from '../calc.js';
import { modal, field, select, confirmBox, empty, toast } from '../ui.js';
import { openTxForm } from '../txform.js';
import { kpi, catChip, amountEl } from './common.js';
import { barList } from '../charts.js';

export function meta() { return { title: 'Immobilier', sub: 'Loyers, locataires et trésorerie', immoToggle: true }; }
export function badge() { return 0; }

const toMad = (t) => (t.devise === 'MAD' ? t.montant : t.montantEur / S.P.taux);
const shortLot = (l) => l.replace(/^\d+\.\s*/, '');
const lotCode = (l) => (l.match(/^(\d+)\./) || [, ''])[1];
const showOld = { v: false };

// ---------- encaissement ----------
function tenantChargesCollected(tenant, month) {
  return S.data.tx.some((t) => t.activite === 'Immobilier' && t.categorie === 'Charges refacturées' && t.periode === month && (t.tiers === tenant.nom || t.lot === tenant.lot) && t.sens === 'Revenu');
}
function rentTxs(tenant, month, loyer, charges, date) {
  const base = { activite: 'Immobilier', sens: 'Revenu', devise: 'MAD', date, periode: month, tiers: tenant.nom, lot: tenant.lot, nature: 'Courant' };
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
    footer: [h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'), h('button', { class: 'btn primary lg', onClick: go }, icon('check', 17), 'Encaisser')] });
  loyer.focus(); loyer.select();
}
export function openCollectAll(month) {
  const rows = [];
  for (const lot of S.lots) {
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
    h('td', { class: 'r' }, h('button', { class: 'btn sm', onClick: () => { m.close(); openTxForm(t); } }, icon('edit', 14), 'Modifier'))));
  const m = modal({ title: `${shortLot(lot)} — ${monthLong(month)}`, sub: c.tenant ? `${c.tenant.nom} · loyer ${mad(c.tenant.loyer)}` : '', width: 560,
    body: [h('table', { class: 'tbl' }, h('tbody', null, rows)), c.status === 'part' ? h('div', { class: 'infobox' }, `Reste à encaisser : ${mad(c.expected - c.paid)}`) : null],
    footer: [h('span', { class: 'sp' }), c.status === 'part' ? h('button', { class: 'btn primary', onClick: () => { m.close(); openCollect(lot, month); } }, 'Compléter le loyer') : null, h('button', { class: 'btn', onClick: () => m.close() }, 'Fermer')] });
}

// ---------- locataires ----------
function openTenantForm(t = {}) {
  const editing = !!t.id;
  const lotSel = select([{ value: '', label: '— Choisir —' }, ...S.lots.map((l) => ({ value: l.nom, label: l.nom }))], t.lot || '');
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
    const item = { id: t.id || 0, lot: lotSel.value, nom: nom.value.trim(), loyer: +loyer.value || 0, charges: +charges.value || 0, entree: entree.value, sortie: sortie.value, caution: +caution.value || 0, contact: contact.value.trim(), metier: metier.value.trim(), note: note.value.trim() };
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
  const list = txs({ activity: 'Immobilier' });
  const loyers = sum(list.filter((t) => t.categorie === 'Loyer' && t.sens === 'Revenu'), toMad);
  const charges = sum(list.filter((t) => t.categorie === 'Charges refacturées' && t.sens === 'Revenu'), toMad);
  const revC = sum(list.filter((t) => t.nature === 'Courant' && t.sens === 'Revenu'), toMad), depC = sum(list.filter((t) => t.nature === 'Courant' && t.sens === 'Dépense'), toMad);
  const res = revC - depC;
  const share = S.immoView === 'mine' ? S.P.part : 1;
  // occupation
  const occ = S.lots.filter((l) => rentCell(l.nom, cur).tenant).length;
  // impayés sur la période
  const months = monthsBetween(S.period.from, S.period.to).filter((m) => m <= cur);
  let unpaid = 0, unpaidN = 0, expectedTot = 0;
  for (const l of S.lots) for (const m of months) { const c = rentCell(l.nom, m); expectedTot += c.expected; if (c.status === 'late' || c.status === 'part' || (c.status === 'due')) { unpaid += c.expected - c.paid; unpaidN++; } }
  const kpis = h('div', { class: 'kpis' },
    kpi({ title: 'Loyers encaissés', ic: 'building', value: mad(loyers), sub: [h('span', null, `+ ${mad(charges)} de charges refacturées`)] }),
    kpi({ title: 'Taux d’occupation', ic: 'key', value: `${occ} / ${S.lots.length}`, sub: [h('span', { class: 'delta ' + (occ === S.lots.length ? 'good' : 'bad') }, pct(S.lots.length ? occ / S.lots.length : 0)), h('span', null, 'lots loués aujourd’hui')] }),
    kpi({ title: 'Loyers à récupérer', ic: 'alert', value: h('span', { class: unpaid > 0 ? 'neg' : 'pos' }, mad(unpaid)), sub: [unpaid > 0 ? h('span', null, `${unpaidN} loyer${unpaidN > 1 ? 's' : ''} manquant${unpaidN > 1 ? 's' : ''} sur la période`) : h('span', { class: 'delta good' }, 'Tout est encaissé')] }),
    kpi({ title: 'Résultat d’exploitation', ic: 'wallet', value: h('span', { class: res >= 0 ? '' : 'neg' }, (res > 0 ? '+' : '') + mad(res)), sub: [h('span', null, `≈ ${eur(res * S.P.taux * share)}${S.immoView === 'mine' ? ' (ma part)' : ''}`)] }));

  // grille des loyers
  const allMonths = monthsBetween(S.period.from, S.period.to);
  const gm = allMonths.slice(-15);
  const grid = h('table', { class: 'rent' });
  grid.append(h('thead', null, h('tr', null, h('th', null, 'Lot'), gm.map((m) => h('th', { style: m === cur ? { background: 'var(--info-bg)', color: 'var(--info-ink)' } : null }, monthShort(m), h('div', { style: { fontWeight: 500, opacity: .7 } }, m.slice(2, 4)))))));
  const tb = h('tbody');
  for (const l of S.lots) {
    const cT = tenancyFor(l.nom, cur);
    const tr = h('tr', null, h('td', { class: 'lot' }, h('b', null, `${lotCode(l.nom)} · ${shortLot(l.nom)}`), h('span', null, cT ? cT.nom : 'Vacant')));
    for (const m of gm) {
      const c = rentCell(l.nom, m);
      const txt = { paid: [num0(c.paid), 'payé'], part: [num0(c.paid), `sur ${num0(c.expected)}`], late: ['—', 'impayé'], due: [num0(c.expected), 'à encaisser'], vac: ['·', ''], fut: ['', ''] }[c.status];
      const clickable = ['due', 'late', 'part', 'paid'].includes(c.status) && (c.tenant || c.paid > 0);
      const cell = h('div', { class: 'c ' + c.status, title: c.tenant ? `${c.tenant.nom} — loyer ${mad(c.tenant.loyer)}` : '', onClick: clickable ? () => (c.status === 'paid' ? openCellDetails(l.nom, m) : c.status === 'part' ? openCellDetails(l.nom, m) : openCollect(l.nom, m)) : null }, txt[0], txt[1] ? h('small', null, txt[1]) : null);
      tr.append(h('td', { class: 'cell' }, cell));
    }
    tb.append(tr);
  }
  grid.append(tb);
  grid.append(h('tfoot', null, h('tr', null, h('td', { style: { textAlign: 'left' } }, 'Encaissé / attendu'), gm.map((m) => {
    let p = 0, e = 0; for (const l of S.lots) { const c = rentCell(l.nom, m); p += c.paid; e += c.expected; }
    return h('td', { class: 'num' }, num0(p), h('div', { class: 'muted', style: { fontWeight: 500, fontSize: '11px' } }, e ? '/ ' + num0(e) : ''));
  }))));
  const gridCard = h('div', { class: 'card' },
    h('header', null, h('h2', null, 'Suivi des loyers'), h('span', { class: 'sub' }, 'clique sur une case pour encaisser'),
      h('div', { class: 'right' }, h('button', { class: 'btn primary', onClick: () => openCollectAll(cur) }, icon('check', 16), `Encaisser les loyers de ${monthLong(cur).split(' ')[0]}`))),
    (() => { const w = h('div', { class: 'gridwrap' }, grid); requestAnimationFrame(() => { w.scrollLeft = w.scrollWidth; }); return w; })(),
    h('div', { class: 'legend', style: { marginTop: '12px', flexWrap: 'wrap' } },
      h('span', null, h('i', { style: { background: 'var(--good-bg)', border: '1px solid var(--good)' } }), 'Payé'), h('span', null, h('i', { style: { background: 'var(--warn-bg)', border: '1px solid var(--warn)' } }), 'Partiel / à encaisser'),
      h('span', null, h('i', { style: { background: 'var(--crit-bg)', border: '1px solid var(--crit)' } }), 'Impayé'), allMonths.length > gm.length ? h('span', { class: 'muted' }, `Affichage des ${gm.length} derniers mois de la période`) : null));

  // locataires
  const tenants = [...S.data.tenants].filter((t) => showOld.v || (!t.sortie || t.sortie >= S.today)).sort((a, b) => (a.lot.localeCompare(b.lot)) || ((b.entree || '').localeCompare(a.entree || '')));
  const tCard = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Locataires'), h('span', { class: 'sub' }, `${activeTenants().length} actif${activeTenants().length > 1 ? 's' : ''}`),
    h('div', { class: 'right' }, h('label', { class: 'split', style: { fontSize: '13px', color: 'var(--ink-2)', fontWeight: 600 } }, (() => { const c = h('input', { type: 'checkbox', checked: showOld.v }); c.addEventListener('change', () => { showOld.v = c.checked; emit(); }); return c; })(), 'Anciens'),
      h('button', { class: 'btn', onClick: () => openTenantForm() }, icon('plus', 16), 'Nouveau locataire'))),
    tenants.length ? h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Lot', 'Locataire', 'Loyer', 'Charges', 'Entrée', 'Caution', 'Contact', ''].map((x, i) => h('th', { class: i >= 2 && i <= 3 || i === 5 ? 'r' : '' }, x)))),
      h('tbody', null, tenants.map((t) => { const active = !t.sortie || t.sortie >= S.today;
        return h('tr', { class: 'click' + (active ? '' : ' dim'), onClick: () => openTenantForm(t) }, h('td', null, shortLot(t.lot)), h('td', null, t.nom, !active ? h('span', { class: 'sub' }, `Parti le ${fmtDate(t.sortie)}`) : t.sortie ? h('span', { class: 'sub' }, `Sortie prévue le ${fmtDate(t.sortie)}`) : null),
          h('td', { class: 'r num' }, mad(t.loyer)), h('td', { class: 'r num' }, t.charges ? mad(t.charges) : '—'), h('td', null, fmtDate(t.entree)), h('td', { class: 'r num' }, t.caution ? mad(t.caution) : '—'), h('td', { class: 'muted' }, t.contact || ''),
          h('td', { class: 'r' }, active && !t.sortie ? h('button', { class: 'btn sm', onClick: (e) => { e.stopPropagation(); openDeparture(t); } }, 'Départ') : null)); }))) : empty('Aucun locataire', 'Ajoute ton premier locataire.'));

  // dépenses du projet
  const m = new Map();
  for (const t of list) if (t.nature === 'Courant' && t.sens === 'Dépense') m.set(t.categorie, (m.get(t.categorie) || 0) + toMad(t));
  const dep = [...m.entries()].sort((a, b) => b[1] - a[1]);
  const depCard = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Charges d’exploitation'), h('span', { class: 'sub' }, 'sur la période')),
    dep.length ? barList(dep.map(([l, v]) => ({ label: l, value: v })), { fmt: mad, total: depC }) : empty('Aucune charge', ''));

  // projet en chiffres (toutes périodes)
  const all = S.data.tx.filter((t) => t.activite === 'Immobilier');
  const invNet = sum(all.filter((t) => t.nature === 'Investissement'), (t) => (t.sens === 'Dépense' ? 1 : -1) * toMad(t));
  const treso = sum(all, (t) => (t.sens === 'Revenu' ? 1 : -1) * toMad(t));
  const debt = sum(all.filter((t) => t.categorie === 'Prêt reçu'), toMad) - sum(all.filter((t) => t.categorie === 'Remboursement prêt'), toMad);
  const since = addMonths(cur, -11) + '-01';
  const loy12 = sum(all.filter((t) => t.categorie === 'Loyer' && t.sens === 'Revenu' && t.date >= since), toMad);
  const stat = (l, v, s) => h('div', null, h('div', { class: 'muted', style: { fontSize: '12px', fontWeight: 650 } }, l), h('div', { class: 'num', style: { fontSize: '20px', fontWeight: 700 } }, v), s ? h('div', { class: 'muted num', style: { fontSize: '12px' } }, s) : null);
  const projCard = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Le projet en chiffres'), h('span', { class: 'sub' }, 'depuis l’acquisition')),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '18px' } },
      stat('Investi (acquisition + travaux)', mad(invNet), `≈ ${eur(invNet * S.P.taux)}`),
      stat('Rendement brut (12 mois)', invNet > 0 ? pct(loy12 / invNet, 1) : '—', `${mad(loy12)} de loyers`),
      stat('Trésorerie du projet', mad(treso), `≈ ${eur(treso * S.P.taux)}`),
      stat('Dettes restantes', mad(debt), debt <= 0.5 ? 'Tous les prêts sont remboursés' : 'Prêts non remboursés')));

  return [kpis, gridCard, h('div', { class: 'row2' }, tCard, h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } }, projCard, depCard))];
}
