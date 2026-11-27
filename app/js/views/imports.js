// Écran « Opérations à valider » : import d'un relevé de compte (Revolut : CSV, Excel, PDF), tri rapide des lignes,
// validation en un clic. Une ligne validée devient une vraie opération (Opérations + tous les calculs).
// Le fichier est lu localement dans le navigateur ; seules les lignes en attente puis validées sont enregistrées.
import { h, icon, num2, fmtDate, norm, clear, curSym, CUR_CODES } from '../util.js';
import { S, ops, upsert, del, emit, entreprises, immoProjets, isMine, catsFor } from '../state.js';
import { modal, segmented, field, select, confirmBox, toast, empty, pill } from '../ui.js';
import { openTxForm } from '../txform.js';
import { loadXLSX } from '../data.js';
import { parseStatementFile, summarizeParse } from '../revolut.js';
import { classifyLines, findDuplicates } from '../classify.js';

export function meta() { return { title: 'Opérations à valider', sub: 'Import d’un relevé de compte', period: false, immoToggle: false }; }
const lignes = () => S.data.import_lignes || [];
export function badge() { try { return lignes().filter((l) => l.statut === 'attente').length; } catch { return 0; } }

const ACTS = ['Perso', 'Entreprise', 'Immobilier'];
const PREF = 'cockpit.imports.v1';
const loadPref = () => { try { return JSON.parse(localStorage.getItem(PREF) || '{}'); } catch { return {}; } };
const savePref = (o) => { try { localStorage.setItem(PREF, JSON.stringify({ ...loadPref(), ...o })); } catch { /* ignore */ } };
const pref = loadPref();

// ---------- état de l'écran (survit aux rafraîchissements de la page) ----------
const U = {
  filter: 'all', q: '', limit: 150, sel: new Set(), seen: new Set(), edits: new Map(), editTimer: null,
  imp: { activite: pref.activite || 'Perso', projetId: '', compte: pref.compte || 'Revolut', ownName: pref.ownName || '', parsed: null, name: '', busy: false, error: '', touchedAct: false, drag: false },
  hist: false, lots: false, busy: false,
};
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const eff = (l) => (U.edits.has(l.id) ? { ...l, ...U.edits.get(l.id) } : l);
const sensOf = (l) => (l.montant > 0 ? 'Revenu' : 'Dépense');
const catsOf = (act, sens) => catsFor(act, sens);

const projetOptions = (act) => (act === 'Entreprise' ? entreprises() : act === 'Immobilier' ? immoProjets().filter(isMine) : []);
const defaultProjet = (act) => { const l = projetOptions(act); return l.length ? l[0].id : ''; };

// ---------- modifications d'une ligne en attente (enregistrées en arrière-plan, par lots) ----------
function queueEdit(id, patch) {
  U.edits.set(id, { ...(U.edits.get(id) || {}), ...patch });
  clearTimeout(U.editTimer);
  U.editTimer = setTimeout(flushEdits, 900);
}
async function flushEdits() {
  clearTimeout(U.editTimer);
  if (!U.edits.size) return;
  const batch = [...U.edits.entries()];
  const list = batch.map(([id, patch]) => upsert('ligne', { id, ...patch }));
  const ok = await ops(list);
  if (ok) for (const [id, patch] of batch) { const cur = U.edits.get(id); if (cur && JSON.stringify(cur) === JSON.stringify(patch)) U.edits.delete(id); }
}
window.addEventListener('beforeunload', () => { if (U.edits.size) flushEdits(); });

// ---------- lecture d'un fichier ----------
async function loadPdfjs() {
  const m = await import('/vendor/pdf.min.mjs');
  m.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
  return m;
}
async function onFile(file) {
  if (!file) return;
  const im = U.imp;
  im.busy = true; im.error = ''; im.parsed = null; im.name = file.name; emit();
  try {
    const buf = await file.arrayBuffer();
    const u8 = new Uint8Array(buf);
    const isPdf = /\.pdf$/i.test(file.name) || (u8[0] === 0x25 && u8[1] === 0x50);
    const isXls = /\.xlsx?$/i.test(file.name) || (u8[0] === 0x50 && u8[1] === 0x4b);
    const res = await parseStatementFile(u8, { name: file.name, XLSX: isXls ? await loadXLSX() : null, pdfjs: isPdf ? await loadPdfjs() : null });
    if (res.error) im.error = res.error;
    else {
      im.parsed = res;
      // un relevé Revolut Business concerne en général l'entreprise
      if (res.format.includes('business') && !im.touchedAct && entreprises().length) { im.activite = 'Entreprise'; im.projetId = defaultProjet('Entreprise'); }
      if (res.accounts && res.accounts.length === 1 && (!im.compte || im.compte === 'Revolut')) im.compte = `Revolut ${res.accounts[0]}`;
    }
  } catch (e) { im.error = `Lecture impossible : ${e.message || e}. Essaie d’exporter le relevé en CSV ou Excel depuis l’app Revolut.`; }
  im.busy = false; emit();
}

