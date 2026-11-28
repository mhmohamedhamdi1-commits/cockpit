// Écran Entreprise — fenêtres de saisie : création / édition d'une entreprise (assistant), facturation du mois,
// facture, paiement reçu (avec les montants à mettre de côté), impression, client, double confirmation de suppression.
import { h, icon, eur, money, num0, pct, monthLong, fmtDate, addDays, clear, CURRENCIES, CUR_CODES, curSym, parseAmount, monthLabel } from '../util.js';
import { S, ops, upsert, del, todayMonth, rateToEur } from '../state.js';
import { modal, field, select, confirmBox, toast, segmented } from '../ui.js';
import * as E from '../entreprise.js';

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }));
const num = (el) => parseAmount(el.value);
const ownRows = (list, p) => list.filter((r) => (r.projetId ? r.projetId === p.id : (E.entreprisesOf(S)[0] || {}).id === p.id));
export const clientsOf = (p) => ownRows(S.data.clients, p);
export const invoicesOf = (p) => ownRows(S.data.invoices, p);

// ───────────────────────── Double confirmation (suppression d'une entreprise) ─────────────────────────
export function confirmByName(nom, message) {
  return new Promise((res) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; res(v); } };
    const input = h('input', { type: 'text', placeholder: nom, autocomplete: 'off' });
    const go = h('button', { class: 'btn danger', disabled: true }, icon('trash', 15), 'Supprimer définitivement');
    input.addEventListener('input', () => { go.disabled = input.value.trim() !== nom; });
    go.addEventListener('click', () => { fin(true); m.close(); });
    const m = modal({ title: 'Dernière confirmation', width: 480, onClose: () => fin(false),
      body: [h('div', { class: 'infobox', style: { background: 'var(--crit-bg)', color: 'var(--crit-ink)' } }, message), field(`Pour confirmer, tape le nom exact : ${nom}`, input)],
      footer: [h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'), go] });
  });
}
export async function deleteEntreprise(p) {
  const clients = clientsOf(p), invs = invoicesOf(p), nTx = S.data.tx.filter((t) => t.projetId === p.id).length;
  if (!(await confirmBox(`Supprimer l’entreprise « ${p.nom} » ? Elle contient ${clients.length} client(s), ${invs.length} facture(s) et ${nTx} opération(s). Tout sortira des calculs.`, { ok: 'Continuer', danger: true, title: 'Supprimer une entreprise' }))) return false;
  if (!(await confirmByName(p.nom, `Cette suppression retire « ${p.nom} » avec ses clients et ses factures de tous tes appareils. Les données restent récupérables dans Paramètres › Historique.`))) return false;
  const list = [...clients.map((c) => del('client', c.id)), ...invs.map((i) => del('invoice', i.id)), del('projet', p.id)];
  return ops(list, 'Entreprise supprimée');
}

