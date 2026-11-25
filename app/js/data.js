// Données : export / restauration Excel, points de restauration, historique, sauvegardes externes.
import { h, icon, fmtDate, clear } from './util.js';
import { S, flush, pull, emit } from './state.js';
import { sb, isIOS } from './supa.js';
import { CONFIG } from '../config.js';
import { TABLES, BY_KEY, fromDb } from './schema.js';
import { buildWorkbook, parseWorkbook, exportFileName } from './xlsxio.js';
import { modal, toast, confirmBox } from './ui.js';

let xp;
export function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xp) xp = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = '/vendor/xlsx.full.min.js'; s.onload = () => res(window.XLSX); s.onerror = () => { xp = null; rej(new Error('Module Excel indisponible (hors ligne ?)')); };
    document.head.append(s);
  });
  return xp;
}

async function saveFile(buf, name) {
  const type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const blob = new Blob([buf], { type });
  if (isIOS() && navigator.canShare) {
    const file = new File([blob], name, { type });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

export async function exportExcel(data = null, name = null) {
  try {
    const XLSX = await loadXLSX();
    if (!data) await flush().catch(() => {});
    const wb = buildWorkbook(XLSX, data || S.data);
    const fname = name || exportFileName();
    await saveFile(XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true }), fname);
    toast(`Export Excel créé : ${fname}`);
  } catch (e) { toast(e.message, 'error'); }
}

