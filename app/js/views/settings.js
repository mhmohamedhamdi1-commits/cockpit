import { h, icon, eur, clear, pct } from '../util.js';
import { S, ops, upsert, del, setParam, action, savePrefs, flush, emit } from '../state.js';
import { modal, field, select, confirmBox, segmented, toast, empty } from '../ui.js';
import { applyTheme } from '../main.js';
import { sb, isIOS, isStandalone } from '../supa.js';
import { listFactors, addFactor, verifyFactor, removeFactor, changePassword } from '../auth.js';
import { exportExcel, importExcel, listRestorePoints, createRestorePoint, backToPoint, openHistory, backupsEnabled, listBackups, downloadBackup, restoreBackup } from '../data.js';
import { pushStatus, enablePush, disablePush, listDevices, removeDevice, testPush } from '../push.js';
import { CONFIG } from '../../config.js';

export function meta() { return { title: 'Paramètres', sub: 'Compte, notifications, données, taux et catégories', period: false, immoToggle: false }; }

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
  const theme = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Apparence')),
    segmented([{ value: 'auto', label: 'Automatique' }, { value: 'light', label: 'Clair' }, { value: 'dark', label: 'Sombre' }], S.theme, (v) => { S.theme = v; savePrefs(); applyTheme(); }));
  return [h('div', { class: 'row2e' }, accountCard(), notifCard()), dataCard(), installCard(), general, fisc, h('div', { class: 'row2e' }, catCard, h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } }, lotCard, theme))];
}

// ---------- Compte et sécurité ----------
function accountCard() {
  const box = h('div', { class: 'stack' }, h('div', { class: 'muted' }, 'Chargement…'));
  const card = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Compte et sécurité')), box);
  (async () => {
    let factors = [];
    try { factors = await listFactors(); } catch { /* hors ligne */ }
    clear(box);
    box.append(
      h('div', { class: 'kv' }, h('span', null, 'Compte'), h('b', null, S.user ? S.user.email : '')),
      h('div', { class: 'kv' }, h('span', null, 'Codes de sécurité (MFA)'), h('b', null, `${factors.length} appareil${factors.length > 1 ? 's' : ''}`)),
      factors.length < 2 ? h('div', { class: 'infobox' }, 'Ajoute un 2ᵉ code de sécurité (autre téléphone, gestionnaire de mots de passe) : sans lui, perdre ton téléphone bloquerait l’accès.') : null,
      h('table', { class: 'tbl' }, h('tbody', null, factors.map((f) => h('tr', null, h('td', null, f.friendly_name || 'Application', h('span', { class: 'sub' }, 'ajouté le ' + new Date(f.created_at).toLocaleDateString('fr-FR'))),
        h('td', { class: 'r' }, factors.length > 1 ? h('button', { class: 'btn sm ghost danger', onClick: async () => { if (await confirmBox(`Retirer « ${f.friendly_name} » ?`, { ok: 'Retirer', danger: true })) { try { await removeFactor(f.id); toast('Retiré'); emit(); } catch (e) { toast(e.message, 'error'); } } } }, icon('trash', 14)) : null))))),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn', onClick: openAddFactor }, icon('key', 16), 'Ajouter un code de secours'),
        h('button', { class: 'btn', onClick: openPassword }, icon('edit', 16), 'Changer le mot de passe'),
        h('button', { class: 'btn danger', onClick: async () => { if (await confirmBox('Se déconnecter de cet appareil ? La copie locale des données y sera effacée.', { ok: 'Se déconnecter', danger: true })) { await flush().catch(() => {}); await sb.auth.signOut(); } } }, 'Se déconnecter')));
  })();
  return card;
}
async function openAddFactor() {
  let f;
  try { f = await addFactor(); } catch (e) { toast(e.message, 'error'); return; }
  const code = h('input', { type: 'text', inputmode: 'numeric', maxlength: 6, class: 'otp', placeholder: '123456' });
  const err = h('div', { class: 'err' });
  const m = modal({ title: 'Ajouter un code de secours', width: 440, onClose: () => { if (!m.done) sb.auth.mfa.unenroll({ factorId: f.id }).catch(() => {}); }, body: [
    h('p', { class: 'sec' }, 'Scanne ce QR code avec un autre appareil ou un gestionnaire de mots de passe, puis saisis le code affiché.'),
    isIOS() ? h('a', { class: 'btn', href: f.totp.uri }, icon('key', 16), 'Ajouter à l’app d’authentification') : null,
    h('div', { class: 'qr' }, h('img', { src: f.totp.qr_code, width: 170, height: 170, alt: 'QR code' })),
    h('div', { class: 'hint', style: { textAlign: 'center' } }, 'Clé : ', h('code', { class: 'secret' }, f.totp.secret.replace(/(.{4})/g, '$1 ').trim())),
    field('Code à 6 chiffres', code), err],
  footer: [h('span', { class: 'sp' }), h('button', { class: 'btn primary', onClick: async () => { try { await verifyFactor(f.id, code.value.trim()); m.done = true; m.close(); toast('Code de secours ajouté'); emit(); } catch (e) { err.textContent = e.message; } } }, 'Activer')] });
}
function openPassword() {
  const p1 = h('input', { type: 'password', autocomplete: 'new-password' }), p2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const err = h('div', { class: 'err' });
  const m = modal({ title: 'Changer le mot de passe', width: 420, body: [field('Nouveau mot de passe (12 caractères min.)', p1), field('Confirmation', p2), err],
    footer: [h('span', { class: 'sp' }), h('button', { class: 'btn primary', onClick: async () => { if (p1.value !== p2.value) { err.textContent = 'Les deux saisies diffèrent.'; return; } try { await changePassword(p1.value); m.close(); toast('Mot de passe modifié'); } catch (e) { err.textContent = e.message; } } }, 'Enregistrer')] });
}

