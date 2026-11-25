import { h, icon, eur, money, monthLong, fmtDate, clear, sum, addMonths } from '../util.js';
import { S, ops, upsert, del, action, todayMonth, catsFor, emit } from '../state.js';
import { modal, field, select, confirmBox, empty, pill, toast, toggle } from '../ui.js';
import * as core from '../core.js';

export function meta() { return { title: 'Automatismes', sub: 'Opérations récurrentes, échéances et rappels', period: false, immoToggle: false }; }
const st = { month: null };

function openForm(r = {}) {
  const editing = !!r.id;
  const f = { activite: r.activite || 'Perso', sens: r.sens || 'Dépense', categorie: r.categorie || '' };
  const lib = h('input', { type: 'text', value: r.libelle || '', placeholder: 'ex. Loyer, Navigo, Abonnement…' });
  const act = select(['Perso', 'Freelance', 'Immobilier'], f.activite);
  const sens = select(['Dépense', 'Revenu'], f.sens);
  const cat = h('select');
  const fillCat = () => { clear(cat); catsFor(f.activite, f.sens).forEach((c) => cat.append(h('option', { value: c.categorie, selected: c.categorie === f.categorie }, `${c.icone} ${c.categorie}`))); f.categorie = cat.value; };
  act.addEventListener('change', () => { f.activite = act.value; f.categorie = ''; fillCat(); });
  sens.addEventListener('change', () => { f.sens = sens.value; f.categorie = ''; fillCat(); });
  cat.addEventListener('change', () => { f.categorie = cat.value; });
  fillCat();
  const mont = h('input', { type: 'number', step: 0.01, min: 0, value: r.montant || '' });
  const dev = select(['EUR', 'MAD'], r.devise || 'EUR');
  const jour = h('input', { type: 'number', min: 1, max: 31, value: r.jour || 1 });
  const deb = h('input', { type: 'date', value: r.debut || '' }), fin = h('input', { type: 'date', value: r.fin || '' });
  const tiers = h('input', { type: 'text', value: r.tiers || '' });
  const actif = select([{ value: 'Oui', label: 'Actif' }, { value: 'Non', label: 'En pause' }], r.actif || 'Oui');
  const err = h('div', { class: 'err' });
  const save = async () => {
    if (!lib.value.trim() || !(+mont.value > 0) || !f.categorie) { err.textContent = 'Libellé, catégorie et montant sont obligatoires.'; return; }
    const item = { id: r.id || 0, libelle: lib.value.trim(), activite: f.activite, sens: f.sens, categorie: f.categorie, montant: +mont.value, devise: dev.value, jour: +jour.value || 1, debut: deb.value, fin: fin.value, actif: actif.value, nature: r.nature || '', tiers: tiers.value.trim(), lot: r.lot || '' };
    if (await ops([upsert('recurring', item)], editing ? 'Automatisme modifié' : 'Automatisme créé')) m.close();
  };
  const m = modal({ title: editing ? 'Modifier l’automatisme' : 'Nouvel automatisme', width: 620,
    body: [field('Libellé', lib), h('div', { class: 'grid3' }, field('Activité', act), field('Sens', sens), field('Catégorie', cat)),
      h('div', { class: 'grid3' }, field('Montant', mont), field('Devise', dev), field('Jour du mois', jour)),
      h('div', { class: 'grid3' }, field('Début', deb, 'Vide = depuis toujours'), field('Fin', fin, 'Vide = sans fin'), field('Statut', actif)), field('Tiers', tiers), err],
    footer: [editing ? h('button', { class: 'btn danger', onClick: async () => { if (await confirmBox('Supprimer cet automatisme ? Les opérations déjà générées restent.', { ok: 'Supprimer', danger: true })) { if (await ops([del('recurring', r.id)], 'Automatisme supprimé')) m.close(); } } }, icon('trash', 15), 'Supprimer') : null,
      h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'), h('button', { class: 'btn primary lg', onClick: save }, 'Enregistrer')] });
}

export function render() {
  const have = new Set(S.data.tx.map((t) => t.ref).filter(Boolean));
  if (!st.month) {
    const cur = todayMonth(), nxt = addMonths(cur, 1);
    const pend = (m) => S.data.recurring.some((r) => r.actif !== 'Non' && (!r.debut || r.debut <= m + '-31') && (!r.fin || r.fin >= m + '-01') && !have.has(`REC${r.id}:${m}`));
    st.month = !pend(cur) && pend(nxt) ? nxt : cur;
  }
  const applies = (r) => r.actif !== 'Non' && (!r.debut || r.debut <= st.month + '-31') && (!r.fin || r.fin >= st.month + '-01');
  const todo = S.data.recurring.filter((r) => applies(r) && !have.has(`REC${r.id}:${st.month}`));
  const mi = h('input', { type: 'month', value: st.month, style: { width: '170px' } });
  mi.addEventListener('change', () => { st.month = mi.value || todayMonth(); emit(); });
  const gen = h('button', { class: 'btn primary lg', disabled: !todo.length, onClick: async () => { const n = S.data.tx.length; if (await ops([action('generate_recurring', { month: st.month })])) toast(`${S.data.tx.length - n} opération(s) ajoutée(s) pour ${monthLong(st.month)}`); } },
    icon('repeat', 17), todo.length ? `Générer ${todo.length} opération${todo.length > 1 ? 's' : ''}` : 'Tout est déjà généré');
  const head = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Générer le mois'), h('span', { class: 'sub' }, 'une seule fois : pas de doublon possible')),
    h('div', { class: 'split', style: { flexWrap: 'wrap' } }, mi, gen, h('span', { class: 'note' }, 'Les opérations sont créées à la date prévue, tu peux ensuite les corriger si le montant change.')));
  const rows = S.data.recurring;
  const list = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Mes automatismes'), h('span', { class: 'sub' }, `${rows.length}`), h('div', { class: 'right' }, h('button', { class: 'btn', onClick: () => openForm() }, icon('plus', 16), 'Nouvel automatisme'))),
    rows.length ? h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Libellé', 'Catégorie', 'Jour', 'Période', 'Montant', 'Ce mois-ci'].map((x, i) => h('th', { class: i === 4 ? 'r' : '' }, x)))),
      h('tbody', null, rows.map((r) => h('tr', { class: 'click' + (r.actif === 'Non' ? ' dim' : ''), onClick: () => openForm(r) },
        h('td', null, r.libelle, h('span', { class: 'sub' }, [r.activite, r.tiers].filter(Boolean).join(' · '))), h('td', null, h('span', { class: 'chip' }, (S.catMap[`${r.activite}|${r.sens}|${r.categorie}`] || {}).icone || '•', r.categorie)),
        h('td', null, `le ${r.jour}`), h('td', { class: 'muted' }, r.debut || r.fin ? `${r.debut ? 'dès ' + fmtDate(r.debut) : ''}${r.fin ? ' jusqu’au ' + fmtDate(r.fin) : ''}` : 'toujours'),
        h('td', { class: 'r num', style: { fontWeight: 650 } }, (r.sens === 'Revenu' ? '+' : '−') + money(r.montant, r.devise, 2)),
        h('td', null, r.actif === 'Non' ? pill('mute', 'En pause') : !applies(r) ? pill('mute', 'Hors période') : have.has(`REC${r.id}:${st.month}`) ? pill('good', 'Généré', 'check') : pill('warn', 'À générer')))))) : empty('Aucun automatisme', 'Ajoute ton loyer, ton abonnement mobile, ton Navigo… ils seront créés en un clic chaque mois.'));
  return [head, list, rappelsCard()];
}

