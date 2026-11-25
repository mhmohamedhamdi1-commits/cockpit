import { h, icon, eur, clear, pct } from '../util.js';
import { S, ops, upsert, del, setParam, action, post, savePrefs } from '../state.js';
import { modal, field, select, confirmBox, segmented, toast } from '../ui.js';
import { applyTheme } from '../main.js';

export function meta() { return { title: 'Paramètres', sub: 'Taux, seuils, catégories et fichier', period: false, immoToggle: false }; }

function paramInput(label, key, { pctMode = false, step = 'any', hint, type = 'number' } = {}) {
  const raw = S.data.params.find((p) => p.cle === key);
  let v = raw ? raw.valeur : '';
  if (pctMode && v !== '') v = String(Math.round(parseFloat(String(v).replace(',', '.')) * 10000) / 100);
  const el = h('input', { type, step, value: v });
  el.addEventListener('change', async () => {
    let val = el.value;
    if (pctMode) val = String(parseFloat(String(val).replace(',', '.')) / 100);
    await ops([setParam(key, val)], 'Paramètre enregistré');
  });
  return field(label, el, hint);
}

function openCategory(c = {}) {
  const editing = !!c.categorie;
  const act = select(['Perso', 'Freelance', 'Immobilier'], c.activite || 'Perso', editing ? { disabled: true } : {});
  const sens = select(['Dépense', 'Revenu'], c.sens || 'Dépense', editing ? { disabled: true } : {});
  const nom = h('input', { type: 'text', value: c.categorie || '', disabled: editing });
  const grp = h('input', { type: 'text', value: c.groupe || '', list: 'grp-list', placeholder: 'ex. Logement, Charges…' });
  const dl = h('datalist', { id: 'grp-list' }, [...new Set(S.data.categories.map((x) => x.groupe))].map((g) => h('option', { value: g })));
  const nat = select([{ value: 'Courant', label: 'Courant — compte dans le résultat' }, { value: 'Investissement', label: 'Investissement — hors résultat' }, { value: 'Financement', label: 'Financement — hors résultat' }], c.nature || 'Courant');
  const ic = h('input', { type: 'text', value: c.icone || '', maxlength: 4, placeholder: '🛒', style: { maxWidth: '90px' } });
  const used = editing ? S.data.tx.filter((t) => t.activite === c.activite && t.sens === c.sens && t.categorie === c.categorie).length : 0;
  const m = modal({ title: editing ? `Catégorie « ${c.categorie} »` : 'Nouvelle catégorie', width: 560,
    body: [h('div', { class: 'grid2' }, field('Activité', act), field('Sens', sens)), field('Nom', nom, editing ? 'Le nom ne peut pas être changé (il est lié aux opérations existantes).' : null), dl,
      h('div', { class: 'grid2' }, field('Groupe', grp), field('Icône (emoji)', ic)), field('Nature par défaut', nat)],
    footer: [editing ? h('button', { class: 'btn danger', onClick: async () => { if (await confirmBox(used ? `${used} opération(s) utilisent cette catégorie : elles restent mais n’auront plus de bouton dédié.` : 'Supprimer cette catégorie ?', { ok: 'Supprimer', danger: true })) { if (await ops([{ e: 'category', op: 'delete', item: c }], 'Catégorie supprimée')) m.close(); } } }, icon('trash', 15), 'Supprimer') : null,
      h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'),
      h('button', { class: 'btn primary lg', onClick: async () => { if (!nom.value.trim()) return toast('Nom obligatoire', 'error'); if (await ops([{ e: 'category', op: 'upsert', item: { activite: act.value, sens: sens.value, categorie: nom.value.trim(), groupe: grp.value.trim() || 'Autres', nature: nat.value, icone: ic.value.trim() || '•' } }], 'Catégorie enregistrée')) m.close(); } }, 'Enregistrer')] });
}

function openLot(l = {}) {
  const editing = !!l.id;
  const code = h('input', { type: 'text', value: l.code || '', placeholder: '11' }), nom = h('input', { type: 'text', value: l.nom || '', placeholder: '11. 1er étage (Côté rue)' });
  const loyer = h('input', { type: 'number', value: l.loyer || '', step: 50 });
  const m = modal({ title: editing ? 'Modifier le lot' : 'Nouveau lot', width: 500, body: [field('Code', code), field('Nom du lot', nom, 'Le nom doit être identique à celui utilisé dans les locataires et les opérations.'), field('Loyer de référence (MAD)', loyer)],
    footer: [editing ? h('button', { class: 'btn danger', onClick: async () => { if (await confirmBox('Supprimer ce lot ?', { ok: 'Supprimer', danger: true })) { if (await ops([del('lot', l.id)], 'Lot supprimé')) m.close(); } } }, icon('trash', 15), 'Supprimer') : null,
      h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'),
      h('button', { class: 'btn primary lg', onClick: async () => { if (!nom.value.trim()) return toast('Nom obligatoire', 'error'); if (await ops([upsert('lot', { id: l.id || 0, code: code.value.trim(), nom: nom.value.trim(), loyer: +loyer.value || 0 })], 'Lot enregistré')) m.close(); } }, 'Enregistrer')] });
}

