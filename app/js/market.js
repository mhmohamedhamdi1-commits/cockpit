// Données de marché partagées (cours, taux, historiques) : utilisées par Bourse, le tableau de bord (santé, répartition)
// et Patrimoine (valeur du portefeuille ajoutée automatiquement). Un seul chargement pour tous les écrans.
import { sb } from './supa.js';
import { S, emit } from './state.js';
import { portfolio } from './core.js';

export const M = { quotes: {}, fx: {}, hist: {}, loadedAt: 0, loading: false, error: '' };
export const fxOf = (d) => (d === 'EUR' ? 1 : d === 'MAD' ? S.P.taux : d === 'USD' || d === 'GBP' || d === 'CHF' ? (M.fx[d] || S.fx[d] || null) : M.fx[d] || null);
export const ordres = () => S.data.ordres || [];

export async function call(body) {
  const { data, error } = await sb.functions.invoke('bourse', { body });
  if (error) throw new Error(error.message || 'Service des cours indisponible');
  return data;
}

const WATCH = ['bourse', 'dashboard', 'wealth'];
export async function refreshQuotes(force = false) {
  const syms = [...new Set(ordres().map((o) => o.symbole))];
  if (!syms.length || M.loading || (!force && Date.now() - M.loadedAt < 60000)) return;
  M.loading = true; M.error = '';
  try {
    const { quotes } = await call({ action: 'quotes', symbols: syms });
    for (const q of quotes) M.quotes[q.symbole] = { prix: Number(q.prix), devise: q.devise, variation: q.veille ? Number(q.prix) / Number(q.veille) - 1 : null, nom: q.nom, maj: q.maj, stale: q.stale, place: q.place, secteur: q.secteur && q.secteur !== '-' ? q.secteur : '', industrie: q.industrie || '' };
    const curs = [...new Set(quotes.map((q) => q.devise).filter((d) => d !== 'EUR' && d !== 'MAD'))];
    if (curs.length) {
      const { data } = await sb.from('fx_rates').select('pair,rate,date').in('pair', curs.map((c) => `${c}/EUR`)).order('date', { ascending: false }).limit(200);
      for (const r of data || []) { const c = r.pair.split('/')[0]; if (!M.fx[c]) M.fx[c] = Number(r.rate); }
    }
    M.loadedAt = Date.now();
    loadHistory(syms);
  } catch (e) { M.error = e.message; }
  M.loading = false;
  if (WATCH.includes(S.route)) emit();
}
// Lance une actualisation en arrière-plan si les cours ont plus d'une minute (sans bloquer l'écran)
export function ensureQuotes() { if (Date.now() - M.loadedAt > 60000 && !M.loading) setTimeout(() => refreshQuotes(), 0); }

let histLoading = false;
async function loadHistory(syms) {
  if (histLoading) return;
  histLoading = true;
  try {
    await call({ action: 'history', symbols: syms });
    for (const s of syms) {
      const { data } = await sb.from('cours_hist').select('date,close').eq('symbole', s).order('date');
      M.hist[s] = (data || []).map((r) => ({ d: r.date, c: Number(r.close) }));
    }
    if (S.route === 'bourse') emit();
  } catch { /* historique facultatif */ }
  histLoading = false;
}

export const portfolioNow = () => portfolio(ordres(), M.quotes, fxOf);

// ---------- secteurs ----------
export const SECTEURS_FR = {
  'Technology': 'Technologie', 'Communication Services': 'Communication & médias', 'Consumer Cyclical': 'Consommation cyclique', 'Consumer Defensive': 'Consommation de base',
  'Healthcare': 'Santé', 'Financial Services': 'Finance', 'Industrials': 'Industrie', 'Energy': 'Énergie', 'Utilities': 'Services publics', 'Real Estate': 'Immobilier coté', 'Basic Materials': 'Matériaux',
};
export const SECTEURS = ['Technologie', 'Communication & médias', 'Consommation cyclique', 'Consommation de base', 'Santé', 'Finance', 'Industrie', 'Énergie', 'Services publics', 'Immobilier coté', 'Matériaux', 'ETF / fonds diversifiés', 'Crypto', 'Obligations', 'Autre'];
// Secteur d'une position : celui choisi par l'utilisateur (ordre), sinon celui du marché (traduit), sinon selon le type
export function sectorOf(p) {
  const user = String(p.secteur || '').trim();
  if (user) return SECTEURS_FR[user] || user;
  const q = M.quotes[p.symbole];
  if (q && q.secteur) return SECTEURS_FR[q.secteur] || q.secteur;
  if (p.type === 'ETF' || p.type === 'Fonds') return 'ETF / fonds diversifiés';
  if (p.type === 'Crypto') return 'Crypto';
  if (p.type === 'Obligation') return 'Obligations';
  return 'Non classé';
}