// ---------- Notifications ----------
const NOTIFS = [
  ['factures', 'Factures en retard / à envoyer'], ['jours', 'Jours travaillés en fin de mois (17 h)'], ['loyers', 'Loyers en retard / à encaisser'],
  ['saisie', 'Rappel de saisie (20 h)'], ['recurrents', 'Opérations récurrentes à générer'], ['releve', 'Relevé de soldes de fin de mois'],
  ['echeances', 'Échéances (URSSAF, impôts, CFE…)'], ['provision', 'Montant à mettre de côté après une facture payée'],
];
function notifCard() {
  const P = Object.fromEntries(S.data.params.map((p) => [p.cle, p.valeur]));
  const devBox = h('div', { class: 'stack' }, h('div', { class: 'muted' }, 'Vérification…'));
  const card = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Notifications'), h('span', { class: 'sub' }, 'sur iPhone, Windows et navigateur')), devBox,
    h('div', { class: 'toggles' }, NOTIFS.map(([k, label]) => h('label', { class: 'tg' }, h('span', null, label),
      (() => { const t = h('button', { type: 'button', class: 'toggle' + ((P['notif_' + k] ?? 'Oui') !== 'Non' ? ' on' : ''), role: 'switch' });
        t.addEventListener('click', async () => { const on = !t.classList.contains('on'); t.classList.toggle('on', on); await ops([setParam('notif_' + k, on ? 'Oui' : 'Non')]); }); return t; })()))),
    h('div', { class: 'grid3', style: { marginTop: '12px' } }, paramInput('Heure du point du matin', 'notif_heure', { step: 1 }), paramInput('Loyer en retard à partir du', 'notif_loyer_jour', { step: 1, hint: 'jour du mois' }), paramInput('Rappel de saisie après', 'notif_saisie_jours', { step: 1, hint: 'jours sans saisie' })));
  (async () => {
    const st = await pushStatus().catch(() => ({ supported: false }));
    clear(devBox);
    if (st.needInstall) devBox.append(h('div', { class: 'infobox' }, 'Sur iPhone, les notifications ne fonctionnent que depuis l’app installée : Safari › bouton Partager › « Sur l’écran d’accueil », puis ouvre Cockpit depuis l’icône.'));
    else if (!st.supported) devBox.append(h('div', { class: 'note' }, 'Ce navigateur ne gère pas les notifications.'));
    else if (CONFIG.vapid.startsWith('__')) devBox.append(h('div', { class: 'note' }, 'Notifications pas encore configurées sur le serveur.'));
    else devBox.append(h('div', { class: 'row-actions' },
      st.subscribed ? h('span', { class: 'pill good' }, icon('check', 13), 'Activées sur cet appareil') : h('button', { class: 'btn primary', onClick: async () => { try { await enablePush(); toast('Notifications activées sur cet appareil'); emit(); } catch (e) { toast(e.message, 'error'); } } }, icon('alert', 16), 'Activer sur cet appareil'),
      st.subscribed ? h('button', { class: 'btn', onClick: async () => { try { const r = await testPush(); toast(r && r.sent ? `Notification de test envoyée (${r.sent} appareil${r.sent > 1 ? 's' : ''})` : 'Aucun appareil joignable'); } catch (e) { toast(e.message, 'error'); } } }, 'Tester') : null,
      st.subscribed ? h('button', { class: 'btn ghost', onClick: async () => { await disablePush(); toast('Désactivées sur cet appareil'); emit(); } }, 'Désactiver') : null));
    try {
      const devs = await listDevices();
      if (devs.length) devBox.append(h('div', { class: 'note' }, 'Appareils abonnés : ', devs.map((d, i) => h('span', null, i ? ' · ' : '', d.label || 'appareil', d.fail_count ? ' (injoignable)' : '', ' ', h('a', { href: '#', onClick: async (e) => { e.preventDefault(); await removeDevice(d.id); emit(); } }, '×')))));
    } catch { /* ignore */ }
  })();
  return card;
}