// ───────────────────────── Assistant de création / édition ─────────────────────────
export function openEntrepriseForm(p = null, { onDone } = {}) {
  const editing = !!(p && p.id);
  const base = E.normalizeMeta(p ? p.meta : {}, p || { part: 1 }, S);
  const f = { nom: p ? p.nom : '', part: p ? Number(p.part) : 1, note: p ? p.note : '', ...base, associes: base.associes.map((a) => ({ ...a })) };
  f.mode = base.remuneration.mode;
  if (!editing) { f.date_debut = '2027-01-01'; f.forme = 'micro_bnc'; }
  let step = 0;
  const err = h('div', { class: 'err' });
  const body = h('div', { class: 'stack' });
  const stepper = h('div', { class: 'ent-steps' });
  const preview = h('div', { class: 'ent-preview' });
  const isMicro = () => E.FORMES[f.forme].regimeIR === 'micro';
  const isSoc = () => !E.FORMES[f.forme].individuelle;
  const steps = () => (isSoc() ? ['Identité', 'Fiscalité et social', 'Associés et rémunération'] : ['Identité', 'Fiscalité et social', 'Récapitulatif']);

  const toggleRow = (label, key, hint) => {
    const t = h('button', { type: 'button', class: 'toggle' + (f[key] ? ' on' : ''), role: 'switch', 'aria-checked': String(!!f[key]) });
    t.addEventListener('click', () => { f[key] = !f[key]; t.classList.toggle('on', f[key]); t.setAttribute('aria-checked', String(f[key])); drawPreview(); });
    return h('div', { class: 'ent-toggle' }, h('div', null, h('b', null, label), hint ? h('span', { class: 'sub' }, hint) : null), t);
  };
  const inp = (key, props = {}, parse = (v) => v) => { const el = h('input', { value: f[key] ?? '', ...props }); el.addEventListener('input', () => { f[key] = parse(el.value); drawPreview(); }); return el; };
  const sel = (key, options, onChange) => { const s = select(options, f[key]); s.addEventListener('change', () => { f[key] = s.value; if (onChange) onChange(); drawPreview(); }); return s; };

  function s1() {
    const forme = select(Object.entries(E.FORMES).map(([k, v]) => ({ value: k, label: v.label })), f.forme);
    forme.addEventListener('change', () => {
      const wasMicro = isMicro(); f.forme = forme.value; const F = E.FORMES[f.forme]; f.nature = F.nature;
      if (F.famille === 'micro') f.tva_regime = 'franchise'; else if (wasMicro && f.tva_regime === 'franchise') f.tva_regime = 'reel_normal';
      if (F.individuelle) { f.part = 1; f.associes = [{ nom: 'Moi', part: 1, moi: true }]; } else if (f.associes.length === 1 && f.associes[0].part === 1) { f.part = 1; }
      drawStep();
    });
    const part = h('input', { type: 'number', min: 1, max: 100, step: 1, value: Math.round(f.part * 100), disabled: !isSoc() });
    part.addEventListener('input', () => { f.part = Math.min(100, Math.max(1, +part.value || 0)) / 100; const me = f.associes.find((a) => a.moi); if (me) me.part = f.part; drawPreview(); });
    return [field('Nom de l’entreprise', inp('nom', { type: 'text', placeholder: 'ex. Hamdi Conseil' })),
      field('Forme juridique et régime', forme, E.FORMES[f.forme].regimeIR === 'micro' ? 'Micro : abattement forfaitaire, cotisations sur le CA encaissé, plafonds de CA.' : E.FORMES[f.forme].regimeIR === 'is' ? 'Société à l’IS : tu te rémunères en salaire et/ou dividendes.' : 'Imposition à l’IR au nom de l’exploitant, comptabilité réelle.'),
      h('div', { class: 'grid2' }, field('Date de début d’activité', inp('date_debut', { type: 'date' }), 'Avant cette date, l’entreprise est « pas encore démarrée » : rien n’est compté.'), field('Activité exercée', inp('libelle_activite', { type: 'text', placeholder: 'ex. Conseil en data' }))),
      h('div', { class: 'grid2' }, field('Ma part dans l’entreprise (%)', part, isSoc() ? 'Sert à calculer MES dividendes, ma flat tax et mon revenu imposable.' : 'Entreprise individuelle : 100 %.'), field('SIRET / SIREN (facultatif)', inp('siret', { type: 'text', placeholder: '123 456 789 00012' }))),
      field('Note', inp('note', { type: 'text' }))];
  }
  function s2() {
    const out = [];
    const year = (f.date_debut || '2027').slice(0, 4);
    if (isMicro()) {
      const R = E.rulesFor(year).micro;
      out.push(h('div', { class: 'grid2' },
        f.nature === 'bnc' ? field('Caisse de retraite', sel('caisse', [{ value: 'ssi', label: 'Sécurité sociale des indépendants (SSI) — 25,6 %' }, { value: 'cipav', label: 'CIPAV (profession libérale réglementée) — 23,2 %' }]), 'Profession non réglementée (conseil, data, développement…) : SSI.') : field('Artisan ?', sel('artisan', [{ value: false, label: 'Non (commerçant / prestataire)' }, { value: true, label: 'Oui (artisan)' }].map((o) => ({ value: String(o.value), label: o.label })), () => { f.artisan = f.artisan === true || f.artisan === 'true'; }), 'Change la contribution à la formation professionnelle.'),
        field('Déclaration du CA à l’URSSAF', sel('urssaf_periodicite', [{ value: 'mensuelle', label: 'Chaque mois' }, { value: 'trimestrielle', label: 'Chaque trimestre' }]), 'Obligatoire même à 0 €. Le mensuel est le plus sûr pour la trésorerie.')));
      out.push(toggleRow('Versement libératoire de l’impôt', 'versement_liberatoire', `Tu paies ${(R.vl[f.nature] * 100).toFixed(1).replace('.', ',')} % du CA avec les cotisations ; l’impôt sur ce CA est soldé. Condition : revenu fiscal de référence ≤ ${num0(R.vl.rfrParPart)} € par part.`));
      out.push(toggleRow('ACRE (cotisations réduites la 1re année)', 'acre', 'À demander à l’URSSAF dans les 60 jours après le début. Création depuis le 1er juillet 2026 : taux à 75 % du taux normal.'));
      out.push(field('Ma tranche d’impôt supposée (pour l’estimation de l’IR)', sel('tmi', [0, 0.11, 0.3, 0.41, 0.45].map((v) => ({ value: String(v), label: v === 0 ? '0 % (non imposable)' : `${Math.round(v * 100)} %` })), () => { f.tmi = Number(f.tmi); }), 'Estimation seulement : le calcul exact est dans l’écran Impôt.'));
    } else {
      out.push(h('div', { class: 'grid2' }, field('Date de clôture de l’exercice', (() => { const [mm, dd] = f.cloture.split('-'); const m = select(Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1).padStart(2, '0'), label: monthLong(`2027-${String(i + 1).padStart(2, '0')}`).split(' ')[0] })), mm); const d = h('input', { type: 'number', min: 1, max: 31, value: +dd, style: { width: '80px' } }); const upd = () => { f.cloture = `${m.value}-${String(Math.min(31, Math.max(1, +d.value || 31))).padStart(2, '0')}`; drawPreview(); }; m.addEventListener('change', upd); d.addEventListener('input', upd); return h('div', { class: 'split' }, d, m); })(), '31 décembre = exercice calé sur l’année civile (le plus simple).'),
        field('Capital social (€)', inp('capital', { type: 'number', min: 0, step: 100 }, (v) => Number(v) || 0), 'Sert à la réserve légale et à la règle des 10 % sur les dividendes (gérant TNS).')));
      if (E.FORMES[f.forme].social === 'tns') out.push(toggleRow('Gérant majoritaire (TNS)', 'gerant_majoritaire', 'Les dividendes au-delà de 10 % du capital supportent alors des cotisations sociales.'));
      out.push(field('Ma tranche d’impôt supposée (pour l’estimation de l’IR)', sel('tmi', [0, 0.11, 0.3, 0.41, 0.45].map((v) => ({ value: String(v), label: v === 0 ? '0 % (non imposable)' : `${Math.round(v * 100)} %` })), () => { f.tmi = Number(f.tmi); })));
    }
    const startsAfter = (f.date_debut || '2027') >= '2027-01-01';
    const tvaOpts = [{ value: 'franchise', label: `Franchise en base — pas de TVA (jusqu’à ${num0(E.rulesFor(year).tva.services[0])} € de CA services)` }, { value: 'reel_normal', label: 'TVA au réel (déclarations CA3)' }];
    if (!startsAfter) tvaOpts.splice(1, 0, { value: 'reel_simplifie', label: 'TVA au réel simplifié (CA12 — supprimé au 1er janvier 2027)' });
    out.push(h('div', { class: 'grid2' }, field('Régime de TVA', sel('tva_regime', tvaOpts, () => drawStep()), 'La franchise s’arrête au dépassement du seuil ; la TVA est alors facturée à tes clients.'),
      f.tva_regime !== 'franchise' ? field('Périodicité de la TVA', sel('tva_periodicite', [{ value: 'trimestrielle', label: 'Trimestrielle' }, { value: 'mensuelle', label: 'Mensuelle' }])) : h('div')));
    return out;
  }
  function s3() {
    if (!isSoc()) return [h('div', { class: 'infobox' }, 'Entreprise individuelle : tu es seul associé à 100 %. Le CA encaissé devient ton revenu (BNC/BIC) : rien à distribuer, pas de flat tax.'), preview];
    const out = [];
    const box = h('div');
    const drawAssoc = () => {
      clear(box);
      const total = f.associes.reduce((s, a) => s + a.part, 0);
      box.append(h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Associé'), h('th', { class: 'r' }, 'Part (%)'), h('th'))),
        h('tbody', null, f.associes.map((a, i) => {
          const n = h('input', { type: 'text', value: a.nom, disabled: a.moi }); n.addEventListener('input', () => { a.nom = n.value; });
          const pt = h('input', { type: 'number', min: 0, max: 100, step: 1, value: Math.round(a.part * 100), style: { textAlign: 'right' } });
          pt.addEventListener('input', () => { a.part = Math.min(100, Math.max(0, +pt.value || 0)) / 100; if (a.moi) f.part = a.part; drawPreview(); tot.textContent = totalText(); tot.className = 'note' + (Math.abs(f.associes.reduce((s, x) => s + x.part, 0) - 1) > 0.005 ? ' neg' : ''); });
          return h('tr', null, h('td', null, n, a.moi ? h('span', { class: 'sub' }, 'C’est moi') : null), h('td', { style: { width: '110px' } }, pt), h('td', { style: { width: '40px' } }, a.moi ? null : h('button', { class: 'btn sm ghost danger', type: 'button', onClick: () => { f.associes.splice(i, 1); drawAssoc(); } }, icon('trash', 14))));
        }))));
      const totalText = () => `Total des parts : ${Math.round(f.associes.reduce((s, a) => s + a.part, 0) * 100)} %`;
      const tot = h('div', { class: 'note' + (Math.abs(total - 1) > 0.005 ? ' neg' : '') }, totalText());
      box.append(tot, h('button', { class: 'btn sm', type: 'button', style: { marginTop: '8px' }, onClick: () => { f.associes.push({ nom: '', part: 0, moi: false }); drawAssoc(); } }, icon('plus', 14), 'Ajouter un associé'));
    };
    drawAssoc();
    out.push(h('div', { class: 'grp' }, 'Associés et parts'), box);
    out.push(h('div', { class: 'grp', style: { marginTop: '6px' } }, 'Ma rémunération'));
    out.push(h('div', { class: 'grid3' },
      field('Politique', sel('mode', [{ value: 'dividendes', label: 'Surtout des dividendes' }, { value: 'salaire', label: 'Surtout un salaire' }, { value: 'mixte', label: 'Salaire + dividendes' }]), 'Indicatif : sert aux estimations.'),
      field('Salaire net annuel prévu (€)', (() => { const el = h('input', { type: 'number', min: 0, step: 500, value: f.remuneration.salaire_net_annuel || '' }); el.addEventListener('input', () => { f.remuneration.salaire_net_annuel = +el.value || 0; drawPreview(); }); return el; })(), 'Net avant impôt ; charges ajoutées automatiquement.'),
      field('Dividendes annuels prévus (€)', (() => { const el = h('input', { type: 'number', min: 0, step: 500, value: f.remuneration.dividendes_annuels || '' }); el.addEventListener('input', () => { f.remuneration.dividendes_annuels = +el.value || 0; drawPreview(); }); return el; })(), 'Vide = tout le bénéfice distribuable.')));
    // le sélecteur « Politique » écrit dans f.mode : on le recopie dans remuneration
    out.push(preview);
    return out;
  }
  // `sel('mode')` stocke dans f.mode : recopie vers remuneration.mode
  const syncMode = () => { if (f.mode) f.remuneration.mode = f.mode; };

  function metaOut() {
    syncMode();
    const meta = { ...(p ? p.meta : {}), forme: f.forme, date_debut: f.date_debut, libelle_activite: f.libelle_activite, siret: f.siret, cloture: f.cloture, tva_regime: f.tva_regime, tva_periodicite: f.tva_periodicite,
      urssaf_periodicite: f.urssaf_periodicite, versement_liberatoire: isMicro() && !!f.versement_liberatoire, acre: isMicro() && !!f.acre, caisse: f.caisse, artisan: f.artisan === true || f.artisan === 'true',
      tmi: Number(f.tmi), capital: Number(f.capital) || 0, gerant_majoritaire: f.gerant_majoritaire !== false, associes: f.associes, remuneration: f.remuneration, premiere_cloture: f.premiere_cloture || '' };
    return meta;
  }
  function drawPreview() {
    clear(preview);
    if (step !== steps().length - 1 && step !== 1) return;
    const meta = metaOut(), pr = { ...(p || {}), id: (p && p.id) || 'new', nom: f.nom || 'Entreprise', part: f.part, meta, type: 'Entreprise' };
    const dl = E.deadlinesFor(pr, +(f.date_debut || '2027').slice(0, 4) + (isSoc() ? 1 : 0)).slice(0, 4);
    preview.append(h('div', { class: 'grp' }, 'Ce que cela implique'), h('ul', { class: 'ent-list' }, E.obligationsResume(meta).map((t) => h('li', null, t))),
      dl.length ? h('div', { class: 'note' }, 'Premières échéances : ', dl.map((d) => `${d.label} (${fmtDate(d.date)})`).slice(0, 3).join(' · ')) : null);
  }
  function drawStep() {
    clear(body); clear(stepper);
    steps().forEach((t, i) => stepper.append(h('button', { type: 'button', class: 'ent-step' + (i === step ? ' on' : i < step ? ' done' : ''), onClick: () => { step = i; drawStep(); } }, h('b', null, i + 1), t)));
    body.append(...[s1, s2, s3][step](), err);
    back.style.visibility = step ? 'visible' : 'hidden';
    next.textContent = step === steps().length - 1 ? (editing ? 'Enregistrer' : 'Créer l’entreprise') : 'Suivant';
    drawPreview();
  }
  const back = h('button', { class: 'btn', type: 'button', onClick: () => { step = Math.max(0, step - 1); err.textContent = ''; drawStep(); } }, 'Retour');
  const next = h('button', { class: 'btn primary lg', type: 'button' }, 'Suivant');
  next.addEventListener('click', async () => {
    err.textContent = '';
    if (step === 0 && !String(f.nom).trim()) { err.textContent = 'Donne un nom à l’entreprise.'; return; }
    if (step === 0 && !/^\d{4}-\d{2}-\d{2}$/.test(f.date_debut || '')) { err.textContent = 'Indique la date de début d’activité.'; return; }
    if (step < steps().length - 1) { step++; drawStep(); return; }
    syncMode();
    if (isSoc() && Math.abs(f.associes.reduce((s, a) => s + a.part, 0) - 1) > 0.005) { err.textContent = 'Les parts des associés doivent totaliser 100 %.'; return; }
    const id = editing ? p.id : uuid();
    const me = f.associes.find((a) => a.moi);
    const part = isSoc() ? (me ? me.part : f.part) : 1;
    const item = { ...(editing ? p : {}), id, nom: String(f.nom).trim(), type: 'Entreprise', part, devise: 'EUR', note: f.note || '', meta: metaOut() };
    if (await ops([upsert('projet', item)], editing ? 'Entreprise modifiée' : 'Entreprise créée')) { m.close(); if (onDone) onDone(id); }
  });
  const m = modal({ title: editing ? `Entreprise « ${p.nom} »` : 'Nouvelle entreprise', sub: 'Quelques questions pour estimer tes charges, tes impôts et ton planning de déclarations', width: 720,
    body: [stepper, body],
    footer: [editing ? h('button', { class: 'btn danger', type: 'button', onClick: async () => { if (await deleteEntreprise(p)) { m.close(); if (onDone) onDone(''); } } }, icon('trash', 15), 'Supprimer') : null, h('span', { class: 'sp' }), back, next] });
  drawStep();
  return m;
}