// Préparation de l'ajout : classification + comparaison avec ce qui existe déjà
function prepare(res) {
  const im = U.imp;
  const existing = new Set(lignes().map((l) => l.hash));
  const fresh = res.lines.filter((l) => !existing.has(l.hash));
  const ownNames = im.ownName.trim() ? [im.ownName.trim()] : [];
  const cls = classifyLines(fresh, { tx: S.data.tx, categories: S.data.categories, ownNames }, { activite: im.activite });
  return { fresh, cls, already: res.lines.length - fresh.length, internal: cls.filter((c) => c.ignore).length, dups: cls.filter((c) => c.duplicate && !c.ignore).length, review: cls.filter((c) => !c.ignore && !c.categorie).length };
}

async function addChunk(items, fail) {
  if (!items.length) return;
  if (await ops(items.map((it) => upsert('ligne', it)))) return;
  if (items.length === 1) { fail.n++; return; }          // doublon d'empreinte ou refus : on isole la ligne fautive
  const mid = items.length >> 1;
  await addChunk(items.slice(0, mid), fail); await addChunk(items.slice(mid), fail);
}
async function addToQueue() {
  const im = U.imp, res = im.parsed;
  if (!res || U.busy) return;
  if (im.activite !== 'Perso' && projetOptions(im.activite).length && !im.projetId) im.projetId = defaultProjet(im.activite);
  U.busy = true; emit();
  const p = prepare(res);
  const d = new Date(), stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const tag = `lot:${stamp}:${im.name}`.slice(0, 120);
  const items = p.fresh.map((l, i) => {
    const c = p.cls[i];
    const it = { id: uuid(), _insert: true, date: l.date, libelle: l.libelle, montant: l.montant, devise: l.devise, typeOp: l.typeOp || '', source: l.source, compte: im.compte.trim(), statut: c.ignore ? 'ignore' : 'attente',
      activite: c.activite, categorie: c.categorie, detail: tag, nature: c.nature, projetId: im.activite === 'Perso' ? '' : im.projetId, hash: l.hash, note: c.ignore ? c.ignoreReason : '' };
    if (l.solde != null) it.solde = l.solde;
    return it;
  });
  savePref({ activite: im.activite, compte: im.compte, ownName: im.ownName });
  const fail = { n: 0 };
  for (const part of chunk(items, 200)) await addChunk(part, fail);
  U.busy = false;
  const added = items.length - fail.n;
  im.parsed = null; im.name = '';
  toast(`${added} ligne${added > 1 ? 's' : ''} ajoutée${added > 1 ? 's' : ''} à valider${p.internal ? ` (dont ${p.internal} mouvement${p.internal > 1 ? 's' : ''} interne${p.internal > 1 ? 's' : ''} ignoré${p.internal > 1 ? 's' : ''} automatiquement)` : ''}${fail.n ? ` — ${fail.n} refusée${fail.n > 1 ? 's' : ''}` : ''}`, fail.n ? 'error' : 'ok', 5000);
  emit();
}

