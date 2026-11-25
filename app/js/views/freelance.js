import { h, icon, eur, money, num0, pct, monthsBetween, monthLabel, monthLong, fmtDate, sum, addMonths } from '../util.js';
import { S, ops, upsert, del, todayMonth, emit } from '../state.js';
import { freelanceYear, microYear } from '../calc.js';
import { modal, field, select, confirmBox, empty, pill, toast, segmented } from '../ui.js';
import { kpi } from './common.js';

export function meta() { return { title: 'Freelance', sub: 'Facturation, encaissements et plafonds', immoToggle: false }; }

const st = { year: null };
const inP = (m) => m >= S.period.from && m <= S.period.to;
const toEur = (i, v) => (i.devise === 'MAD' ? v * S.P.taux : v);

const statutPill = (i) => i.statut === 'Payée' ? pill('good', 'Payée', 'check') : i.statut === 'Envoyée' ? pill('info', 'Envoyée', 'send') : pill('mute', 'Planifiée', 'calendar');

// ---------- actions ----------
export async function sendInvoice(i) { await ops([upsert('invoice', { ...i, statut: 'Envoyée', emission: i.emission || S.today })], `${i.numero} marquée comme envoyée`); }
export function payInvoice(i) {
  const d = h('input', { type: 'date', value: S.today });
  const go = async () => {
    const base = { date: d.value, activite: 'Freelance', sens: 'Revenu', devise: i.devise, tiers: i.client, periode: i.periode, nature: 'Courant' };
    const list = [upsert('invoice', { ...i, statut: 'Payée', paiement: d.value, emission: i.emission || d.value }),
      upsert('tx', { ...base, categorie: 'Prestations', libelle: `Facture ${i.numero} — ${i.client}`, montant: i.ht, ref: `FAC${i.id}` })];
    if (i.ttc - i.ht > 0.005) list.push(upsert('tx', { ...base, categorie: 'TVA collectée', libelle: `TVA facture ${i.numero}`, montant: i.ttc - i.ht, nature: 'Financement', ref: `FACTVA${i.id}` }));
    if (await ops(list, `Paiement de ${money(i.ttc, i.devise)} enregistré`)) m.close();
  };
  const m = modal({ title: 'Marquer comme payée', sub: `${i.numero} · ${i.client} · ${monthLong(i.periode)}`, width: 460,
    body: [h('div', { class: 'infobox' }, `Montant : ${money(i.ttc, i.devise, 2)} TTC (${money(i.ht, i.devise, 2)} HT). Une opération « Prestations » sera ajoutée automatiquement.`), field('Date de réception du paiement', d)],
    footer: [h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'), h('button', { class: 'btn primary lg', onClick: go }, icon('check', 17), 'Confirmer')] });
}
async function unpay(i) {
  if (!(await confirmBox(`Annuler le paiement de ${i.numero} ? Les opérations liées seront supprimées.`, { ok: 'Annuler le paiement', danger: true }))) return;
  const list = [upsert('invoice', { ...i, statut: 'Envoyée', paiement: '' })];
  for (const t of S.data.tx) if (t.ref === `FAC${i.id}` || t.ref === `FACTVA${i.id}`) list.push(del('tx', t.id));
  await ops(list, 'Paiement annulé');
}

function openInvoiceForm(inv = {}) {
  const editing = !!inv.id, paid = inv.statut === 'Payée';
  if (!S.data.clients.length) return toast('Ajoute d’abord un client.', 'error');
  const cl = select(S.data.clients.map((c) => ({ value: c.nom, label: c.nom })), inv.client || S.data.clients[0].nom);
  const per = h('input', { type: 'month', value: inv.periode || todayMonth() });
  const jours = h('input', { type: 'number', step: 0.5, min: 0, value: inv.jours ?? '' });
  const tjm = h('input', { type: 'number', step: 10, min: 0, value: inv.tjm ?? '' });
  const dev = select(['EUR', 'MAD'], inv.devise || 'EUR');
  const tva = h('input', { type: 'number', step: 1, min: 0, max: 30, value: inv.tva != null ? Math.round(inv.tva * 100) : 0 });
  const emi = h('input', { type: 'date', value: inv.emission || '' });
  const st = select(paid ? ['Payée'] : ['Planifiée', 'Envoyée'], inv.statut || 'Planifiée', paid ? { disabled: true } : {});
  const note = h('textarea', null, inv.note || '');
  const tot = h('div', { class: 'infobox num' });
  const c0 = () => S.data.clients.find((c) => c.nom === cl.value);
  const fillFromClient = () => { const c = c0(); if (c) { tjm.value = c.tjm || ''; dev.value = c.devise; tva.value = Math.round((c.tva || 0) * 100); } };
  if (!editing) fillFromClient();
  cl.addEventListener('change', fillFromClient);
  const upd = () => { const ht = (+jours.value || 0) * (+tjm.value || 0); const ttc = ht * (1 + (+tva.value || 0) / 100); tot.textContent = `HT ${money(ht, dev.value, 2)} · TVA ${money(ttc - ht, dev.value, 2)} · TTC ${money(ttc, dev.value, 2)}`; };
  [jours, tjm, tva, dev, cl].forEach((x) => x.addEventListener('input', upd)); upd();
  const err = h('div', { class: 'err' });
  const save = async () => {
    if (!(+jours.value > 0) || !(+tjm.value > 0)) { err.textContent = 'Renseigne le nombre de jours et le TJM.'; return; }
    const item = { ...inv, id: inv.id || 0, client: cl.value, periode: per.value, jours: +jours.value, tjm: +tjm.value, devise: dev.value, ht: 0, tva: (+tva.value || 0) / 100, emission: emi.value || (st.value === 'Envoyée' ? S.today : ''), statut: st.value, note: note.value.trim() };
    if (await ops([upsert('invoice', item)], editing ? 'Facture modifiée' : 'Facture créée')) m.close();
  };
  const m = modal({ title: editing ? `Facture ${inv.numero}` : 'Nouvelle facture', width: 620,
    body: [h('div', { class: 'grid2' }, field('Client', cl), field('Mois de la prestation', per)),
      h('div', { class: 'grid3' }, field('Jours travaillés', jours), field('TJM', tjm), field('Devise', dev)),
      h('div', { class: 'grid3' }, field('TVA (%)', tva), field('Date de facture', emi), field('Statut', st)), tot,
      paid ? h('div', { class: 'note' }, 'Facture payée : si tu changes le montant, modifie aussi l’opération « Prestations » associée dans Opérations.') : null, field('Note', note), err],
    footer: [editing ? h('button', { class: 'btn danger', onClick: async () => { if (await confirmBox(`Supprimer la facture ${inv.numero} ?`, { ok: 'Supprimer', danger: true })) { if (await ops([del('invoice', inv.id)], 'Facture supprimée')) m.close(); } } }, icon('trash', 15), 'Supprimer') : null,
      h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'), h('button', { class: 'btn primary lg', onClick: save }, 'Enregistrer')] });
}

function openClientForm(c = {}) {
  const editing = !!c.id;
  const nom = h('input', { type: 'text', value: c.nom || '', placeholder: 'Nom du client' });
  const dev = select(['EUR', 'MAD'], c.devise || 'EUR');
  const tjm = h('input', { type: 'number', min: 0, step: 10, value: c.tjm || '' });
  const tva = h('input', { type: 'number', min: 0, max: 30, value: c.tva != null ? Math.round(c.tva * 100) : 0 });
  const micro = select([{ value: 'Oui', label: 'Oui — compte dans le plafond micro / TVA' }, { value: 'Non', label: 'Non — hors micro-entreprise' }], c.micro || 'Oui');
  const note = h('textarea', null, c.note || '');
  const m = modal({ title: editing ? 'Modifier le client' : 'Nouveau client', width: 560,
    body: [field('Client', nom), h('div', { class: 'grid3' }, field('Devise', dev), field('TJM', tjm), field('TVA (%)', tva)), field('Entre dans le calcul des plafonds ?', micro), field('Note', note)],
    footer: [editing ? h('button', { class: 'btn danger', onClick: async () => { if (await confirmBox('Supprimer ce client ? Ses factures restent visibles.', { ok: 'Supprimer', danger: true })) { if (await ops([del('client', c.id)], 'Client supprimé')) m.close(); } } }, icon('trash', 15), 'Supprimer') : null,
      h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'),
      h('button', { class: 'btn primary lg', onClick: async () => { if (!nom.value.trim()) return toast('Nom obligatoire', 'error'); if (await ops([upsert('client', { id: c.id || 0, nom: nom.value.trim(), devise: dev.value, tjm: +tjm.value || 0, tva: (+tva.value || 0) / 100, micro: micro.value, note: note.value.trim() })], 'Client enregistré')) m.close(); } }, 'Enregistrer')] });
}

// ---------- page ----------
export function render() {
  const inv = S.data.invoices.filter((i) => inP(i.periode));
  const billed = sum(inv.filter((i) => i.statut !== 'Planifiée'), (i) => toEur(i, i.ht));
  const paid = sum(inv.filter((i) => i.statut === 'Payée'), (i) => toEur(i, i.ht));
  const pend = S.data.invoices.filter((i) => i.statut === 'Envoyée');
  const pendAmt = sum(pend, (i) => toEur(i, i.ttc));
  const planned = sum(inv.filter((i) => i.statut === 'Planifiée'), (i) => toEur(i, i.ht));
  const kpis = h('div', { class: 'kpis' },
    kpi({ title: 'Facturé (HT)', ic: 'send', value: eur(billed), sub: [h('span', null, `${inv.filter((i) => i.statut !== 'Planifiée').length} facture(s) sur la période`)] }),
    kpi({ title: 'Encaissé (HT)', ic: 'check', value: eur(paid), sub: [h('span', null, planned ? `+ ${eur(planned)} planifiés` : 'Prestations payées')] }),
    kpi({ title: 'En attente de paiement', ic: 'calendar', value: eur(pendAmt), sub: [h('span', null, `${pend.length} facture${pend.length > 1 ? 's' : ''} envoyée${pend.length > 1 ? 's' : ''}, TTC`)] }),
    kpi({ title: `À mettre de côté (${Math.round(S.P.provision * 100)} %)`, ic: 'bank', value: eur(paid * S.P.provision), sub: [h('span', null, `cotisations ${pct(S.P.cotis, 1)} + impôt (estimation)`)] }));

  // plafonds
  const yrs = [...new Set([String(microYear()), ...S.data.invoices.map((i) => i.periode.slice(0, 4)).filter((y) => y >= S.P.microDebut.slice(0, 4))])].sort();
  if (!st.year || !yrs.includes(st.year)) st.year = String(microYear());
  const y = st.year, fy = freelanceYear(y), done = fy.paid + fy.billed;
  const scale = Math.max(fy.micro * 1.1, fy.total * 1.04, 1);
  const w = (v) => Math.min(100, (v / scale) * 100) + '%';
  const mk = (v, label, low) => h('div', { class: 'mk' + (low ? ' low' : ''), style: { left: (v / scale) * 100 + '%' } }, h('span', null, low ? `${label} ${eur(v)}` : eur(v)), h('em', null, label));
  let verdict;
  if (done >= fy.tvaMaj) verdict = pill('bad', 'TVA due immédiatement', 'alert');
  else if (done >= fy.tva) verdict = pill('warn', 'Franchise de TVA dépassée', 'alert');
  else verdict = pill('good', `Marge avant TVA : ${eur(fy.tva - done)}`, 'check');
  const yearSeg = yrs.length > 1 ? segmented(yrs.map((v) => ({ value: v, label: v })), y, (v) => { st.year = v; emit(); }) : null;
  const plafCard = h('div', { class: 'card' }, h('header', null, h('h2', null, `Plafonds ${y}`), h('span', { class: 'sub' }, `micro-entreprise depuis le ${fmtDate(S.P.microDebut)}`), h('div', { class: 'right' }, yearSeg, verdict)),
    h('div', { class: 'thr' }, h('div', { class: 'track' }, h('div', { class: 'seg1', style: { width: w(fy.paid) } }), h('div', { class: 'seg2', style: { width: w(fy.billed) } }), h('div', { class: 'seg3', style: { width: w(fy.planned) } })),
      mk(fy.tva, 'franchise TVA'), mk(fy.tvaMaj, 'TVA majorée', true), mk(fy.micro, 'plafond micro')),
    h('div', { class: 'legend', style: { flexWrap: 'wrap' } },
      h('span', null, h('i', { style: { background: 'var(--flow-in)' } }), `Encaissé ${eur(fy.paid)}`), h('span', null, h('i', { style: { background: 'var(--flow-out)' } }), `Facturé en attente ${eur(fy.billed)}`),
      h('span', null, h('i', { style: { background: 'repeating-linear-gradient(135deg,var(--flow-out) 0 3px,transparent 3px 6px)', border: '1px solid var(--flow-out)' } }), `Planifié ${eur(fy.planned)}`), h('span', { style: { fontWeight: 700 } }, `Total projeté ${eur(fy.total)}`)),
    fy.total > fy.micro ? h('div', { class: 'infobox', style: { marginTop: '12px' } }, `Avec les factures planifiées, ${y} atteint ${eur(fy.total)} : ${eur(fy.total - fy.micro)} au-dessus du plafond micro. Un dépassement isolé ne fait pas sortir du régime, mais deux années consécutives font basculer en déclaration contrôlée, et la TVA devient due. Fais valider le statut (micro, EURL, SASU) par un expert-comptable avant de démarrer.`) : null,
    h('div', { class: 'note', style: { marginTop: '10px' } }, fy.factor < 1 ? `Premier exercice : plafond et seuils proratisés (× ${(fy.factor * 100).toFixed(0)} % = ${Math.round(fy.factor * 365)} jours sur 365). ` : '', 'Seuls les clients « compte dans la micro » sont comptés. Seuils et date de début modifiables dans Paramètres.'));

  // factures
  const rows = [...inv].sort((a, b) => (a.periode < b.periode ? 1 : a.periode > b.periode ? -1 : a.client.localeCompare(b.client)));
  const tbl = rows.length ? h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['N°', 'Client', 'Mois', 'Prestation', 'HT', 'TTC', 'Statut', ''].map((x, i) => h('th', { class: i === 4 || i === 5 ? 'r' : '' }, x)))),
    h('tbody', null, rows.map((i) => h('tr', { class: 'click', onClick: () => openInvoiceForm(i) },
      h('td', { class: 'num' }, i.numero), h('td', null, i.client, i.emission ? h('span', { class: 'sub' }, `Émise le ${fmtDate(i.emission)}${i.paiement ? ` · payée le ${fmtDate(i.paiement)}` : ''}`) : null), h('td', null, monthLabel(i.periode)),
      h('td', { class: 'muted num' }, `${i.jours} j × ${num0(i.tjm)} ${i.devise === 'MAD' ? 'MAD' : '€'}`), h('td', { class: 'r num' }, money(i.ht, i.devise)), h('td', { class: 'r num' }, money(i.ttc, i.devise), i.tva ? h('span', { class: 'sub' }, `TVA ${Math.round(i.tva * 100)} %`) : null),
      h('td', null, statutPill(i)),
      h('td', { class: 'r', onClick: (e) => e.stopPropagation() }, i.statut === 'Planifiée' ? h('button', { class: 'btn sm', onClick: () => sendInvoice(i) }, icon('send', 14), 'Marquer envoyée') : i.statut === 'Envoyée' ? h('button', { class: 'btn sm primary', onClick: () => payInvoice(i) }, icon('check', 14), 'Marquer payée') : h('button', { class: 'btn sm ghost', title: 'Annuler le paiement', onClick: () => unpay(i) }, icon('undo', 14))))))) : empty('Aucune facture sur cette période', 'Change la période ou crée une facture.');
  const facCard = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Factures'), h('span', { class: 'sub' }, `${rows.length} sur la période`), h('div', { class: 'right' }, h('button', { class: 'btn', onClick: () => openInvoiceForm() }, icon('plus', 16), 'Nouvelle facture'))), tbl);

  const cliCard = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Clients'), h('div', { class: 'right' }, h('button', { class: 'btn sm', onClick: () => openClientForm() }, icon('plus', 15), 'Client'))),
    S.data.clients.length ? h('table', { class: 'tbl' }, h('tbody', null, S.data.clients.map((c) => h('tr', { class: 'click', onClick: () => openClientForm(c) },
      h('td', null, c.nom, h('span', { class: 'sub' }, c.micro === 'Oui' ? 'Compte dans la micro' : 'Hors micro-entreprise')), h('td', { class: 'r num' }, `${num0(c.tjm)} ${c.devise === 'MAD' ? 'MAD' : '€'} / j`), h('td', { class: 'r muted' }, c.tva ? `TVA ${Math.round(c.tva * 100)} %` : 'Sans TVA'))))) : empty('Aucun client', ''));
  return [kpis, plafCard, facCard, cliCard];
}
