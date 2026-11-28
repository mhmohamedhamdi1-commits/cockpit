// Bourse : portefeuille d'actions / ETF saisi par l'utilisateur, valorisé aux cours du marché.
// Volontairement séparé des totaux (tableau de bord, trésorerie).
import { h, icon, eur, money, pct, num2, fmtDate, clear, debounce, sum, parseAmount, monthShort } from '../util.js';
import { S, ops, upsert, del, emit } from '../state.js';
import { M, fxOf, ordres, call, refreshQuotes, sectorOf, SECTEURS, SECTEURS_FR } from '../market.js';
import { modal, field, select, confirmBox, empty, toast, segmented } from '../ui.js';
import { kpi } from './common.js';
import { seriesChart, donut, barList, PALETTE } from '../charts.js';
import { portfolio, simulateSale } from '../core.js';

export function meta() { return { title: 'Bourse', sub: 'Portefeuille valorisé aux cours du marché — séparé des autres totaux', period: false, immoToggle: false }; }

const V = { by: 'titre', range: 'all', type: 'area', timer: null };   // état propre à l'écran (les cours sont partagés : market.js)
const COMPTES = ['PEA', 'CTO', 'Assurance-vie', 'PER', 'Crypto', 'Autre'];
const TYPES = ['Action', 'ETF', 'Fonds', 'Obligation', 'Crypto', 'Autre'];
const qfmt = (v) => (Math.round(v * 1e6) / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 6 });
const signed = (v, f = eur) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${f(Math.abs(v))}`);
const cls = (v) => (v == null ? 'muted' : v > 0 ? 'pos' : v < 0 ? 'neg' : 'muted');
const refresh = refreshQuotes;

function evolution(pf) {
  const os = ordres();
  if (!os.length) return null;
  const first = os.reduce((m, o) => (o.date < m ? o.date : m), S.today);
  const from = V.range === 'all' ? first : (() => { const d = new Date(S.today); d.setFullYear(d.getFullYear() - Number(V.range)); return d.toISOString().slice(0, 10); })();
  const pts = [];
  const d = new Date(Math.max(new Date(first), new Date(from)));
  d.setDate(1);
  while (d.toISOString().slice(0, 10) <= S.today) {
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
    const at = end > S.today ? S.today : end;
    const sub = os.filter((o) => o.date <= at);
    const q = {};
    for (const s of new Set(sub.map((o) => o.symbole))) {
      const hs = M.hist[s] || [];
      let c = null; for (const x of hs) { if (x.d <= at) c = x.c; else break; }
      if (at === S.today && M.quotes[s]) c = M.quotes[s].prix;
      if (c != null) q[s] = { prix: c, devise: (M.quotes[s] || {}).devise || (sub.find((o) => o.symbole === s) || {}).devise || 'EUR' };
    }
    const p = portfolio(sub, q, fxOf);
    pts.push({ key: at.slice(0, 7), label: monthShort(at.slice(0, 7)), sub: at.slice(5, 7) === '01' || !pts.length ? at.slice(0, 4) : '', full: fmtDate(at), value: p.total.value, cost: p.total.cost });
    d.setMonth(d.getMonth() + 1);
  }
  return pts;
}

export function render() {
  if (Date.now() - M.loadedAt > 60000) setTimeout(() => refresh(), 0);
  clearInterval(V.timer);
  V.timer = setInterval(() => { if (S.route === 'bourse' && document.visibilityState === 'visible') refresh(true); else clearInterval(V.timer); }, 60000);
  const pf = portfolio(ordres(), M.quotes, fxOf);
  const t = pf.total;
  const head = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Mon portefeuille'),
    h('span', { class: 'sub' }, M.loading ? 'actualisation des cours…' : M.loadedAt ? `cours du ${new Date(M.loadedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · Yahoo Finance (différé possible)` : ''),
    h('div', { class: 'right' }, h('button', { class: 'btn', onClick: () => refresh(true) }, icon('repeat', 15), 'Actualiser'), h('button', { class: 'btn primary', onClick: () => openOrder() }, icon('plus', 16), 'Ajouter un ordre'))),
    M.error ? h('div', { class: 'infobox', style: { background: 'var(--warn-bg)', color: 'var(--warn-ink)' } }, `Cours indisponibles pour le moment (${M.error}). Les montants sont calculés au prix de revient.`) : null,
    t.missing ? h('div', { class: 'note' }, `${t.missing} titre(s) sans cours : valorisés au prix de revient.`) : null,
    !ordres().length ? empty('Aucun titre pour l’instant', 'Ajoute tes achats (titre, quantité, prix) : la valeur est calculée en continu aux cours du marché.', h('button', { class: 'btn primary', onClick: () => openOrder() }, icon('plus', 16), 'Ajouter mon premier achat')) : null);
  if (!ordres().length) return [head];

  const kpis = h('div', { class: 'kpis' },
    kpi({ title: 'Valeur du portefeuille', ic: 'trend', value: eur(t.value), sub: [h('span', null, `${pf.open.length} ligne${pf.open.length > 1 ? 's' : ''} · coût ${eur(t.cost)}`)] }),
    kpi({ title: 'Plus-value latente', ic: 'chart', value: h('span', { class: cls(t.latent) }, signed(t.latent)), sub: [h('span', { class: 'delta ' + (t.latent >= 0 ? 'good' : 'bad') }, signed(t.cost ? t.latent / t.cost : 0, (x) => pct(x, 1))), h('span', null, 'sur les lignes détenues')] }),
    kpi({ title: 'Réalisé + dividendes', ic: 'wallet', value: h('span', { class: cls(t.realized + t.dividends) }, signed(t.realized + t.dividends)), sub: [h('span', null, `plus-values ${signed(t.realized)} · dividendes ${eur(t.dividends)}`)] }),
    kpi({ title: 'ROI global', ic: 'up', value: h('span', { class: cls(t.roi) }, t.roi == null ? '—' : signed(t.roi, (x) => pct(x, 1))), sub: [h('span', null, `gain total ${signed(t.gain)} sur ${eur(t.invested)} investis (non annualisé)`)] }));

  // évolution
  const ev = evolution(pf);
  const evCard = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Évolution'), h('span', { class: 'sub' }, 'valeur de marché et prix de revient, fin de mois')),
    h('div', { class: 'chartctl' },
      segmented([{ value: '1', label: '1 an' }, { value: '3', label: '3 ans' }, { value: '5', label: '5 ans' }, { value: 'all', label: 'Tout' }], V.range, (v) => { V.range = v; emit(); }, 'sm'),
      segmented([{ value: 'area', label: 'Aires' }, { value: 'line', label: 'Courbes' }, { value: 'bar', label: 'Barres' }], V.type, (v) => { V.type = v; emit(); }, 'sm')),
    ev && ev.length > 1 ? seriesChart({ labels: ev, type: V.type, title: 'Évolution du portefeuille', series: [{ name: 'Valeur', color: '#007AFF', values: ev.map((p) => p.value) }, { name: 'Prix de revient', color: '#8E8E93', values: ev.map((p) => p.cost) }] })
      : empty('Historique en cours de chargement', 'La courbe apparaît dès que les cours historiques sont disponibles.'));

  // répartition
  const groups = new Map();
  for (const p of pf.open) { const k = V.by === 'titre' ? p.nom : V.by === 'type' ? (p.type || 'Autre') : V.by === 'secteur' ? sectorOf(p) : (p.compte || 'Autre'); groups.set(k, (groups.get(k) || 0) + (p.value ?? p.cost)); }
  const items = [...groups.entries()].sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label, value, color: PALETTE[i % PALETTE.length] }));
  const allocCard = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Répartition')),
    h('div', { class: 'chartctl' }, segmented([{ value: 'titre', label: 'Par titre' }, { value: 'secteur', label: 'Par secteur' }, { value: 'type', label: 'Par type' }, { value: 'compte', label: 'Par compte' }], V.by, (v) => { V.by = v; emit(); }, 'sm')),
    h('div', { class: 'alloc' }, donut(items, { center: eur(t.value) }), h('div', { class: 'legendv' }, items.map((i) => h('div', null, h('i', { style: { background: i.color } }), h('span', null, i.label), h('b', { class: 'num' }, pct(i.value / (t.value || 1))))))));

  // performance par titre
  const perfCard = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Performance par titre'), h('span', { class: 'sub' }, 'ROI total (latent + réalisé + dividendes), non annualisé')),
    barList(pf.positions.filter((p) => p.roi != null).sort((a, b) => b.roi - a.roi).map((p) => ({ label: p.nom, value: p.roi, color: p.roi >= 0 ? 'var(--good)' : 'var(--crit)' })), { fmt: (v) => signed(v, (x) => pct(x, 1)) }));

  // positions
  const posCard = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Positions'), h('span', { class: 'sub' }, 'clique sur une ligne pour le détail et la simulation de vente')),
    h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Titre', 'Qté', 'PRU', 'Cours', 'Jour', 'Valeur', '+/− latente', 'ROI'].map((x, i) => h('th', { class: i ? 'r' : '' }, x)))),
      h('tbody', null, pf.positions.filter((p) => p.open || p.realized).map((p) => h('tr', { class: 'click' + (p.open ? '' : ' dim'), onClick: () => openPosition(p.symbole) },
        h('td', null, p.nom, h('span', { class: 'sub' }, `${p.symbole} · ${p.compte || '—'} · ${sectorOf(p)}${p.open ? '' : ' · soldée'}`)),
        h('td', { class: 'r num' }, qfmt(p.qty)),
        h('td', { class: 'r num', 'data-sort': p.pru }, p.open ? eur(p.pru, 2) : '—'),
        h('td', { class: 'r num', 'data-sort': p.priceLocal ?? '' }, p.priceLocal != null ? money(p.priceLocal, (M.quotes[p.symbole] || {}).devise || 'EUR', 2) : '—'),
        h('td', { class: 'r num ' + cls(p.change), 'data-sort': p.change ?? '' }, p.change == null ? '—' : signed(p.change, (x) => pct(x, 2))),
        h('td', { class: 'r num', 'data-sort': p.value ?? p.cost }, p.open ? eur(p.value ?? p.cost) : '—'),
        h('td', { class: 'r num ' + cls(p.latent), 'data-sort': p.latent ?? '' }, p.open ? [signed(p.latent), h('span', { class: 'sub' }, p.latentPct == null ? '' : signed(p.latentPct, (x) => pct(x, 1)))] : '—'),
        h('td', { class: 'r num ' + cls(p.roi), 'data-sort': p.roi ?? '' }, p.roi == null ? '—' : signed(p.roi, (x) => pct(x, 1))))))));

  // ordres
  const os = [...ordres()].sort((a, b) => (a.date < b.date ? 1 : -1));
  const ordCard = h('div', { class: 'card' }, h('header', null, h('h2', null, 'Historique des ordres'), h('span', { class: 'sub' }, `${os.length}`)),
    h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Date', 'Titre', 'Opération', 'Qté', 'Prix', 'Frais', 'Montant'].map((x, i) => h('th', { class: i >= 3 ? 'r' : '' }, x)))),
      h('tbody', null, os.map((o) => h('tr', { class: 'click', onClick: () => openOrder(o) },
        h('td', { 'data-sort': o.date.replace(/-/g, '') }, fmtDate(o.date)), h('td', null, o.nom || o.symbole, h('span', { class: 'sub' }, `${o.symbole} · ${o.compte}`)),
        h('td', null, h('span', { class: 'pill ' + (o.sens === 'Achat' ? 'info' : o.sens === 'Vente' ? 'warn' : 'good') }, o.sens)),
        h('td', { class: 'r num' }, o.quantite ? qfmt(o.quantite) : '—'), h('td', { class: 'r num' }, money(o.prix, o.devise, 2)), h('td', { class: 'r num' }, o.frais ? money(o.frais, o.devise, 2) : '—'),
        h('td', { class: 'r num' }, money(o.sens === 'Dividende' && !o.quantite ? o.prix : o.quantite * o.prix, o.devise, 2)))))));
  // dividendes : 12 derniers mois
  const dm = []; for (let k = 11; k >= 0; k--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - k); dm.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
  const divBy = new Map(dm.map((k) => [k, 0]));
  for (const o of ordres()) if (o.sens === 'Dividende' && divBy.has(o.date.slice(0, 7))) divBy.set(o.date.slice(0, 7), divBy.get(o.date.slice(0, 7)) + (o.quantite ? o.quantite * o.prix : o.prix) * (fxOf(o.devise) || 1) - (o.frais || 0) * (fxOf(o.devise) || 1));
  const divTot = [...divBy.values()].reduce((a, b) => a + b, 0);
  const divCard = divTot > 0 ? h('div', { class: 'card' }, h('header', null, h('h2', null, 'Dividendes'), h('span', { class: 'sub' }, `${eur(divTot)} sur 12 mois · rendement ${t.value ? pct(divTot / t.value, 1) : '—'} de la valeur`)),
    seriesChart({ labels: dm.map((k) => ({ key: k, label: monthShort(k), sub: k.endsWith('-01') ? k.slice(0, 4) : '', full: k })), type: 'bar', title: 'Dividendes par mois', series: [{ name: 'Dividendes', color: 'var(--flow-in)', values: dm.map((k) => divBy.get(k)) }] })) : null;
  return [head, kpis, h('div', { class: 'row2' }, evCard, allocCard), divCard, h('div', { class: 'row2e' }, perfCard, h('div', { class: 'card' }, h('header', null, h('h2', null, 'Frais et fiscalité')),
    h('div', { class: 'cashlist' },
      h('div', { class: 'cashrow' }, h('div', null, h('b', null, 'Frais payés'), h('span', { class: 'sub' }, 'courtage, tous ordres')), h('div', { class: 'num v' }, eur(t.fees, 2))),
      h('div', { class: 'cashrow' }, h('div', null, h('b', null, 'Plus-values réalisées'), h('span', { class: 'sub' }, 'méthode du prix moyen pondéré')), h('div', { class: 'num v ' + cls(t.realized) }, signed(t.realized))),
      h('div', { class: 'cashrow total' }, h('div', null, h('b', null, 'Impôt estimé si tout est vendu'), h('span', { class: 'sub' }, 'PFU 30 % sur la plus-value latente (CTO) — indicatif')), h('div', { class: 'num v' }, eur(Math.max(0, t.latent) * 0.3)))))),
    posCard, ordCard];
}

// ---------- détail d'une position + simulation de vente ----------
function openPosition(sym) {
  const pf = portfolio(ordres(), M.quotes, fxOf);
  const p = pf.positions.find((x) => x.symbole === sym);
  if (!p) return;
  const qt = M.quotes[sym];
  const qty = h('input', { type: 'text', inputmode: 'decimal', value: p.open ? String(p.qty).replace('.', ',') : '0' });
  const price = h('input', { type: 'text', inputmode: 'decimal', value: p.price != null ? String(Math.round(p.price * 100) / 100).replace('.', ',') : String(Math.round(p.pru * 100) / 100).replace('.', ',') });
  const fee = h('input', { type: 'text', inputmode: 'decimal', value: '0' });
  const regime = select([{ value: '0.3', label: 'CTO — flat tax 30 %' }, { value: '0.172', label: 'PEA de plus de 5 ans — 17,2 %' }, { value: '0.3', label: 'PEA de moins de 5 ans — 30 %' }, { value: '0', label: 'Sans impôt' }], p.compte === 'PEA' ? '0.172' : '0.3');
  const out = h('div', { class: 'cashlist' });
  const upd = () => {
    const s = simulateSale(p, parseAmount(qty.value), parseAmount(price.value), { fee: parseAmount(fee.value), taxRate: Number(regime.value) });
    clear(out);
    const r = (l, v, c = '') => h('div', { class: 'cashrow' }, h('b', null, l), h('div', { class: 'num v ' + c }, v));
    out.append(r('Produit de la vente', eur(s.proceeds, 2)), r('Prix de revient vendu', eur(s.costBasis, 2)), r('Plus / moins-value', [signed(s.gain), h('span', { class: 'sub' }, s.gainPct == null ? '' : ' ' + signed(s.gainPct, (x) => pct(x, 1)))], cls(s.gain)), r('Impôt estimé', eur(s.tax, 2)), r('Net encaissé', h('b', null, eur(s.net, 2))), r('Quantité restante', qfmt(s.remaining)));
  };
  [qty, price, fee].forEach((x) => x.addEventListener('input', upd)); regime.addEventListener('change', upd); upd();
  const st = (l, v, c = '') => h('div', null, h('div', { class: 'muted', style: { fontSize: '12px', fontWeight: 650 } }, l), h('div', { class: 'num ' + c, style: { fontSize: '18px', fontWeight: 700 } }, v));
  modal({ title: p.nom, sub: `${p.symbole}${qt && qt.place ? ' · ' + qt.place : ''} · ${p.compte || ''}`, width: 640, body: [
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' } },
      st('Quantité', qfmt(p.qty)), st('PRU', eur(p.pru, 2)), st('Cours', p.priceLocal != null ? money(p.priceLocal, qt.devise, 2) : '—'),
      st('Valeur', p.value != null ? eur(p.value) : '—'), st('+/− latente', signed(p.latent), cls(p.latent)), st('ROI total', p.roi == null ? '—' : signed(p.roi, (x) => pct(x, 1)), cls(p.roi))),
    (() => {
      const sel = select([...SECTEURS.map((x) => ({ value: x, label: x })), { value: 'Non classé', label: 'Non classé' }], sectorOf(p));
      sel.addEventListener('change', async () => {
        const list = ordres().filter((o) => o.symbole === p.symbole).map((o) => upsert('ordre', { ...o, secteur: sel.value === 'Non classé' ? '' : sel.value }));
        if (list.length && await ops(list, `Secteur de ${p.nom} : ${sel.value}`)) emit();
      });
      return field('Secteur (pour la répartition)', sel, 'Appliqué à tous les ordres de ce titre');
    })(),
    h('div', { class: 'grp', style: { marginTop: '6px' } }, 'Simuler une vente'),
    h('div', { class: 'grid3' }, field('Quantité vendue', qty), field('Prix de vente (€)', price), field('Frais (€)', fee)), field('Régime fiscal', regime), out,
    h('div', { class: 'note' }, 'Estimation indicative (prix moyen pondéré, hors abattements et situations particulières).')],
  footer: [h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => openOrder({ symbole: p.symbole, nom: p.nom, type: p.type, compte: p.compte, devise: (qt || {}).devise || p.devise, sens: 'Vente', quantite: parseAmount(qty.value), prix: (qt || {}).prix || 0 }) }, 'Enregistrer cette vente'), h('button', { class: 'btn primary', onClick: () => openOrder({ symbole: p.symbole, nom: p.nom, type: p.type, compte: p.compte, devise: (qt || {}).devise || p.devise, sens: 'Achat', prix: (qt || {}).prix || 0 }) }, icon('plus', 15), 'Acheter')] });
}

// ---------- saisie d'un ordre ----------
function openOrder(o = {}) {
  const editing = !!o.id;
  const f = { symbole: o.symbole || '', nom: o.nom || '', type: o.type || 'Action', devise: o.devise || 'EUR', place: '', secteurAuto: '' };
  const searchIn = h('input', { type: 'search', placeholder: 'Nom ou symbole : Airbus, CW8, Apple, BTC…', value: f.symbole ? `${f.nom} (${f.symbole})` : '' });
  const results = h('div', { class: 'suggest', style: { display: 'none' } });
  const sens = { v: o.sens || 'Achat' };
  const sensSeg = segmented([{ value: 'Achat', label: 'Achat' }, { value: 'Vente', label: 'Vente' }, { value: 'Dividende', label: 'Dividende' }], sens.v, (v) => { sens.v = v; lbl(); }, 'block');
  const date = h('input', { type: 'date', value: o.date || S.today });
  const qty = h('input', { type: 'text', inputmode: 'decimal', value: o.quantite ? String(o.quantite).replace('.', ',') : '' });
  const prix = h('input', { type: 'text', inputmode: 'decimal', value: o.prix ? String(o.prix).replace('.', ',') : '' });
  const frais = h('input', { type: 'text', inputmode: 'decimal', value: o.frais ? String(o.frais).replace('.', ',') : '' });
  const compte = select(COMPTES, o.compte || 'PEA');
  const type = select(TYPES, f.type);
  const secteur = select([{ value: '', label: 'Automatique (selon le marché)' }, ...SECTEURS.map((x) => ({ value: x, label: x }))], o.secteur ? (SECTEURS_FR[o.secteur] || o.secteur) : '');
  const note = h('input', { type: 'text', value: o.note || '' });
  const curEl = h('span', { class: 'muted' });
  const total = h('div', { class: 'infobox num' });
  const qtyField = field('Quantité', qty), prixField = field('Prix unitaire', prix);
  const lbl = () => { prixField.querySelector('label').textContent = sens.v === 'Dividende' ? `Montant (${f.devise})` : `Prix unitaire (${f.devise})`; qtyField.style.display = sens.v === 'Dividende' ? 'none' : ''; upd(); };
  const upd = () => { const q = parseAmount(qty.value), p = parseAmount(prix.value), fr = parseAmount(frais.value); const amt = sens.v === 'Dividende' ? p : q * p; total.textContent = `${sens.v === 'Achat' ? 'Coût total' : sens.v === 'Vente' ? 'Produit net' : 'Montant net'} : ${money(sens.v === 'Achat' ? amt + fr : amt - fr, f.devise, 2)}${f.devise !== 'EUR' && fxOf(f.devise) ? ` (≈ ${eur((sens.v === 'Achat' ? amt + fr : amt - fr) * fxOf(f.devise), 2)})` : ''}`; curEl.textContent = f.symbole ? `${f.symbole} · ${f.devise}${f.place ? ' · ' + f.place : ''}` : ''; };
  [qty, prix, frais].forEach((x) => x.addEventListener('input', upd));
  const pick = async (r) => {
    Object.assign(f, { symbole: r.symbole, nom: r.nom, type: r.type || f.type, place: r.place || '', secteurAuto: r.secteur ? (SECTEURS_FR[r.secteur] || r.secteur) : '' });
    if (!secteur.value && f.secteurAuto) secteur.title = `Secteur détecté : ${f.secteurAuto}`;
    searchIn.value = `${r.nom} (${r.symbole})`; results.style.display = 'none'; type.value = f.type;
    try {
      const { quotes } = await call({ action: 'quotes', symbols: [r.symbole] });
      const q = quotes[0];
      if (q) { f.devise = q.devise; M.quotes[q.symbole] = { prix: Number(q.prix), devise: q.devise, variation: q.veille ? q.prix / q.veille - 1 : null, nom: q.nom, place: q.place }; if (!prix.value) prix.value = String(Math.round(q.prix * 100) / 100).replace('.', ','); }
    } catch { /* prix à saisir */ }
    lbl();
  };
  const doSearch = debounce(async () => {
    const q = searchIn.value.trim();
    if (q.length < 2) { results.style.display = 'none'; return; }
    try {
      const { results: rs } = await call({ action: 'search', q });
      clear(results);
      rs.forEach((r) => results.append(h('div', { onMousedown: (e) => { e.preventDefault(); pick(r); } }, h('span', null, r.nom, h('small', null, `  ${r.type}`)), h('small', null, `${r.symbole} · ${r.place}`))));
      results.style.display = rs.length ? 'block' : 'none';
    } catch (e) { toast(e.message, 'error'); }
  }, 350);
  searchIn.addEventListener('input', doSearch);
  searchIn.addEventListener('blur', () => setTimeout(() => { results.style.display = 'none'; }, 150));
  const err = h('div', { class: 'err' });
  const save = async () => {
    if (!f.symbole) { err.textContent = 'Choisis un titre dans la liste.'; return; }
    const q = parseAmount(qty.value), p = parseAmount(prix.value);
    if (sens.v !== 'Dividende' && !(q > 0)) { err.textContent = 'Saisis la quantité.'; return; }
    if (!(p >= 0) || (sens.v === 'Dividende' && !(p > 0))) { err.textContent = 'Saisis le prix.'; return; }
    if (sens.v === 'Vente') {
      const pos = portfolio(ordres().filter((x) => x.id !== o.id), M.quotes, fxOf).positions.find((x) => x.symbole === f.symbole);
      if (!pos || pos.qty + 1e-9 < q) { err.textContent = `Tu ne détiens que ${pos ? qfmt(pos.qty) : 0} titre(s) ${f.symbole}.`; return; }
    }
    const item = { ...o, id: o.id || 0, date: date.value, symbole: f.symbole, nom: f.nom, type: type.value, compte: compte.value, sens: sens.v, quantite: sens.v === 'Dividende' ? 0 : q, prix: p, frais: parseAmount(frais.value), devise: f.devise, note: note.value.trim(), secteur: secteur.value || (f.secteurAuto && !o.id ? f.secteurAuto : (o.secteur || '')) };
    if (await ops([upsert('ordre', item)], editing ? 'Ordre modifié' : `${sens.v} enregistré`)) { m.close(); refresh(true); }
  };
  const m = modal({ title: editing ? 'Modifier l’ordre' : 'Nouvel ordre de bourse', width: 620, body: [
    h('div', { class: 'field rel' }, h('label', null, 'Titre'), searchIn, results, curEl),
    sensSeg,
    h('div', { class: 'grid3' }, qtyField, prixField, field('Frais', frais)),
    h('div', { class: 'grid3' }, field('Date', date), field('Compte', compte), field('Type', type)),
    h('div', { class: 'grid2' }, field('Secteur', secteur, 'Sert à la répartition par secteur ; laisse « Automatique » pour les actions cotées'), field('Note', note)), total, err],
  footer: [editing ? h('button', { class: 'btn danger', onClick: async () => { if (await confirmBox('Supprimer cet ordre ?', { ok: 'Supprimer', danger: true })) { if (await ops([del('ordre', o.id)], 'Ordre supprimé')) m.close(); } } }, icon('trash', 15), 'Supprimer') : null,
    h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'), h('button', { class: 'btn primary lg', onClick: save }, 'Enregistrer')] });
  lbl();
  if (!editing && !f.symbole) setTimeout(() => searchIn.focus(), 50);
}