// ---------- validation / ignorer / annuler ----------
async function runBatches(lines, build, okMsg) {
  U.busy = true; emit();
  let done = 0;
  try {
    for (const part of chunk(lines, 100)) {
      const list = part.flatMap(build);
      if (!(await ops(list))) { toast(`Arrêt après ${done} ligne${done > 1 ? 's' : ''} : la suivante a été refusée.`, 'error'); break; }
      done += part.length;
    }
  } finally { U.busy = false; }
  if (done && okMsg) toast(okMsg(done));
  emit();
  return done;
}
function txItemOf(l) {
  const sens = sensOf(l);
  const ref = 'REV:' + l.hash;
  return { date: l.date, activite: l.activite, sens, categorie: l.categorie, libelle: (l.libelle || '').trim() || l.categorie, montant: Math.abs(l.montant), devise: l.devise,
    tiers: '', projetId: l.activite === 'Perso' ? '' : (l.projetId || ''), ref, nature: l.nature || '', note: `Import ${l.source}${l.compte ? ' · ' + l.compte : ''}` };
}
async function validate(lines) {
  lines = lines.map(eff);
  if (!lines.length) return toast('Aucune ligne sélectionnée.', 'error');
  await flushEdits();
  // catégories manquantes : on les demande avant de valider
  const missing = lines.filter((l) => !l.categorie);
  let todo = lines;
  if (missing.length) {
    const patch = await askCategories(missing);
    if (patch === null) return;
    for (const [id, p] of patch) { queueEdit(id, p); }
    todo = lines.map((l) => (patch.has(l.id) ? { ...l, ...patch.get(l.id) } : l)).filter((l) => l.categorie);
    const skipped = lines.length - todo.length;
    if (skipped) toast(`${skipped} ligne${skipped > 1 ? 's' : ''} sans catégorie laissée${skipped > 1 ? 's' : ''} en attente.`);
    if (!todo.length) return;
  }
  const haveTx = new Set(S.data.tx.map((t) => t.ref).filter(Boolean));
  const n = await runBatches(todo, (l) => {
    const out = [];
    if (!haveTx.has('REV:' + l.hash)) out.push(upsert('tx', txItemOf(l)));
    out.push(upsert('ligne', { id: l.id, statut: 'valide', txRef: 'REV:' + l.hash, categorie: l.categorie, activite: l.activite, libelle: l.libelle, projetId: l.projetId || '', nature: l.nature || '' }));
    return out;
  }, (k) => `${k} opération${k > 1 ? 's' : ''} validée${k > 1 ? 's' : ''} : elle${k > 1 ? 's sont' : ' est'} maintenant dans Opérations et dans tous les calculs`);
  for (const l of todo.slice(0, n)) { U.sel.delete(l.id); U.edits.delete(l.id); }
}
async function ignoreLines(lines) {
  if (!lines.length) return;
  await flushEdits();
  await runBatches(lines, (l) => [upsert('ligne', { id: l.id, statut: 'ignore', note: l.note || 'Ignorée' })], (k) => `${k} ligne${k > 1 ? 's' : ''} ignorée${k > 1 ? 's' : ''} (retrouvable${k > 1 ? 's' : ''} dans l’historique)`);
  for (const l of lines) U.sel.delete(l.id);
}
async function backToPending(lines) {
  await runBatches(lines, (l) => [upsert('ligne', { id: l.id, statut: 'attente', note: '' })], (k) => `${k} ligne${k > 1 ? 's' : ''} remise${k > 1 ? 's' : ''} en attente`);
}
async function unvalidate(l) {
  const tx = S.data.tx.find((t) => t.ref === l.txRef);
  if (!(await confirmBox(`Annuler la validation de « ${l.libelle} » ? L’opération correspondante sera supprimée et la ligne reviendra dans les opérations à valider.`, { ok: 'Annuler la validation', danger: true }))) return;
  const list = [upsert('ligne', { id: l.id, statut: 'attente', txRef: '' })];
  if (tx) list.unshift(del('tx', tx.id));
  await ops(list, 'Validation annulée');
}
async function deleteLot(tag, pendingLines) {
  if (!(await confirmBox(`Supprimer les ${pendingLines.length} ligne(s) encore en attente de ce fichier ? Les lignes déjà validées ou ignorées sont conservées. Tu pourras ré-importer le fichier.`, { ok: 'Supprimer', danger: true }))) return;
  await runBatches(pendingLines, (l) => [del('ligne', l.id)], (k) => `${k} ligne${k > 1 ? 's' : ''} supprimée${k > 1 ? 's' : ''}`);
}