// ---------- Données et sauvegardes ----------
function dataCard() {
  const pts = h('div', null, h('div', { class: 'muted' }, 'Chargement…'));
  const ext = h('div');
  const card = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Données et sauvegardes')),
    h('div', { class: 'sec', style: { marginBottom: '12px' } }, 'Tes données sont dans la base centrale (Supabase, Europe). Chaque modification est enregistrée dans un historique, un instantané complet est pris chaque nuit, et une copie chiffrée est conservée hors de Supabase.'),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn primary', onClick: () => exportExcel() }, icon('sheet', 16), 'Exporter en Excel'),
      h('button', { class: 'btn', onClick: importExcel }, icon('folder', 16), 'Restaurer depuis un fichier Excel'),
      h('button', { class: 'btn', onClick: openHistory }, icon('undo', 16), 'Historique des modifications'),
      h('button', { class: 'btn', onClick: async () => { try { await createRestorePoint(); toast('Point de restauration créé'); drawPts(); } catch (e) { toast(e.message, 'error'); } } }, icon('save', 16), 'Créer un point de restauration')),
    h('div', { class: 'row2e', style: { marginTop: '16px' } }, h('div', null, h('div', { class: 'grp' }, 'Points de restauration (base)'), pts), h('div', null, h('div', { class: 'grp' }, 'Sauvegardes externes chiffrées'), ext)));
  const drawPts = async () => {
    try {
      const list = await listRestorePoints();
      clear(pts);
      pts.append(list.length ? h('table', { class: 'tbl' }, h('tbody', null, list.slice(0, 8).map((p) => h('tr', null, h('td', null, new Date(p.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }), h('span', { class: 'sub' }, `${p.label} · ${p.rows} lignes`)),
        h('td', { class: 'r' }, h('button', { class: 'btn sm', onClick: async () => { if (await backToPoint(p)) drawPts(); } }, 'Revenir ici')))))) : empty('Aucun point pour l’instant', 'Un instantané est pris automatiquement chaque nuit.'));
    } catch (e) { clear(pts); pts.append(h('div', { class: 'note' }, e.message)); }
  };
  drawPts();
  (async () => {
    if (!backupsEnabled()) { ext.append(h('div', { class: 'note' }, 'Non configurées.')); return; }
    try {
      const list = await listBackups();
      ext.append(list.length ? h('table', { class: 'tbl' }, h('tbody', null, list.slice(0, 8).map((b) => h('tr', null, h('td', null, b.key, h('span', { class: 'sub' }, `${Math.round(b.size / 1024)} Ko`)),
        h('td', { class: 'r', style: { whiteSpace: 'nowrap' } }, h('button', { class: 'btn sm', title: 'Télécharger en Excel', onClick: () => downloadBackup(b.key).catch((e) => toast(e.message, 'error')) }, icon('sheet', 14)), ' ',
          h('button', { class: 'btn sm', onClick: () => restoreBackup(b.key).catch((e) => toast(e.message, 'error')) }, 'Restaurer')))))) : empty('Aucune sauvegarde', 'La première sera faite cette nuit.'));
    } catch (e) { ext.append(h('div', { class: 'note' }, e.message)); }
  })();
  return card;
}

function installCard() {
  if (isStandalone()) return null;
  return h('div', { class: 'card' }, h('header', null, h('h2', null, 'Installer l’application')),
    isIOS() ? h('ol', { class: 'steps' }, h('li', null, 'Dans Safari, touche le bouton Partager (carré avec une flèche).'), h('li', null, 'Choisis « Sur l’écran d’accueil », puis « Ajouter ».'), h('li', null, 'Ouvre Cockpit depuis l’icône : plein écran, notifications possibles.'))
      : h('ol', { class: 'steps' }, h('li', null, 'Dans Edge : menu « … » › Applications › « Installer Cockpit » (ou l’icône ⊕ dans la barre d’adresse).'), h('li', null, 'Cockpit apparaît dans le menu Démarrer et peut être épinglé à la barre des tâches.')));
}
