import { h, clear, icon, eur, parseAmount, norm, addDays, fmtDate } from './util.js';
import { S, ops, upsert, del, catsFor, savePrefs } from './state.js';
import { modal, segmented, field, select, confirmBox, toast } from './ui.js';
import { activeTenants } from './calc.js';

const ACTS = [
  { value: 'Perso', label: 'Perso', dot: 'bg-Perso' },
  { value: 'Freelance', label: 'Freelance', dot: 'bg-Freelance' },
  { value: 'Immobilier', label: 'Immobilier', dot: 'bg-Immobilier' },
];

function history(act, sens) {
  const m = new Map();
  for (const t of S.data.tx) {
    if (t.activite !== act || t.sens !== sens || !t.libelle) continue;
    const k = norm(t.libelle);
    const e = m.get(k) || { libelle: t.libelle, n: 0, last: '', t };
    e.n++;
    if (t.date >= e.last) { e.last = t.date; e.t = t; e.libelle = t.libelle; }
    m.set(k, e);
  }
  return [...m.values()];
}
function frequentCats(act, sens) {
  const since = addDays(S.today, -150), c = new Map();
  for (const t of S.data.tx) if (t.activite === act && t.sens === sens && t.date >= since) c.set(t.categorie, (c.get(t.categorie) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map((x) => x[0]);
}

export function openTxForm(initial = {}, { onSaved } = {}) {
  const editing = !!initial.id;
  const f = {
    id: initial.id || 0,
    sens: initial.sens || 'Dépense',
    activite: initial.activite || (S.activity !== 'Tout' ? S.activity : S.lastActivity || 'Perso'),
    montant: initial.montant || '',
    devise: initial.devise || '',
    categorie: initial.categorie || '',
    libelle: initial.libelle || '',
    date: initial.date || S.today,
    tiers: initial.tiers || '', lot: initial.lot || '', detail: initial.detail || '',
    nature: initial.nature || '', note: initial.note || '', periode: initial.periode || '', ref: initial.ref || '',
    taux: initial.taux || 0,
  };
  let natureTouched = !!initial.nature;
  let deviseTouched = !!initial.devise;
  const defDevise = () => (f.activite === 'Immobilier' ? 'MAD' : 'EUR');
  if (!f.devise) f.devise = defDevise();
  const origCat = f.categorie;
  let err;

  // --- éléments
  const sensSeg = segmented([{ value: 'Dépense', label: 'Dépense' }, { value: 'Revenu', label: 'Revenu' }], f.sens, (v) => { f.sens = v; if (!editing || f.categorie !== origCat) f.categorie = ''; showAll = false; renderCats(); renderExtras(); }, 'lg block');
  const amountIn = h('input', { class: 'amount num', type: 'text', inputmode: 'decimal', placeholder: '0', value: f.montant ? String(f.montant).replace('.', ',') : '', autofocus: true, 'aria-label': 'Montant' });
  const devSeg = segmented([{ value: 'EUR', label: '€' }, { value: 'MAD', label: 'MAD' }], f.devise, (v) => { f.devise = v; deviseTouched = true; f.taux = 0; conv(); }, 'lg');
  const convEl = h('div', { class: 'muted num', style: { fontSize: '12.5px', minHeight: '18px', marginTop: '-8px' } });
  const conv = () => { const v = parseAmount(amountIn.value); convEl.textContent = f.devise === 'MAD' && v ? `≈ ${eur(v * (f.taux || S.P.taux), 2)} (1 MAD = ${(f.taux || S.P.taux).toFixed(4).replace('.', ',')} €)` : ''; };
  amountIn.addEventListener('input', conv);
  const actSeg = segmented(ACTS, f.activite, (v) => { f.activite = v; if (!deviseTouched) { f.devise = defDevise(); devSeg.set(f.devise); } if (!editing) f.categorie = ''; f.tiers = ''; f.lot = ''; renderCats(); renderExtras(); conv(); }, 'block');
  const catsBox = h('div'); const extras = h('div', { class: 'grid2' });
  const libIn = h('input', { type: 'text', placeholder: 'ex. Lidl, Loyer novembre, Facture mission…', value: f.libelle, autocomplete: 'off', 'aria-label': 'Libellé' });
  const sugBox = h('div', { class: 'suggest', style: { display: 'none' } });
  const dateIn = h('input', { type: 'date', value: f.date });
  const noteIn = h('textarea', { placeholder: 'Précision, n° de facture…' }, f.note);
  const natSel = select([{ value: '', label: 'Automatique (selon la catégorie)' }, { value: 'Courant', label: 'Courant — compte dans le résultat' }, { value: 'Investissement', label: 'Investissement — hors résultat' }, { value: 'Financement', label: 'Financement — apports, prêts, cautions' }], f.nature, { onChange: () => { natureTouched = true; } });
  natSel.addEventListener('change', () => { natureTouched = true; f.nature = natSel.value; });
  const errEl = h('div', { class: 'err' });

  let showAll = false;
  function renderCats() {
    clear(catsBox);
    const cats = catsFor(f.activite, f.sens);
    const freq = frequentCats(f.activite, f.sens).filter((c) => cats.some((x) => x.categorie === c));
    const mk = (c) => h('button', { type: 'button', class: 'cat' + (f.categorie === c.categorie ? ' on' : ''), onClick: () => { f.categorie = c.categorie; renderCats(); renderExtras(); amountIn.focus(); } }, h('span', { class: 'em' }, c.icone), c.categorie);
    if (!cats.length) { catsBox.append(h('div', { class: 'muted' }, 'Aucune catégorie : ajoute-en dans Paramètres.')); return; }
    catsBox.append(h('div', { class: 'lbl', style: { marginBottom: '8px' } }, 'Catégorie'));
    const useFreq = freq.length >= 3 && !editing;
    const selOutside = f.categorie && !freq.includes(f.categorie);
    if (useFreq) {
      const chosen = selOutside ? cats.find((c) => c.categorie === f.categorie) : null;
      catsBox.append(h('div', { class: 'catgrid' }, chosen ? mk(chosen) : null, freq.filter((n) => n !== f.categorie).map((n) => mk(cats.find((c) => c.categorie === n))),
        h('button', { type: 'button', class: 'cat', style: { borderStyle: 'dashed' }, onClick: () => { showAll = !showAll; renderCats(); } }, showAll ? 'Moins' : `Toutes (${cats.length})`, icon(showAll ? 'up' : 'down', 13))));
    }
    if (!useFreq || showAll) {
      const groups = [...new Set(cats.map((c) => c.groupe))];
      const wrap = h('div', { style: useFreq ? { maxHeight: '230px', overflow: 'auto', marginTop: '10px', paddingRight: '4px' } : null });
      for (const g of groups) {
        if (groups.length > 1) wrap.append(h('div', { class: 'grp' }, g));
        wrap.append(h('div', { class: 'catgrid' }, cats.filter((c) => c.groupe === g).map(mk)));
      }
      catsBox.append(wrap);
    }
  }
  function renderExtras() {
    clear(extras);
    if (f.activite === 'Immobilier') {
      const lots = [{ value: '', label: '— Aucun —' }, ...S.lots.map((l) => ({ value: l.nom, label: l.nom }))];
      const lotSel = select(lots, f.lot);
      const tenSel = h('select');
      const fillTen = () => {
        const list = [...new Set([...activeTenants(f.date).filter((t) => t.lot === lotSel.value).map((t) => t.nom)])];
        clear(tenSel); tenSel.append(h('option', { value: '' }, '— Aucun —'), ...list.map((n) => h('option', { value: n }, n)));
        if (f.tiers && !list.includes(f.tiers)) tenSel.append(h('option', { value: f.tiers }, f.tiers));
        tenSel.value = f.tiers || (list.length === 1 && f.categorie === 'Loyer' ? list[0] : '');
        f.tiers = tenSel.value;
      };
      lotSel.addEventListener('change', () => { f.lot = lotSel.value; fillTen(); });
      tenSel.addEventListener('change', () => { f.tiers = tenSel.value; });
      fillTen();
      const det = h('input', { type: 'text', value: f.detail, placeholder: f.categorie === 'Travaux' ? 'ex. Maçonnerie, Plomberie…' : 'Précision (facultatif)' });
      det.addEventListener('input', () => { f.detail = det.value; });
      extras.append(field('Lot concerné', lotSel), field('Locataire', tenSel), h('div', { style: { gridColumn: '1 / -1' } }, field('Détail', det)));
    } else if (f.activite === 'Freelance') {
      const cl = [{ value: '', label: '— Aucun —' }, ...S.data.clients.map((c) => ({ value: c.nom, label: c.nom }))];
      const sel = select(cl, f.tiers);
      sel.addEventListener('change', () => { f.tiers = sel.value; });
      extras.append(field(f.sens === 'Revenu' ? 'Client' : 'Fournisseur / client lié', sel));
    } else {
      const t = h('input', { type: 'text', value: f.tiers, placeholder: 'Facultatif (employeur, enseigne…)' });
      t.addEventListener('input', () => { f.tiers = t.value; });
      extras.append(field('Tiers', t));
    }
  }

  // --- suggestions de libellé
  let sel = -1, sugs = [];
  const closeSug = () => { sugBox.style.display = 'none'; sel = -1; };
  const pick = (e) => {
    libIn.value = e.libelle; f.libelle = e.libelle; closeSug();
    f.categorie = e.t.categorie; if (e.t.devise && !deviseTouched) { f.devise = e.t.devise; devSeg.set(f.devise); }
    if (!parseAmount(amountIn.value)) { amountIn.value = String(e.t.montant).replace('.', ','); conv(); }
    if (e.t.lot) f.lot = e.t.lot; if (e.t.tiers) f.tiers = e.t.tiers; if (e.t.detail) f.detail = e.t.detail;
    renderCats(); renderExtras();
  };
  libIn.addEventListener('input', () => {
    f.libelle = libIn.value; const q = norm(libIn.value.trim());
    if (q.length < 2) return closeSug();
    sugs = history(f.activite, f.sens).filter((e) => norm(e.libelle).includes(q) && norm(e.libelle) !== q).sort((a, b) => b.n - a.n || (b.last > a.last ? 1 : -1)).slice(0, 6);
    if (!sugs.length) return closeSug();
    clear(sugBox);
    sugs.forEach((e, i) => sugBox.append(h('div', { class: i === sel ? 'on' : '', onMousedown: (ev) => { ev.preventDefault(); pick(e); } },
      h('span', null, e.libelle, h('small', null, `  ${e.t.categorie}`)), h('small', { class: 'num' }, `${String(e.t.montant).replace('.', ',')} ${e.t.devise === 'MAD' ? 'MAD' : '€'}`))));
    sugBox.style.display = 'block'; sel = -1;
  });
  libIn.addEventListener('keydown', (ev) => {
    if (sugBox.style.display === 'none') return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault(); sel = (sel + (ev.key === 'ArrowDown' ? 1 : -1) + sugs.length) % sugs.length;
      [...sugBox.children].forEach((c, i) => c.classList.toggle('on', i === sel));
    } else if (ev.key === 'Enter' && sel >= 0) { ev.preventDefault(); ev.stopPropagation(); pick(sugs[sel]); }
    else if (ev.key === 'Escape') { ev.stopPropagation(); closeSug(); }
  });
  libIn.addEventListener('blur', () => setTimeout(closeSug, 120));

  // --- sauvegarde
  async function save(another) {
    const v = parseAmount(amountIn.value);
    errEl.textContent = '';
    if (!(v > 0)) { errEl.textContent = 'Saisis un montant supérieur à 0.'; amountIn.focus(); return; }
    if (!f.categorie) { errEl.textContent = 'Choisis une catégorie.'; return; }
    if (!dateIn.value) { errEl.textContent = 'Choisis une date.'; return; }
    f.montant = v; f.date = dateIn.value; f.note = noteIn.value.trim(); f.libelle = libIn.value.trim();
    const item = {
      id: f.id, date: f.date, activite: f.activite, sens: f.sens, categorie: f.categorie, detail: f.detail, libelle: f.libelle || f.categorie,
      montant: v, devise: f.devise, taux: f.taux || 0, nature: natureTouched ? natSel.value : (editing && f.categorie === origCat ? f.nature : ''),
      tiers: f.tiers, lot: f.lot, periode: editing && f.date.slice(0, 7) === (initial.date || '').slice(0, 7) ? f.periode : '', ref: f.ref, note: f.note,
    };
    if (initial.periode && !editing) item.periode = initial.periode;
    S.lastActivity = f.activite; savePrefs();
    if (await ops([upsert('tx', item)], editing ? 'Opération modifiée' : `${f.sens === 'Dépense' ? 'Dépense' : 'Revenu'} de ${eur(v, v % 1 ? 2 : 0).replace('€', f.devise === 'MAD' ? 'MAD' : '€')} enregistré`)) {
      onSaved && onSaved();
      if (another) {
        amountIn.value = ''; libIn.value = ''; f.libelle = ''; f.detail = ''; conv(); renderExtras(); amountIn.focus();
      } else m.close();
    }
  }
  amountIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(false); } });
  const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(false); } };

  const dateRow = h('div', { class: 'split' }, h('div', { style: { flex: 1 } }, dateIn),
    h('button', { type: 'button', class: 'btn sm', onClick: () => { dateIn.value = S.today; } }, 'Aujourd’hui'),
    h('button', { type: 'button', class: 'btn sm', onClick: () => { dateIn.value = addDays(S.today, -1); } }, 'Hier'));

  const body = [
    sensSeg,
    h('div', null, h('div', { class: 'amount-row' }, amountIn, devSeg), h('div', { style: { height: '8px' } }), convEl),
    h('div', null, h('div', { class: 'lbl', style: { marginBottom: '6px' } }, 'Activité'), actSeg),
    catsBox,
    h('div', { class: 'grid2' }, h('div', { class: 'field rel' }, h('label', null, 'Libellé'), libIn, sugBox), field('Date', dateRow)),
    extras,
    h('details', { class: 'details' }, h('summary', null, icon('right', 14), 'Plus d’options'), h('div', { class: 'grid2' }, field('Nature comptable', natSel, 'Courant = compte dans le résultat ; Investissement / Financement = hors résultat.'), field('Note', noteIn))),
    errEl,
  ];
  const footer = [];
  if (editing) footer.push(h('button', { class: 'btn danger', type: 'button', onClick: async () => { if (await confirmBox('Supprimer définitivement cette opération ?', { ok: 'Supprimer', danger: true })) { if (await ops([del('tx', f.id)], 'Opération supprimée')) { onSaved && onSaved(); m.close(); } } } }, icon('trash', 16), 'Supprimer'));
  footer.push(h('span', { class: 'sp' }));
  if (!editing) footer.push(h('button', { class: 'btn', type: 'button', onClick: () => save(true) }, 'Enregistrer et en ajouter une autre'));
  footer.push(h('button', { class: 'btn primary lg', type: 'button', onClick: () => save(false) }, 'Enregistrer', h('kbd', null, 'Ctrl ↵')));

  const m = modal({ title: editing ? 'Modifier l’opération' : 'Nouvelle opération', width: 700, body, footer, onClose: () => document.removeEventListener('keydown', onKey) });
  document.addEventListener('keydown', onKey);
  renderCats(); renderExtras(); conv();
  return m;
}