// Demande une catégorie pour les lignes qui n'en ont pas (un choix par activité et sens) ; renvoie Map id → patch, ou null si annulé
function askCategories(missing) {
  return new Promise((resolve) => {
    const groups = new Map();
    for (const l of missing) { const k = `${l.activite}|${sensOf(l)}`; (groups.get(k) || groups.set(k, []).get(k)).push(l); }
    const sels = [];
    const rows = [...groups].map(([k, ls]) => {
      const [act, sens] = k.split('|');
      const opts = [{ value: '', label: '— Laisser en attente —' }, ...catsOf(act, sens).map((c) => ({ value: c.categorie, label: `${c.icone || ''} ${c.categorie}`.trim() }))];
      const sel = select(opts, '');
      sels.push([k, ls, sel]);
      return field(`${ls.length} ${sens === 'Revenu' ? 'revenu' : 'dépense'}${ls.length > 1 ? 's' : ''} · ${act}`, sel, ls.slice(0, 3).map((l) => l.libelle).join(' · ') + (ls.length > 3 ? '…' : ''));
    });
    let done = false;
    const m = modal({ title: 'Choisis une catégorie', sub: `${missing.length} ligne${missing.length > 1 ? 's' : ''} sans catégorie`, width: 520, onClose: () => { if (!done) resolve(null); }, body: [h('p', { class: 'sec' }, 'Ces lignes n’ont pas pu être classées automatiquement. Une catégorie par groupe suffit ; tu pourras corriger une ligne ensuite dans Opérations.'), ...rows],
      footer: [h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'), h('button', { class: 'btn primary lg', onClick: () => {
        const patch = new Map();
        for (const [, ls, sel] of sels) if (sel.value) { const c = catsOf(ls[0].activite, sensOf(ls[0])).find((x) => x.categorie === sel.value); for (const l of ls) patch.set(l.id, { categorie: sel.value, nature: c ? c.nature : '' }); }
        done = true; m.close(); resolve(patch);
      } }, 'Valider')] });
  });
}