// ---------- Échéances et rappels (notifiés sur tes appareils) ----------
const FREQS = ['Une fois', 'Mensuel', 'Trimestriel', 'Annuel'];
const CATS = ['Fiscal', 'Freelance', 'Immobilier', 'Perso'];
function openRappel(r = {}) {
  const editing = !!r.id;
  const titre = h('input', { type: 'text', value: r.titre || '', placeholder: 'ex. Déclaration URSSAF, CFE, taxe foncière…' });
  const cat = select(CATS, r.categorie || 'Fiscal');
  const freq = select(FREQS, r.frequence || 'Une fois');
  const date = h('input', { type: 'date', value: r.date || S.today });
  const avance = h('input', { type: 'number', min: 0, max: 60, value: r.avance ?? 7 });
  const actif = select([{ value: 'Oui', label: 'Actif' }, { value: 'Non', label: 'En pause' }], r.actif || 'Oui');
  const note = h('textarea', null, r.note || '');
  const err = h('div', { class: 'err' });
  const save = async () => {
    if (!titre.value.trim() || !date.value) { err.textContent = 'Titre et date obligatoires.'; return; }
    if (await ops([upsert('rappel', { ...r, id: r.id || 0, titre: titre.value.trim(), categorie: cat.value, frequence: freq.value, date: date.value, avance: +avance.value || 0, actif: actif.value, note: note.value.trim() })], editing ? 'Rappel modifié' : 'Rappel créé')) m.close();
  };
  const m = modal({ title: editing ? 'Modifier le rappel' : 'Nouveau rappel', width: 560,
    body: [field('Rappel', titre), h('div', { class: 'grid3' }, field('Catégorie', cat), field('Fréquence', freq), field('Statut', actif)),
      h('div', { class: 'grid2' }, field('Échéance (prochaine ou de référence)', date, 'Pour un rappel mensuel/trimestriel/annuel : une date de la série. Fin de mois = reste en fin de mois.'), field('Prévenir combien de jours avant ?', avance, 'Notification ce jour-là, puis le jour J')),
      field('Note', note), err],
    footer: [editing ? h('button', { class: 'btn danger', onClick: async () => { if (await confirmBox('Supprimer ce rappel ?', { ok: 'Supprimer', danger: true })) { if (await ops([del('rappel', r.id)], 'Rappel supprimé')) m.close(); } } }, icon('trash', 15), 'Supprimer') : null,
      h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'), h('button', { class: 'btn primary lg', onClick: save }, 'Enregistrer')] });
}
function rappelsCard() {
  const list = [...(S.data.rappels || [])].map((r) => ({ r, next: core.nextOccurrence(r, S.today) })).sort((a, b) => (a.next || '9999') < (b.next || '9999') ? -1 : 1);
  return h('div', { class: 'card' }, h('header', null, h('h2', null, 'Échéances et rappels'), h('span', { class: 'sub' }, 'URSSAF, impôts, CFE, taxes, fins de bail… notifiés sur tes appareils'),
    h('div', { class: 'right' }, h('button', { class: 'btn', onClick: () => openRappel() }, icon('plus', 16), 'Nouveau rappel'))),
    list.length ? h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Rappel', 'Fréquence', 'Prochaine échéance', ''].map((x) => h('th', null, x)))),
      h('tbody', null, list.map(({ r, next }) => { const d = next ? core.nextOccurrence(r, S.today) : null; const days = d ? Math.round((new Date(d) - new Date(S.today)) / 864e5) : null;
        return h('tr', { class: 'click' + (r.actif === 'Non' ? ' dim' : ''), onClick: () => openRappel(r) },
          h('td', null, r.titre, h('span', { class: 'sub' }, [r.categorie, r.avance ? `prévenu ${r.avance} j avant` : '', r.note].filter(Boolean).join(' · '))),
          h('td', null, r.frequence), h('td', null, d ? fmtDate(d) : h('span', { class: 'muted' }, 'passée')),
          h('td', null, r.actif === 'Non' ? pill('mute', 'En pause') : days == null ? pill('mute', 'Terminé') : days <= 7 ? pill('warn', days === 0 ? 'Aujourd’hui' : `Dans ${days} j`) : pill('info', `Dans ${days} j`))); })))
      : empty('Aucun rappel', 'Ajoute tes échéances : déclaration URSSAF, CFE, impôt sur le revenu, taxe foncière…'));
}
