// Edge Function « bourse » : cours en (quasi) temps réel, recherche de titres, historiques, taux de change.
// Source : Yahoo Finance (API publique non officielle) ; cache 2 min dans la table « cours ».
// Réservée aux utilisateurs connectés avec MFA.
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('CK_SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const APP_URL = (Deno.env.get('APP_URL') || '').replace(/\/$/, '');
const ORIGINS = (Deno.env.get('APP_ORIGINS') || APP_URL).split(',').filter(Boolean);
const cors = (req: Request) => {
  const o = req.headers.get('origin') || '';
  return { 'Access-Control-Allow-Origin': ORIGINS.includes(o) || o.startsWith('http://localhost') ? o : (ORIGINS[0] || '*'), 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' };
};
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; Cockpit/1.0)' };
const SYM = /^[A-Z0-9.\-=^]{1,20}$/;

async function yahooChart(sym: string, range = '5d', interval = '1d') {
  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}`, { headers: UA, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const j = await r.json();
      const res = j.chart && j.chart.result && j.chart.result[0];
      if (res) return res;
    } catch { /* hôte suivant */ }
  }
  return null;
}

// Secteur et industrie d'un titre (Yahoo : la recherche renvoie sector / industry pour les actions ; rien pour les ETF et fonds)
async function profile(sym: string): Promise<{ secteur: string; industrie: string } | null> {
  try {
    const r = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(sym)}&quotesCount=6&newsCount=0`, { headers: UA, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = await r.json();
    const q = (j.quotes || []).find((x: any) => String(x.symbol || '').toUpperCase() === sym);
    return q ? { secteur: q.sector || '', industrie: q.industry || '' } : null;
  } catch { return null; }
}

async function quotes(symbols: string[]) {
  const syms = [...new Set(symbols.map((s) => String(s).toUpperCase().trim()).filter((s) => SYM.test(s)))].slice(0, 60);
  const { data: cached } = await admin.from('cours').select('*').in('symbole', syms);
  const fresh = new Map((cached || []).filter((c: any) => Date.now() - new Date(c.maj).getTime() < 120000).map((c: any) => [c.symbole, c]));
  const todo = syms.filter((s) => !fresh.has(s));
  const got = await Promise.all(todo.map(async (s) => {
    const res = await yahooChart(s);
    if (!res || !res.meta || !(res.meta.regularMarketPrice > 0)) return null;
    const m = res.meta;
    const old = (cached || []).find((c: any) => c.symbole === s);
    // secteur : conservé s'il est connu ; sinon recherché (« - » = cherché sans résultat : ETF, fonds, titre non coté)
    let secteur = old && old.secteur ? old.secteur : '', industrie = old && old.industrie ? old.industrie : '';
    if (!secteur) { const p = (m.instrumentType || '') === 'EQUITY' ? await profile(s) : null; secteur = p && p.secteur ? p.secteur : '-'; industrie = p ? p.industrie : ''; }
    return { symbole: s, nom: m.longName || m.shortName || s, prix: m.regularMarketPrice, veille: m.chartPreviousClose || m.previousClose || null, devise: m.currency === 'GBp' ? 'GBX' : (m.currency || 'EUR').toUpperCase(), place: m.fullExchangeName || m.exchangeName || '', type: m.instrumentType || '', maj: new Date().toISOString(), source: 'Yahoo Finance', secteur, industrie };
  }));
  const rows = got.filter(Boolean) as any[];
  if (rows.length) await admin.from('cours').upsert(rows);
  const all = [...fresh.values(), ...rows];
  for (const s of syms) if (!all.some((x) => x.symbole === s)) { const c = (cached || []).find((x: any) => x.symbole === s); if (c) all.push({ ...c, stale: true }); }
  await ensureFx([...new Set(all.map((x) => x.devise))]);
  return all;
}

// Taux de change vers l'euro pour les devises des titres (stockés dans fx_rates : « USD/EUR » = 1 USD en EUR)
async function ensureFx(curs: string[]) {
  const need = curs.filter((c) => c && c !== 'EUR' && c !== 'MAD');
  if (!need.length) return;
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await admin.from('fx_rates').select('pair').eq('date', today).in('pair', need.map((c) => `${c}/EUR`));
  const missing = need.filter((c) => !(data || []).some((d: any) => d.pair === `${c}/EUR`));
  if (!missing.length) return;
  try {
    const j = await (await fetch('https://open.er-api.com/v6/latest/EUR', { signal: AbortSignal.timeout(8000) })).json();
    const rows = missing.map((c) => {
      const per = c === 'GBX' || c === 'GBP' ? j.rates.GBP : j.rates[c];   // GBX = pence
      return per > 0 ? { date: today, pair: `${c}/EUR`, rate: (c === 'GBX' ? 0.01 : 1) / per, source: 'open.er-api.com' } : null;
    }).filter(Boolean);
    if (rows.length) await admin.from('fx_rates').upsert(rows);
  } catch (e) { console.error('fx', e); }
}

async function search(q: string) {
  const r = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q.slice(0, 60))}&quotesCount=10&newsCount=0&lang=fr-FR&region=FR`, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.quotes || []).filter((x: any) => x.symbol && x.quoteType !== 'OPTION').map((x: any) => ({ symbole: x.symbol, nom: x.longname || x.shortname || x.symbol, place: x.exchDisp || x.exchange || '', type: x.quoteType === 'ETF' ? 'ETF' : x.quoteType === 'MUTUALFUND' ? 'Fonds' : x.quoteType === 'CRYPTOCURRENCY' ? 'Crypto' : 'Action', secteur: x.sector || '', industrie: x.industry || '' }));
}

async function history(symbols: string[]) {
  const syms = [...new Set(symbols.map((s) => String(s).toUpperCase()).filter((s) => SYM.test(s)))].slice(0, 30);
  const week = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
  for (const s of syms) {
    const { data } = await admin.from('cours_hist').select('date').eq('symbole', s).gte('date', week).limit(1);
    if (data && data.length) continue;
    const res = await yahooChart(s, '10y', '1wk');
    if (!res || !res.timestamp) continue;
    const closes = res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close || [];
    const rows = res.timestamp.map((t: number, i: number) => ({ symbole: s, date: new Date(t * 1000).toISOString().slice(0, 10), close: closes[i] })).filter((r: any) => r.close > 0);
    for (let i = 0; i < rows.length; i += 500) await admin.from('cours_hist').upsert(rows.slice(i, i + 500));
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  const h = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...h, 'Content-Type': 'application/json' } });
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'non autorisé' }, 401);
  const { data: u, error } = await admin.auth.getUser(jwt);
  if (error || !u.user) return json({ error: 'session invalide' }, 401);
  let aal = '';
  try { aal = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal; } catch { /* */ }
  if (aal !== 'aal2') return json({ error: 'MFA requise' }, 403);
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === 'quotes') return json({ quotes: await quotes(body.symbols || []) });
    if (body.action === 'search') return json({ results: await search(String(body.q || '')) });
    if (body.action === 'history') return json(await history(body.symbols || []));
    return json({ error: 'action inconnue' }, 400);
  } catch (e) { console.error(e); return json({ error: (e as Error).message }, 500); }
});