// Restauration complète depuis un fichier Excel (export Cockpit ou ancien Finances_Data.xlsx)
export function importExcel() {
  const input = h('input', { type: 'file', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', style: { display: 'none' } });
  input.addEventListener('change', async () => {
    const f = input.files[0]; input.remove();
    if (!f) return;
    try {
      const XLSX = await loadXLSX();
      const res = parseWorkbook(XLSX, await f.arrayBuffer());
      previewRestore(res, f.name);
    } catch (e) { toast('Lecture du fichier impossible : ' + e.message, 'error'); }
  });
  document.body.append(input); input.click();
}

function previewRestore(res, fname) {
  const rows = TABLES.filter((t) => res.data[t.key]).map((t) => h('tr', null, h('td', null, t.sheet), h('td', { class: 'r num' }, (S.data[t.key] || []).length), h('td', { class: 'r num' }, res.data[t.key].length)));
  const skipped = TABLES.filter((t) => !res.data[t.key]).map((t) => t.sheet);
  const ok = h('input', { type: 'checkbox' });
  const go = h('button', { class: 'btn danger lg', disabled: true }, 'Remplacer toutes les données');
  ok.addEventListener('change', () => { go.disabled = !ok.checked || res.errors.length > 0; });
  go.addEventListener('click', async () => {
    go.disabled = true; go.textContent = 'Restauration…';
    const { data, error } = await sb.rpc('restore_all', { p_data: res.data, p_label: `Avant restauration depuis ${fname}`.slice(0, 80) });
    if (error) { toast('Restauration refusée : ' + error.message, 'error'); go.disabled = false; go.textContent = 'Remplacer toutes les données'; return; }
    await pull().catch(() => {}); emit(); m.close();
    toast(`Restauration terminée (${Object.values(data.counts).reduce((a, b) => a + b, 0)} lignes). Un point de restauration a été créé avant.`);
  });
  const m = modal({ title: 'Restaurer depuis un fichier Excel', sub: fname, width: 560, body: [
    res.errors.length ? h('div', { class: 'infobox', style: { background: 'var(--crit-bg)', color: 'var(--crit-ink)' } }, h('b', null, 'Fichier refusé : corrige ces lignes puis réessaie.'), h('ul', null, res.errors.map((e) => h('li', null, e)))) : null,
    h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Onglet'), h('th', { class: 'r' }, 'Actuellement'), h('th', { class: 'r' }, 'Dans le fichier'))), h('tbody', null, rows)),
    skipped.length ? h('div', { class: 'note' }, `Onglets absents du fichier, laissés tels quels : ${skipped.join(', ')}.`) : null,
    res.warnings.length ? h('div', { class: 'note' }, res.warnings.join(' · ')) : null,
    h('div', { class: 'infobox' }, 'Les données actuelles des onglets ci-dessus seront remplacées par celles du fichier, sur tous tes appareils. Un point de restauration est créé juste avant : tu peux revenir en arrière à tout moment (Paramètres › Données).'),
    h('label', { class: 'split' }, ok, 'J’ai compris, remplacer les données'),
  ], footer: [h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'), go] });
}

// ---------- Points de restauration (en base) ----------
export async function listRestorePoints() {
  const { data, error } = await sb.from('restore_points').select('id,label,created_at,rows').order('created_at', { ascending: false }).limit(30);
  if (error) throw error;
  return data;
}
export async function createRestorePoint() {
  const { error } = await sb.rpc('create_restore_point', { p_label: 'Manuel' });
  if (error) throw error;
}
export async function backToPoint(p) {
  if (!(await confirmBox(`Revenir à l’état du ${new Date(p.created_at).toLocaleString('fr-FR')} (« ${p.label} », ${p.rows} lignes) ? L’état actuel est d’abord sauvegardé dans un nouveau point.`, { ok: 'Revenir à ce point', danger: true }))) return false;
  const { error } = await sb.rpc('restore_point', { p_id: p.id });
  if (error) { toast(error.message, 'error'); return false; }
  await pull().catch(() => {}); emit();
  toast('Données restaurées.');
  return true;
}

// ---------- Historique des modifications ----------
const TBL_LABEL = { tx: 'Opération', categories: 'Catégorie', lots: 'Lot', tenants: 'Locataire', clients: 'Client', invoices: 'Facture', recurring: 'Automatisme', accounts: 'Compte', snapshots: 'Relevé', params: 'Paramètre', rappels: 'Rappel' };
const ACT_LABEL = { insert: 'Création', update: 'Modification', delete: 'Suppression', restore: 'Récupération' };
export async function openHistory() {
  const box = h('div', null, h('div', { class: 'muted' }, 'Chargement…'));
  const m = modal({ title: 'Historique des modifications', sub: '60 dernières, tous appareils confondus', width: 720, body: [box] });
  const draw = async () => {
    const { data, error } = await sb.from('change_log').select('id,tbl,row_id,action,old_row,new_row,device,at').order('id', { ascending: false }).limit(60);
    clear(box);
    if (error) { box.append(h('div', { class: 'err' }, error.message)); return; }
    box.append(h('table', { class: 'tbl' }, h('tbody', null, data.map((l) => {
      const r = l.new_row || l.old_row || {};
      const what = r.libelle || r.nom || r.numero || r.titre || r.cle || r.categorie || r.compte || '';
      const amount = r.montant ? ` · ${r.montant} ${r.devise || ''}` : '';
      const changed = l.action === 'update' && l.old_row ? Object.keys(l.new_row).filter((k) => !['updated_at', 'version'].includes(k) && JSON.stringify(l.new_row[k]) !== JSON.stringify(l.old_row[k])) : [];
      return h('tr', null,
        h('td', { style: { whiteSpace: 'nowrap', color: 'var(--ink-3)', fontSize: '12.5px' } }, new Date(l.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }), h('span', { class: 'sub' }, l.device || '')),
        h('td', null, h('b', null, `${ACT_LABEL[l.action] || l.action} · ${TBL_LABEL[l.tbl] || l.tbl}`), h('span', { class: 'sub' }, what + amount + (changed.length ? ` — ${changed.join(', ')}` : ''))),
        h('td', { class: 'r' }, h('button', { class: 'btn sm', title: l.action === 'insert' ? 'Annuler cette création' : 'Remettre la version d’avant', onClick: async () => {
          if (!(await confirmBox(l.action === 'insert' ? 'Annuler cette création (la ligne sera supprimée) ?' : l.action === 'delete' ? 'Récupérer cette ligne supprimée ?' : 'Remettre cette ligne dans son état d’avant la modification ?', { ok: 'Confirmer' }))) return;
          const { error: e2 } = await sb.rpc('restore_version', { p_log_id: l.id });
          if (e2) { toast(e2.message, 'error'); return; }
          await pull().catch(() => {}); emit(); toast('Fait.'); draw();
        } }, icon('undo', 14), l.action === 'delete' ? 'Récupérer' : 'Annuler')));
    }))));
  };
  draw();
}

// ---------- Sauvegardes externes (Cloudflare, chiffrées) ----------
async function backupFetch(path) {
  const { data: { session } } = await sb.auth.getSession();
  const r = await fetch(CONFIG.backupUrl + path, { headers: { Authorization: `Bearer ${session.access_token}` } });
  if (!r.ok) throw new Error(`Sauvegardes indisponibles (${r.status})`);
  return r.json();
}
export const backupsEnabled = () => CONFIG.backupUrl && !CONFIG.backupUrl.startsWith('__');
export async function listBackups() { return (await backupFetch('/list')).items; }
export async function downloadBackup(key) {
  const b = await backupFetch('/get?key=' + encodeURIComponent(key));
  const ui = {};
  for (const t of TABLES) ui[t.key] = (b.tables[t.key] || []).filter((r) => !r.deleted_at).map((r) => fromDb(t, r));
  await exportExcel(ui, `Cockpit_Sauvegarde_${key.split('/').pop()}.xlsx`);
}
export async function restoreBackup(key) {
  if (!(await confirmBox(`Remplacer toutes les données par la sauvegarde « ${key} » ? Un point de restauration est créé avant.`, { ok: 'Restaurer', danger: true }))) return;
  const b = await backupFetch('/get?key=' + encodeURIComponent(key));
  const { error } = await sb.rpc('restore_all', { p_data: b.tables, p_label: `Avant restauration de ${key}` });
  if (error) { toast(error.message, 'error'); return; }
  await pull().catch(() => {}); emit(); toast('Sauvegarde restaurée.');
}
export { BY_KEY };