// ───────────────────────── Clients ─────────────────────────
export function openClientForm(p, c = {}) {
  const editing = !!c.id;
  const nom = h('input', { type: 'text', value: c.nom || '', placeholder: 'Nom du client' });
  const dev = select(CURRENCIES.map((x) => ({ value: x.code, label: x.label })), c.devise || 'EUR');
  const tjm = h('input', { type: 'number', min: 0, step: 10, value: c.tjm || '' });
  const tva = h('input', { type: 'number', min: 0, max: 30, step: 0.5, value: c.tva != null ? +(c.tva * 100).toFixed(2) : 0 });
  const micro = select([{ value: 'Oui', label: 'Oui — compte dans le plafond et la TVA' }, { value: 'Non', label: 'Non — hors de ce calcul' }], c.micro || 'Oui');
  const note = h('textarea', null, c.note || '');
  const m = modal({ title: editing ? 'Modifier le client' : 'Nouveau client', sub: p.nom, width: 560,
    body: [field('Client', nom), h('div', { class: 'grid3' }, field('Devise', dev), field('TJM', tjm), field('TVA (%)', tva, 'Franchise de TVA : 0 %')), field('Entre dans le calcul des plafonds ?', micro), field('Note', note)],
    footer: [editing ? h('button', { class: 'btn danger', onClick: async () => { if (await confirmBox('Supprimer ce client ? Ses factures restent visibles.', { ok: 'Supprimer', danger: true })) { if (await ops([del('client', c.id)], 'Client supprimé')) m.close(); } } }, icon('trash', 15), 'Supprimer') : null,
      h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'),
      h('button', { class: 'btn primary lg', onClick: async () => { if (!nom.value.trim()) return toast('Nom obligatoire', 'error'); if (await ops([upsert('client', { ...c, id: c.id || 0, nom: nom.value.trim(), devise: dev.value, tjm: +tjm.value || 0, tva: (+tva.value || 0) / 100, micro: micro.value, note: note.value.trim(), projetId: p.id })], 'Client enregistré')) m.close(); } }, 'Enregistrer')] });
  nom.focus();
}