export function render() {
  const general = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Général')),
    h('div', { class: 'grid3' }, paramInput('Prénom', 'nom', { type: 'text' }), paramInput('Taux de change : 1 MAD = … €', 'taux_mad_eur', { step: 0.0001, hint: 'Sert aux nouvelles opérations en MAD' }), paramInput('Ma part du projet immobilier (%)', 'part_immo', { pctMode: true, step: 1, hint: 'Pondère l’immobilier dans le tableau de bord' })),
    h('div', { class: 'row-actions', style: { marginTop: '14px' } }, h('button', { class: 'btn', onClick: async () => { if (await confirmBox(`Recalculer en euros toutes les opérations et soldes en MAD avec le taux actuel (1 MAD = ${S.P.taux.toFixed(4).replace('.', ',')} €) ?`, { ok: 'Recalculer' })) await ops([action('recompute_rates')], 'Historique MAD recalculé'); } }, icon('repeat', 16), 'Appliquer ce taux à tout l’historique MAD'),
      h('span', { class: 'note', style: { alignSelf: 'center' } }, 'Par défaut chaque opération garde le taux du jour où elle a été saisie.')));
  const fisc = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Freelance — seuils et taux'), h('span', { class: 'sub' }, 'à vérifier chaque année')),
    h('div', { class: 'grid3' }, paramInput('Début de la micro-entreprise', 'micro_debut', { type: 'date', hint: 'Les CA avant cette date ne comptent pas ; le 1er exercice est proratisé' }), paramInput('Plafond micro-BNC (€ HT)', 'seuil_micro', { step: 100 }), paramInput('Franchise TVA (€ HT)', 'seuil_tva', { step: 100 }), paramInput('Seuil majoré TVA (€ HT)', 'seuil_tva_maj', { step: 100 }),
      paramInput('Cotisations sociales (%)', 'taux_cotis', { pctMode: true, step: 0.1 }), paramInput('Formation professionnelle (%)', 'taux_cfp', { pctMode: true, step: 0.05 }), paramInput('Provision conseillée (%)', 'taux_provision', { pctMode: true, step: 1, hint: 'Cotisations + impôt : estimation à valider avec un expert-comptable' })));

  // catégories
  const groups = [];
  for (const act of ['Perso', 'Freelance', 'Immobilier']) for (const sens of ['Dépense', 'Revenu']) {
    const cs = S.data.categories.filter((c) => c.activite === act && c.sens === sens);
    if (cs.length) groups.push([act, sens, cs]);
  }
  const catCard = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Catégories'), h('span', { class: 'sub' }, 'les boutons de la saisie rapide'), h('div', { class: 'right' }, h('button', { class: 'btn sm', onClick: () => openCategory() }, icon('plus', 15), 'Catégorie'))),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, groups.map(([act, sens, cs]) => h('div', null, h('div', { class: 'grp' }, h('i', { class: 'adot ' + act }), `${act} · ${sens === 'Dépense' ? 'Dépenses' : 'Revenus'}`),
      h('div', { class: 'catgrid' }, cs.map((c) => h('button', { class: 'cat', title: `${c.groupe} · ${c.nature}`, onClick: () => openCategory(c) }, h('span', { class: 'em' }, c.icone), c.categorie, c.nature !== 'Courant' ? h('span', { class: 'pill mute' }, c.nature) : null)))))));
  const lotCard = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Lots immobiliers'), h('div', { class: 'right' }, h('button', { class: 'btn sm', onClick: () => openLot() }, icon('plus', 15), 'Lot'))),
    h('table', { class: 'tbl' }, h('tbody', null, S.lots.map((l) => h('tr', { class: 'click', onClick: () => openLot(l) }, h('td', null, l.code), h('td', null, l.nom), h('td', { class: 'r num muted' }, l.loyer ? `${l.loyer} MAD` : ''))))));
  const fileCard = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Fichier de données et sauvegardes')),
    h('div', { class: 'sec', style: { marginBottom: '12px' } }, 'Toutes tes données sont dans ce classeur Excel, à côté de l’application. Chaque modification y est enregistrée immédiatement. Une sauvegarde automatique est créée chaque jour dans le dossier « Sauvegardes ».'),
    h('div', { class: 'infobox', style: { marginBottom: '12px', wordBreak: 'break-all' } }, `${S.dir}\\${S.file}`),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn', onClick: () => post('/api/open-excel').catch((e) => toast(e.message, 'error')) }, icon('sheet', 16), 'Ouvrir dans Excel'),
      h('button', { class: 'btn', onClick: () => post('/api/open-folder').catch((e) => toast(e.message, 'error')) }, icon('folder', 16), 'Ouvrir le dossier'),
      h('button', { class: 'btn', onClick: async () => { try { const r = await post('/api/backup'); toast(`Sauvegarde créée : ${r.file}`); } catch (e) { toast(e.message, 'error'); } } }, icon('save', 16), 'Sauvegarder maintenant')),
    h('div', { class: 'note', style: { marginTop: '10px' } }, 'Astuce : ferme le fichier dans Excel avant d’enregistrer depuis l’application, sinon Windows bloque l’écriture.'));
  const theme = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Apparence')),
    segmented([{ value: 'auto', label: 'Automatique' }, { value: 'light', label: 'Clair' }, { value: 'dark', label: 'Sombre' }], S.theme, (v) => { S.theme = v; savePrefs(); applyTheme(); }));
  return [general, fisc, h('div', { class: 'row2e' }, catCard, h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } }, lotCard, fileCard, theme))];
}