// ---------- affichage ----------
const sumByCur = (ls) => { const m = new Map(); for (const l of ls) m.set(l.devise, (m.get(l.devise) || 0) + l.montant); return [...m].map(([c, v]) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${num2(Math.abs(v))} ${curSym(c)}`).join(' · '); };

function importCard() {
  const im = U.imp;
  const input = h('input', { type: 'file', accept: '.csv,.xlsx,.xls,.pdf,text/csv,application/pdf', class: 'imp-file', 'aria-label': 'Fichier du relevé' });
  input.addEventListener('change', () => { const f = input.files && input.files[0]; if (f) onFile(f); });
  const drop = h('div', { class: 'imp-drop' + (im.drag ? ' over' : '') + (im.busy ? ' busy' : ''), role: 'button', tabindex: 0, 'aria-label': 'Déposer ou choisir un relevé', onClick: () => input.click(), onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } } },
    icon('upload', 26), h('div', { class: 'imp-drop-t' }, im.busy ? `Lecture de ${im.name}…` : 'Glisse ton relevé ici'), h('div', { class: 'muted' }, 'CSV, Excel ou PDF Revolut — lu sur cet appareil, rien n’est envoyé avant ton accord'),
    h('button', { type: 'button', class: 'btn primary', onClick: (e) => { e.stopPropagation(); input.click(); } }, icon('folder', 16), 'Choisir un fichier'), input);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) onFile(f); });

  const compte = h('input', { type: 'text', value: im.compte, placeholder: 'ex. Revolut perso', maxlength: 40 });
  compte.addEventListener('input', () => { im.compte = compte.value; });
  const own = h('input', { type: 'text', value: im.ownName, placeholder: 'Prénom Nom', autocomplete: 'name' });
  own.addEventListener('input', () => { im.ownName = own.value; });
  const act = select(ACTS.map((a) => ({ value: a, label: a })), im.activite);
  const projWrap = h('div');
  const drawProj = () => {
    clear(projWrap);
    const list = projetOptions(im.activite);
    if (!list.length) return;
    const ps = select([...(list.length > 1 || im.activite === 'Immobilier' ? [{ value: '', label: '— Aucun —' }] : []), ...list.map((p) => ({ value: p.id, label: p.nom }))], im.projetId || (list.length === 1 || im.activite === 'Entreprise' ? list[0].id : ''));
    if (!im.projetId && im.activite === 'Entreprise') im.projetId = ps.value;
    ps.addEventListener('change', () => { im.projetId = ps.value; });
    projWrap.append(field(im.activite === 'Entreprise' ? 'Entreprise' : 'Projet immobilier', ps));
  };
  act.addEventListener('change', () => { im.activite = act.value; im.touchedAct = true; im.projetId = defaultProjet(im.activite); drawProj(); if (im.parsed) emit(); });
  drawProj();
  const opts = h('div', { class: 'imp-opts' }, field('Nom du compte importé', compte), field('Activité du compte', act), projWrap,
    field('Mon nom (repère mes virements entre comptes)', own, 'Facultatif : « Prénom Nom » comme sur Revolut'));

  const help = h('details', { class: 'details imp-help' }, h('summary', null, icon('right', 14), 'Comment obtenir mon relevé Revolut ?'),
    h('ol', { class: 'steps' }, h('li', null, 'App Revolut › Comptes › ouvre le compte voulu › « … » (Plus) › Relevé.'), h('li', null, 'Choisis la période, puis le format Excel ou CSV (le plus fiable) — le PDF fonctionne aussi.'),
      h('li', null, 'Reviens ici et dépose le fichier : les opérations déjà importées sont reconnues et ne sont jamais ajoutées deux fois.')));

  let preview = null;
  if (im.error) preview = h('div', { class: 'infobox imp-err' }, icon('alert', 16), h('div', null, im.error));
  else if (im.parsed) preview = previewBox(im.parsed);
  return h('div', { class: 'card' }, h('header', null, h('h2', null, 'Importer un relevé'), h('span', { class: 'sub' }, 'Revolut · CSV, Excel, PDF')), drop, opts, preview, help);
}

function previewBox(res) {
  const p = prepare(res);
  const sk = summarizeParse(res);
  const skTxt = Object.entries(sk.skippedBy).map(([r, n]) => `${n} ${r}`).join(', ');
  const stat = (v, l, cls = '') => h('div', { class: 'imp-stat ' + cls }, h('b', { class: 'num' }, v), h('span', null, l));
  const sample = p.fresh.slice(0, 6);
  return h('div', { class: 'imp-preview' },
    h('div', { class: 'imp-stats' }, stat(sk.read, 'lignes lues'), stat(p.fresh.length, 'nouvelles', p.fresh.length ? 'good' : ''), stat(p.already, 'déjà importées'), stat(sk.read - sk.kept, 'écartées'), stat(p.internal, 'mouvements internes'), stat(p.dups, 'doublons possibles', p.dups ? 'warn' : '')),
    skTxt ? h('div', { class: 'note' }, `Écartées : ${skTxt}.`) : null,
    ...res.warnings.map((w) => h('div', { class: 'note' }, w)),
    sample.length ? h('table', { class: 'tbl imp-sample' }, h('tbody', null, sample.map((l, i) => h('tr', null, h('td', { class: 'muted' }, fmtDate(l.date)), h('td', null, l.libelle, p.cls[i].ignore ? h('span', { class: 'sub' }, p.cls[i].ignoreReason) : null), h('td', { class: 'muted' }, p.cls[i].categorie || '—'), h('td', { class: 'r num ' + (l.montant > 0 ? 'pos' : '') }, `${l.montant > 0 ? '+' : '−'}${num2(Math.abs(l.montant))} ${curSym(l.devise)}`))))) : null,
    p.fresh.length > sample.length ? h('div', { class: 'muted imp-more' }, `… et ${p.fresh.length - sample.length} autre${p.fresh.length - sample.length > 1 ? 's' : ''}`) : null,
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn primary lg', disabled: !p.fresh.length || U.busy, onClick: addToQueue }, icon('check', 16), p.fresh.length ? `Ajouter ${p.fresh.length} ligne${p.fresh.length > 1 ? 's' : ''} à valider` : 'Rien de nouveau à ajouter'),
      h('button', { class: 'btn', onClick: () => { U.imp.parsed = null; U.imp.name = ''; emit(); } }, 'Annuler')));
}

function listCard() {
  const all = lignes().filter((l) => l.statut === 'attente').map(eff).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.seq || 0) - (a.seq || 0)));
  const dupOf = new Map();
  if (all.length) {
    // doublons : recalculés à chaque affichage (les opérations saisies entre-temps comptent)
    const d = findDuplicates(all.map((l) => ({ date: l.date, libelle: l.libelle, montant: l.montant, devise: l.devise })), S.data.tx);
    all.forEach((l, i) => { if (d[i]) dupOf.set(l.id, d[i]); });
  }
  for (const l of all) if (!U.seen.has(l.id)) { U.seen.add(l.id); if (!dupOf.has(l.id)) U.sel.add(l.id); }
  for (const id of [...U.sel]) if (!all.some((l) => l.id === id)) U.sel.delete(id);
  const q = norm(U.q.trim());
  const review = (l) => !l.categorie || dupOf.has(l.id);
  const shown = all.filter((l) => (U.filter === 'all' || (U.filter === 'in' && l.montant > 0) || (U.filter === 'out' && l.montant < 0) || (U.filter === 'check' && review(l))) && (!q || norm(`${l.libelle} ${l.categorie} ${l.compte}`).includes(q)));
  const view = shown.slice(0, U.limit);
  const nCheck = all.filter(review).length;
  const allOk = all.filter((l) => !dupOf.has(l.id) || U.sel.has(l.id));   // « Tout valider » épargne les doublons probables non cochés
  const nDup = all.length - allOk.length;

  const body = h('div', { class: 'imp-list' });
  const selected = () => all.filter((l) => U.sel.has(l.id));
  const bar = h('div', { class: 'imp-bar' });
  const draw = () => {
    clear(bar);
    const sel = selected();
    const allBox = h('input', { type: 'checkbox', 'aria-label': 'Tout sélectionner', checked: shown.length > 0 && shown.every((l) => U.sel.has(l.id)) });
    allBox.addEventListener('change', () => { for (const l of shown) { if (allBox.checked) U.sel.add(l.id); else U.sel.delete(l.id); } drawRows(); draw(); });
    // catégorie pour toute la sélection
    const optg = (sens, label) => { const names = new Map(); for (const l of sel.filter((x) => sensOf(x) === sens)) for (const c of catsOf(l.activite, sens)) names.set(c.categorie, c); return names.size ? h('optgroup', { label }, [...names.values()].map((c) => h('option', { value: `${sens}|${c.categorie}` }, `${c.icone || ''} ${c.categorie}`.trim()))) : null; };
    const bulk = h('select', { class: 'prefsel', 'aria-label': 'Catégorie pour la sélection', disabled: !sel.length }, h('option', { value: '' }, 'Catégorie pour la sélection…'), optg('Dépense', 'Dépenses'), optg('Revenu', 'Revenus'));
    bulk.addEventListener('change', () => {
      if (!bulk.value) return;
      const [sens, cat] = bulk.value.split('|'); let n = 0;
      for (const l of sel) if (sensOf(l) === sens) { const c = catsOf(l.activite, sens).find((x) => x.categorie === cat); if (c) { queueEdit(l.id, { categorie: cat, nature: c.nature || '' }); n++; } }
      toast(`${n} ligne${n > 1 ? 's' : ''} classée${n > 1 ? 's' : ''} en « ${cat} »`); emit();
    });
    bar.append(h('label', { class: 'imp-all' }, allBox, h('span', null, sel.length ? `${sel.length} sélectionnée${sel.length > 1 ? 's' : ''}` : 'Tout sélectionner')), bulk,
      h('span', { class: 'sp' }), sel.length ? h('span', { class: 'muted num imp-sum' }, sumByCur(sel)) : null,
      h('button', { class: 'btn', disabled: !sel.length || U.busy, onClick: () => ignoreLines(sel) }, 'Ignorer'),
      h('button', { class: 'btn primary', disabled: !sel.length || U.busy, onClick: () => validate(sel) }, icon('check', 16), sel.length ? `Valider (${sel.length})` : 'Valider'));
  };
  const drawRows = () => {
    clear(body);
    if (!view.length) { body.append(empty('Aucune ligne', 'Aucun résultat avec ces filtres.')); return; }
    for (const l of view) body.append(row(l, dupOf.get(l.id), () => { drawRows(); draw(); }));
    if (shown.length > view.length) body.append(h('div', { class: 'imp-moreBtn' }, h('button', { class: 'btn', onClick: () => { U.limit += 200; emit(); } }, `Afficher plus (${shown.length - view.length} restantes)`)));
  };
  drawRows(); draw();
  const search = h('input', { type: 'search', placeholder: 'Rechercher…', value: U.q, 'aria-label': 'Rechercher' });
  search.addEventListener('input', () => { U.q = search.value; clearTimeout(search._t); search._t = setTimeout(emit, 250); });
  return h('div', { class: 'card imp-pending' }, h('header', null, h('h2', null, 'À valider'), h('span', { class: 'sub' }, `${all.length} ligne${all.length > 1 ? 's' : ''}${nCheck ? ` · ${nCheck} à vérifier` : ''}`),
    h('div', { class: 'right' }, all.length ? h('button', { class: 'btn', disabled: U.busy, title: nDup ? 'Les lignes « déjà saisie ? » non cochées sont laissées de côté' : '', onClick: () => validate(allOk) }, icon('check', 16), `Tout valider (${allOk.length})`) : null)),
    all.length ? h('div', { class: 'filters' }, segmented([{ value: 'all', label: 'Tout' }, { value: 'in', label: 'Entrées' }, { value: 'out', label: 'Sorties' }, { value: 'check', label: nCheck ? `À vérifier (${nCheck})` : 'À vérifier' }], U.filter, (v) => { U.filter = v; U.limit = 150; emit(); }, 'sm'), h('div', { class: 'grow' }, icon('search', 17), search)) : null,
    all.length ? bar : null,
    all.length ? body : empty('Rien à valider', 'Importe un relevé ci-dessus : les dépenses et revenus apparaissent ici, déjà classés quand c’est possible.'));
}

function row(l, dup, redraw) {
  const sens = sensOf(l);
  const cb = h('input', { type: 'checkbox', checked: U.sel.has(l.id), 'aria-label': 'Sélectionner' });
  cb.addEventListener('change', () => { if (cb.checked) U.sel.add(l.id); else U.sel.delete(l.id); redraw(); });
  const lib = h('input', { type: 'text', class: 'imp-lib', value: l.libelle, 'aria-label': 'Libellé' });
  lib.addEventListener('change', () => { if (lib.value.trim()) queueEdit(l.id, { libelle: lib.value.trim() }); });
  const cats = catsOf(l.activite, sens);
  const cat = select([{ value: '', label: '— Choisir une catégorie —' }, ...cats.map((c) => ({ value: c.categorie, label: `${c.icone || ''} ${c.categorie}`.trim() })), ...(l.categorie && !cats.some((c) => c.categorie === l.categorie) ? [{ value: l.categorie, label: l.categorie }] : [])], l.categorie || '', { class: 'imp-cat' + (l.categorie ? '' : ' empty'), 'aria-label': 'Catégorie' });
  cat.addEventListener('change', () => { const c = cats.find((x) => x.categorie === cat.value); queueEdit(l.id, { categorie: cat.value, nature: c ? c.nature || '' : '' }); cat.classList.toggle('empty', !cat.value); });
  const act = select(ACTS.map((a) => ({ value: a, label: a })), l.activite, { class: 'imp-act', 'aria-label': 'Activité' });
  act.addEventListener('change', () => {
    const keep = catsOf(act.value, sens).find((c) => c.categorie === l.categorie);
    queueEdit(l.id, { activite: act.value, projetId: act.value === 'Perso' ? '' : defaultProjet(act.value), categorie: keep ? keep.categorie : '', nature: keep ? keep.nature || '' : '' });
    emit();
  });
  const badges = [];
  if (dup) badges.push(h('button', { type: 'button', class: 'pill warn imp-badge', title: `Ressemble à une opération déjà saisie : ${fmtDate(dup.date)} · ${dup.libelle || dup.categorie}. Clique pour la voir.`, onClick: () => openTxForm(dup) }, icon('alert', 12), 'déjà saisie ?'));
  if (!l.categorie) badges.push(h('span', { class: 'pill mute imp-badge' }, 'à classer'));
  if (l.devise !== 'EUR') badges.push(h('span', { class: 'pill info imp-badge' }, l.devise));
  const proj = l.projetId ? (S.data.projets || []).find((p) => p.id === l.projetId) : null;
  return h('div', { class: 'imp-row' + (dup ? ' dup' : '') + (U.sel.has(l.id) ? ' on' : '') },
    h('div', { class: 'imp-c cb' }, cb), h('div', { class: 'imp-c date num' }, fmtDate(l.date).replace(/ \d{4}$/, ''), h('span', null, l.date.slice(0, 4))),
    h('div', { class: 'imp-c lib' }, lib, h('div', { class: 'imp-sub' }, h('span', { class: 'm-date' }, fmtDate(l.date)), [l.typeOp, l.compte, proj ? proj.nom : ''].filter(Boolean).join(' · '), ...badges)),
    h('div', { class: 'imp-c amt num ' + (l.montant > 0 ? 'pos' : '') }, `${l.montant > 0 ? '+' : '−'}${num2(Math.abs(l.montant))} ${curSym(l.devise)}`),
    h('div', { class: 'imp-c act' }, act), h('div', { class: 'imp-c cat' }, cat));
}

function historyCard() {
  const done = lignes().filter((l) => l.statut !== 'attente').sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.seq || 0) - (a.seq || 0)));
  const lotsMap = new Map();
  for (const l of lignes()) { const k = l.detail || '—'; const e = lotsMap.get(k) || { tag: k, n: 0, attente: [], valide: 0, ignore: 0 }; e.n++; if (l.statut === 'attente') e.attente.push(l); else e[l.statut]++; lotsMap.set(k, e); }
  const lots = [...lotsMap.values()].sort((a, b) => (a.tag < b.tag ? 1 : -1));
  if (!done.length && !lots.length) return null;
  const det = h('details', { class: 'details imp-hist', open: U.hist }, h('summary', null, icon('right', 14), `Historique (${done.length}) et fichiers importés (${lots.length})`),
    lots.length ? h('div', { class: 'imp-lots' }, lots.map((e) => {
      const m = /^lot:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2}):(.*)$/.exec(e.tag);
      return h('div', { class: 'imp-lot' }, h('div', null, h('b', null, m ? m[6] : 'Sans fichier'), h('span', { class: 'sub' }, `${m ? `importé le ${m[3]}/${m[2]}/${m[1]} à ${m[4]}h${m[5]}` : ''} · ${e.n} ligne${e.n > 1 ? 's' : ''} : ${e.attente.length} en attente, ${e.valide} validée${e.valide > 1 ? 's' : ''}, ${e.ignore} ignorée${e.ignore > 1 ? 's' : ''}`)),
        e.attente.length ? h('button', { class: 'btn sm ghost danger', onClick: () => deleteLot(e.tag, e.attente) }, icon('trash', 14), 'Supprimer les lignes en attente') : null);
    })) : null,
    done.length ? h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Libellé'), h('th', null, 'Statut'), h('th', { class: 'r' }, 'Montant'), h('th', null))),
      h('tbody', null, done.slice(0, 100).map((l) => {
        const tx = l.statut === 'valide' ? S.data.tx.find((t) => t.ref === l.txRef) : null;
        return h('tr', null, h('td', { class: 'muted', 'data-sort': l.date.replace(/-/g, '') }, fmtDate(l.date)), h('td', null, l.libelle, h('span', { class: 'sub' }, l.statut === 'valide' ? [l.activite, l.categorie].filter(Boolean).join(' · ') : (l.note || 'Ignorée'))),
          h('td', null, l.statut === 'valide' ? pill('good', 'Validée', 'check') : pill('mute', 'Ignorée')),
          h('td', { class: 'r num ' + (l.montant > 0 ? 'pos' : '') }, `${l.montant > 0 ? '+' : '−'}${num2(Math.abs(l.montant))} ${curSym(l.devise)}`),
          h('td', { class: 'r', style: { whiteSpace: 'nowrap' } }, l.statut === 'valide' ? [tx ? h('button', { class: 'btn sm', onClick: () => openTxForm(tx) }, 'Voir l’opération') : null, ' ', h('button', { class: 'btn sm ghost', title: 'Annuler la validation', onClick: () => unvalidate(l) }, icon('undo', 14))] : h('button', { class: 'btn sm', onClick: () => backToPending([l]) }, 'Remettre en attente')));
      }))) : null,
    done.length > 100 ? h('div', { class: 'muted imp-more' }, `Les 100 plus récentes sur ${done.length}.`) : null);
  det.addEventListener('toggle', () => { U.hist = det.open; });
  return h('div', { class: 'card' }, h('header', null, h('h2', null, 'Historique')), det);
}

export function render() { return [importCard(), listCard(), historyCard()]; }

export function onArgs() { const el = document.querySelector('.imp-drop'); if (el) el.scrollIntoView({ block: 'center' }); }