// ───────────────────────── Facturation du mois ─────────────────────────
export function openBilling(p, month = todayMonth(), { onDone } = {}) {
  const meta = E.normalizeMeta(p.meta, p, S);
  if (!clientsOf(p).length) { toast('Ajoute d’abord un client à cette entreprise.', 'error'); return openClientForm(p); }
  const monthIn = h('input', { type: 'month', value: month });
  const box = h('div'), totalEl = h('div', { class: 'infobox num' });
  const statut = { v: 'Planifiée' };
  const dateIn = h('input', { type: 'date', value: S.today });
  let rows = [];
  const draw = () => {
    clear(box);
    const mth = monthIn.value || month;
    rows = E.billingLines(S, p, mth).map((r) => ({ ...r, in: h('input', { type: 'number', min: 0, step: 0.5, value: r.jours || '', placeholder: '0', style: { textAlign: 'right' }, disabled: r.locked }), tin: h('input', { type: 'number', min: 0, step: 10, value: r.tjm || '', style: { textAlign: 'right' }, disabled: r.locked }) }));
    const wd = E.workingDays(mth);
    box.append(h('div', { class: 'note', style: { marginBottom: '8px' } }, `${monthLong(mth)} : ${wd} jours ouvrés (hors jours fériés). Saisis les jours travaillés pour chaque client : la facture HT se calcule toute seule.`),
      h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Client'), h('th', { class: 'r' }, 'Jours'), h('th', { class: 'r' }, 'TJM'), h('th', { class: 'r' }, 'HT'), h('th', { class: 'r' }, 'TTC'))),
        h('tbody', null, rows.map((r) => { const ht = h('td', { class: 'r num' }), ttc = h('td', { class: 'r num' }); r.htEl = ht; r.ttcEl = ttc;
          return h('tr', null, h('td', null, r.client.nom, h('span', { class: 'sub' }, r.invoice ? `${r.invoice.numero} · ${r.invoice.statut}${r.locked ? ' (déjà émise)' : ''}` : `TVA ${Math.round((r.tva || 0) * 100)} % · ${r.devise}`)), h('td', { style: { width: '90px' } }, r.in), h('td', { style: { width: '100px' } }, r.tin), ht, ttc); }))));
    const upd = () => {
      let sumEur = 0, any = false;
      for (const r of rows) { const a = E.invoiceAmounts({ jours: num(r.in), tjm: num(r.tin), tva: r.tva }); r.amt = a; r.htEl.textContent = a.ht ? money(a.ht, r.devise, 2) : '—'; r.ttcEl.textContent = a.ttc ? money(a.ttc, r.devise, 2) : '—'; if (a.ht) any = true; sumEur += a.ht * rateToEur(r.devise); }
      totalEl.textContent = any ? `Total à facturer : ${eur(sumEur, 2)} HT${meta.tva_regime === 'franchise' ? ' (TVA non applicable)' : ''}` : 'Renseigne les jours travaillés pour calculer la facture.';
    };
    rows.forEach((r) => { r.in.addEventListener('input', upd); r.tin.addEventListener('input', upd); }); upd();
    if (rows[0] && !rows[0].locked) setTimeout(() => rows[0].in.focus(), 30);
  };
  monthIn.addEventListener('change', draw);
  const go = async () => {
    const mth = monthIn.value; const list = [];
    for (const r of rows) {
      if (r.locked) continue;
      const jours = num(r.in); if (!(jours > 0)) continue;
      const base = r.invoice ? { ...r.invoice } : { projetId: p.id, client: r.client.nom, periode: mth, statut: 'Planifiée' };
      list.push(upsert('invoice', { ...base, id: base.id || 0, projetId: p.id, periode: mth, jours, tjm: num(r.tin), devise: r.devise, tva: r.tva || 0, ht: 0,
        statut: statut.v, emission: statut.v === 'Envoyée' ? dateIn.value : (base.emission || '') }));
    }
    if (!list.length) return toast('Saisis au moins un nombre de jours.', 'error');
    if (await ops(list, `${list.length} facture${list.length > 1 ? 's' : ''} ${statut.v === 'Envoyée' ? 'créée' + (list.length > 1 ? 's' : '') + ' et marquée' + (list.length > 1 ? 's' : '') + ' envoyée' + (list.length > 1 ? 's' : '') : 'préparée' + (list.length > 1 ? 's' : '')}`)) { m.close(); if (onDone) onDone(); }
  };
  const seg = segmented([{ value: 'Planifiée', label: 'Brouillon (à envoyer plus tard)' }, { value: 'Envoyée', label: 'Envoyée au client' }], statut.v, (v) => { statut.v = v; dateRow.style.display = v === 'Envoyée' ? '' : 'none'; });
  const dateRow = h('div', { style: { display: 'none' } }, field('Date de la facture', dateIn));
  const m = modal({ title: 'Facturation du mois', sub: `${p.nom} — combien de jours as-tu travaillé ?`, width: 680, body: [field('Mois de la prestation', monthIn), box, totalEl, field('État de la facture', seg), dateRow,
    h('div', { class: 'note' }, 'Après création, ouvre la facture pour l’imprimer ou la recopier dans Tiime (ou ton outil de facturation électronique).')],
  footer: [h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'), h('button', { class: 'btn primary lg', onClick: go }, icon('check', 17), 'Créer les factures')] });
  draw();
  return m;
}

// ───────────────────────── Facture ─────────────────────────
export function openInvoiceForm(p, inv = {}) {
  const editing = !!inv.id, paid = inv.statut === 'Payée';
  const clients = clientsOf(p);
  if (!clients.length) { toast('Ajoute d’abord un client.', 'error'); return openClientForm(p); }
  const cl = select(clients.map((c) => ({ value: c.nom, label: c.nom })), inv.client || clients[0].nom);
  const per = h('input', { type: 'month', value: inv.periode || todayMonth() });
  const jours = h('input', { type: 'number', step: 0.5, min: 0, value: inv.jours ?? '' });
  const tjm = h('input', { type: 'number', step: 10, min: 0, value: inv.tjm ?? '' });
  const dev = select(CUR_CODES, inv.devise || 'EUR');
  const tva = h('input', { type: 'number', step: 0.5, min: 0, max: 30, value: inv.tva != null ? +(inv.tva * 100).toFixed(2) : 0 });
  const emi = h('input', { type: 'date', value: inv.emission || '' });
  const ech = h('input', { type: 'date', value: inv.echeance || '' });
  const st = select(paid ? ['Payée'] : ['Planifiée', 'Envoyée'], inv.statut || 'Planifiée', paid ? { disabled: true } : {});
  const ref = h('input', { type: 'text', value: inv.refExt || '', placeholder: 'ex. n° ou lien de la facture sur Tiime' });
  const note = h('textarea', null, inv.note || '');
  const tot = h('div', { class: 'infobox num' });
  const fill = () => { const c = clients.find((x) => x.nom === cl.value); if (c) { tjm.value = c.tjm || ''; dev.value = c.devise; tva.value = +(c.tva * 100).toFixed(2); } };
  if (!editing) fill();
  cl.addEventListener('change', fill);
  const upd = () => { const a = E.invoiceAmounts({ jours: +jours.value, tjm: +tjm.value, tva: (+tva.value || 0) / 100 }); tot.textContent = `HT ${money(a.ht, dev.value, 2)} · TVA ${money(a.tva, dev.value, 2)} · TTC ${money(a.ttc, dev.value, 2)}`; };
  [jours, tjm, tva, dev, cl].forEach((x) => x.addEventListener('input', upd)); upd();
  const err = h('div', { class: 'err' });
  const save = async () => {
    if (!(+jours.value > 0) || !(+tjm.value > 0)) { err.textContent = 'Renseigne le nombre de jours et le TJM.'; return; }
    const item = { ...inv, id: inv.id || 0, projetId: p.id, client: cl.value, periode: per.value, jours: +jours.value, tjm: +tjm.value, devise: dev.value, ht: 0, tva: (+tva.value || 0) / 100,
      emission: emi.value || (st.value === 'Envoyée' ? S.today : ''), echeance: ech.value || '', statut: st.value, refExt: ref.value.trim(), note: note.value.trim() };
    if (await ops([upsert('invoice', item)], editing ? 'Facture modifiée' : 'Facture créée')) m.close();
  };
  const m = modal({ title: editing ? `Facture ${inv.numero}` : 'Nouvelle facture', sub: p.nom, width: 640,
    body: [h('div', { class: 'grid2' }, field('Client', cl), field('Mois de la prestation', per)),
      h('div', { class: 'grid3' }, field('Jours travaillés', jours), field('TJM', tjm), field('Devise', dev)),
      h('div', { class: 'grid3' }, field('TVA (%)', tva), field('Date de facture', emi), field('Échéance de paiement', ech, 'Vide = 30 jours')), field('Statut', st), tot,
      field('Référence sur la plateforme de facturation (Tiime…)', ref, 'Pour retrouver la facture émise en facturation électronique'),
      paid ? h('div', { class: 'note' }, 'Facture payée : si tu changes le montant, modifie aussi l’opération « Prestations » associée dans Opérations.') : null, field('Note', note), err],
    footer: [editing ? h('button', { class: 'btn danger', onClick: async () => { if (await confirmBox(`Supprimer la facture ${inv.numero} ?`, { ok: 'Supprimer', danger: true })) { if (await ops([del('invoice', inv.id)], 'Facture supprimée')) m.close(); } } }, icon('trash', 15), 'Supprimer') : null,
      editing ? h('button', { class: 'btn', onClick: () => { m.close(); openInvoicePrint(p, inv); } }, icon('file', 15), 'Voir / imprimer') : null,
      h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'), h('button', { class: 'btn primary lg', onClick: save }, 'Enregistrer')] });
}

export async function sendInvoice(inv) { await ops([upsert('invoice', { ...inv, statut: 'Envoyée', emission: inv.emission || S.today })], `${inv.numero} marquée comme envoyée`); }

// Paiement reçu : écritures + montants à mettre de côté affichés AVANT de confirmer
export function payInvoice(p, inv) {
  const d = h('input', { type: 'date', value: S.today });
  const box = h('div');
  const rate = rateToEur(inv.devise);
  const draw = () => {
    clear(box);
    const r = E.reserveOnPayment(S, p, { ht: inv.ht * rate, ttc: inv.ttc * rate, date: d.value || S.today });
    box.append(h('div', { class: 'grp' }, 'À mettre de côté sur ce paiement (estimation)'),
      h('div', { class: 'cashlist' }, r.items.map((i) => h('div', { class: 'cashrow' }, h('div', null, h('b', null, i.label)), h('div', { class: 'num v' }, eur(i.amount, 2)))),
        h('div', { class: 'cashrow total' }, h('div', null, h('b', null, 'Total à provisionner'), h('span', { class: 'sub' }, `Il te reste environ ${eur(r.net, 2)} sur ${eur(inv.ttc * rate, 2)} encaissés`)), h('div', { class: 'num v' }, eur(r.total, 2)))));
  };
  d.addEventListener('change', draw); draw();
  const go = async () => {
    const base = { date: d.value, activite: 'Entreprise', sens: 'Revenu', devise: inv.devise, tiers: inv.client, periode: inv.periode, nature: 'Courant', projetId: p.id };
    const list = [upsert('invoice', { ...inv, statut: 'Payée', paiement: d.value, emission: inv.emission || d.value }),
      upsert('tx', { ...base, categorie: 'Prestations', libelle: `Facture ${inv.numero} — ${inv.client}`, montant: inv.ht, ref: `FAC${inv.id}` })];
    if (inv.ttc - inv.ht > 0.005) list.push(upsert('tx', { ...base, categorie: 'TVA collectée', libelle: `TVA facture ${inv.numero}`, montant: inv.ttc - inv.ht, nature: 'Financement', ref: `FACTVA${inv.id}` }));
    if (await ops(list, `Paiement de ${money(inv.ttc, inv.devise, 2)} enregistré`)) m.close();
  };
  const m = modal({ title: 'Paiement reçu', sub: `${inv.numero} · ${inv.client} · ${monthLong(inv.periode)}`, width: 520,
    body: [h('div', { class: 'infobox' }, `Montant : ${money(inv.ttc, inv.devise, 2)} TTC (${money(inv.ht, inv.devise, 2)} HT). Une opération « Prestations » sera ajoutée automatiquement à l’entreprise.`), field('Date de réception du paiement', d), box],
    footer: [h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'), h('button', { class: 'btn primary lg', onClick: go }, icon('check', 17), 'Paiement reçu')] });
}
export async function unpayInvoice(inv) {
  if (!(await confirmBox(`Annuler le paiement de ${inv.numero} ? Les opérations liées seront supprimées.`, { ok: 'Annuler le paiement', danger: true }))) return;
  const list = [upsert('invoice', { ...inv, statut: 'Envoyée', paiement: '' })];
  for (const t of S.data.tx) if (t.ref === `FAC${inv.id}` || t.ref === `FACTVA${inv.id}`) list.push(del('tx', t.id));
  await ops(list, 'Paiement annulé');
}

// ───────────────────────── Facture imprimable ─────────────────────────
export function openInvoicePrint(p, inv) {
  const meta = E.normalizeMeta(p.meta, p, S), F = E.FORMES[meta.forme];
  const dueDate = inv.echeance || (inv.emission ? addDays(inv.emission, 30) : '');
  const mentions = E.invoiceMentions(p, inv);
  const doc = h('div', { class: 'invoice-print' },
    h('div', { class: 'ip-head' }, h('div', null, h('h1', null, p.nom), h('div', { class: 'ip-sub' }, F.short + (meta.siret ? ` — SIRET ${meta.siret}` : ''), meta.libelle_activite ? h('div', null, meta.libelle_activite) : null)),
      h('div', { class: 'ip-num' }, h('b', null, `Facture ${inv.numero || '(brouillon)'}`), h('div', null, `Date : ${inv.emission ? fmtDate(inv.emission) : '—'}`), h('div', null, `Échéance : ${dueDate ? fmtDate(dueDate) : '30 jours'}`))),
    h('div', { class: 'ip-client' }, h('div', { class: 'lbl' }, 'Facturé à'), h('b', null, inv.client), h('div', { class: 'ip-sub' }, 'SIREN du client : à compléter')),
    h('table', { class: 'ip-table' }, h('thead', null, h('tr', null, h('th', null, 'Désignation'), h('th', { class: 'r' }, 'Quantité'), h('th', { class: 'r' }, 'Prix unitaire HT'), h('th', { class: 'r' }, 'TVA'), h('th', { class: 'r' }, 'Total HT'))),
      h('tbody', null, h('tr', null, h('td', null, `Prestation de conseil — ${monthLong(inv.periode)}`), h('td', { class: 'r' }, `${inv.jours} jour${inv.jours > 1 ? 's' : ''}`), h('td', { class: 'r' }, money(inv.tjm, inv.devise, 2)), h('td', { class: 'r' }, inv.tva ? `${Math.round(inv.tva * 100)} %` : '—'), h('td', { class: 'r' }, money(inv.ht, inv.devise, 2))))),
    h('div', { class: 'ip-tot' }, h('div', null, 'Total HT', h('b', null, money(inv.ht, inv.devise, 2))), h('div', null, `TVA${inv.tva ? ` ${Math.round(inv.tva * 100)} %` : ''}`, h('b', null, money(inv.ttc - inv.ht, inv.devise, 2))), h('div', { class: 'big' }, 'Total TTC', h('b', null, money(inv.ttc, inv.devise, 2)))),
    h('ul', { class: 'ip-mentions' }, mentions.map((t) => h('li', null, t))));
  const m = modal({ title: `Facture ${inv.numero || ''}`, sub: 'Aperçu imprimable (PDF : choisis « Enregistrer au format PDF » dans la fenêtre d’impression)', width: 820, body: [doc],
    footer: [h('button', { class: 'btn', onClick: async () => { try { await navigator.clipboard.writeText(E.invoiceLinesText(p, inv)); toast('Lignes de la facture copiées (à coller dans Tiime)'); } catch { toast('Copie impossible', 'error'); } } }, icon('file', 15), 'Copier pour Tiime'),
      h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Fermer'),
      h('button', { class: 'btn primary', onClick: () => { document.body.classList.add('print-invoice'); const off = () => { document.body.classList.remove('print-invoice'); window.removeEventListener('afterprint', off); }; window.addEventListener('afterprint', off); setTimeout(() => window.print(), 50); } }, icon('download', 15), 'Imprimer / PDF')] });
}

// ───────────────────────── Échéance : fait / payé ─────────────────────────
export async function markDeclaration(p, d, statut, rec) {
  if (!statut) { if (rec) await ops([del('declaration', rec.id)], 'Échéance remise à faire'); return; }
  const item = rec ? { ...rec, statut, date: S.today } : { projetId: p.id, code: d.code, periode: d.periode, statut, date: S.today, montant: 0, note: '' };
  await ops([upsert('declaration', rec ? item : { ...item, id: 0 })], statut === 'paye' ? 'Échéance marquée comme payée' : 'Échéance marquée comme faite');
}
