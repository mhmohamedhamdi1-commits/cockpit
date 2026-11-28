// Edge Function « rappels » : calcule les rappels (mêmes règles que le tableau de bord) et envoie
// les notifications Web Push sur les appareils abonnés (iPhone, Windows, navigateur).
// - appel planifié (pg_cron, toutes les heures) : en-tête x-cron-secret
// - appel « test » depuis l'application : jeton de l'utilisateur (session MFA) + { test: true }
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { TABLES, fromDb } from '../_shared/schema.js';
import * as core from '../_shared/core.js';
import * as ent from '../_shared/entreprise.js';
import { monthLong, monthLabel, daysBetween, eur, mad, addMonths } from '../_shared/util.js';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('CK_SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const APP_URL = (Deno.env.get('APP_URL') || '').replace(/\/$/, '');
webpush.setVapidDetails(`mailto:${Deno.env.get('VAPID_CONTACT') || 'cockpit@example.com'}`, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);
const admin = createClient(SB_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = { 'Access-Control-Allow-Origin': APP_URL || '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function paris(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false, weekday: 'short' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, weekday: p.weekday as string };
}
function isoWeek(date: string) {
  const d = new Date(date + 'T12:00:00Z'); const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return `${d.getUTCFullYear()}-W${String(1 + Math.round(((d.getTime() - first.getTime()) / 864e5 - 3 + ((first.getUTCDay() + 6) % 7)) / 7)).padStart(2, '0')}`;
}

async function loadData(uid: string) {
  const data: Record<string, unknown[]> = {};
  for (const def of TABLES) {
    const out: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: rows, error } = await admin.from(def.key).select('*').eq('user_id', uid).is('deleted_at', null).order('seq').range(from, from + 999);
      if (error) throw error;
      out.push(...rows.map((r: Record<string, unknown>) => fromDb(def, r)));
      if (rows.length < 1000) break;
    }
    data[def.key] = out;
  }
  return data;
}

// ---------- Taux de change réel MAD -> EUR (une fois par jour) ----------
async function fetchRate(): Promise<{ rate: number; source: string } | null> {
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/MAD', { signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    if (j.result === 'success' && j.rates && j.rates.EUR > 0) return { rate: j.rates.EUR, source: 'open.er-api.com' };
  } catch (e) { console.error('fx er-api', e); }
  try {
    const r = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/mad.json', { signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    if (j.mad && j.mad.eur > 0) return { rate: j.mad.eur, source: 'fawazahmed0/currency-api' };
  } catch (e) { console.error('fx fawazahmed0', e); }
  return null;
}
async function ensureFx(today: string) {
  const { data } = await admin.from('fx_rates').select('date').eq('pair', 'MAD/EUR').eq('date', today).limit(1);
  if (data && data.length) return null;
  const fx = await fetchRate();
  if (!fx || fx.rate < 0.05 || fx.rate > 0.2) return { error: 'taux indisponible ou aberrant', fx };   // garde-fou
  const { data: n, error } = await admin.rpc('ck_fx_store', { p_date: today, p_rate: fx.rate, p_source: fx.source });
  return error ? { error: error.message } : { ...fx, comptes_mis_a_jour: n };
}

// Taux du jour pour les autres devises (USD, GBP, CHF) : « x/EUR » = valeur d'1 unité en euros
async function ensureFxOthers(today: string) {
  const pairs = ['USD', 'GBP', 'CHF'];
  const { data } = await admin.from('fx_rates').select('pair').eq('date', today).in('pair', pairs.map((c) => `${c}/EUR`));
  const missing = pairs.filter((c) => !(data || []).some((d: any) => d.pair === `${c}/EUR`));
  if (!missing.length) return null;
  try {
    const j = await (await fetch('https://open.er-api.com/v6/latest/EUR', { signal: AbortSignal.timeout(10000) })).json();
    const rows = missing.map((c) => (j.rates && j.rates[c] > 0 ? { date: today, pair: `${c}/EUR`, rate: 1 / j.rates[c], source: 'open.er-api.com' } : null)).filter(Boolean);
    if (rows.length) await admin.from('fx_rates').upsert(rows);
    return { autres_devises: rows.length };
  } catch (e) { console.error('fx autres', e); return { error: (e as Error).message }; }
}

type Note = { key: string; title: string; body: string; url: string; tag?: string };

async function compute(uid: string, now: ReturnType<typeof paris>, forceHour?: number) {
  const data = await loadData(uid);
  const ctx: any = { data, today: now.date, immoView: 'mine', ...core.buildIndex(data) };
  const { data: fxRows } = await admin.from('fx_rates').select('pair,rate').in('pair', ['USD/EUR', 'GBP/EUR', 'CHF/EUR']).order('date', { ascending: false }).limit(30);
  ctx.fx = {}; for (const r of fxRows || []) { const c = String(r.pair).split('/')[0]; if (!ctx.fx[c]) ctx.fx[c] = Number(r.rate); }
  const P = ctx.P, hour = forceHour ?? now.hour, today = now.date, month = today.slice(0, 7), day = +today.slice(8, 10);
  const week = isoWeek(today);
  const alerts = core.computeAlerts(ctx);
  const byId = (id: string) => alerts.find((a: any) => a.id === id);
  const notes: Note[] = [];
  const morning = hour === Math.round(P.notifNum('heure', 8));

  if (morning) {
    if (P.notif('factures')) {
      const late = byId('factures_retard');
      if (late) notes.push({ key: `factures_retard:${week}`, title: late.title, body: `${late.sub}. Pense à relancer.`, url: '/#/entreprise', tag: 'factures' });
      const toSend = data.invoices.filter((i: any) => i.statut === 'Planifiée' && i.periode < month);
      if (toSend.length) notes.push({ key: `factures_envoyer:${week}`, title: `${toSend.length} facture${toSend.length > 1 ? 's' : ''} à envoyer`, body: toSend.slice(0, 3).map((i: any) => `${i.client} — ${monthLabel(i.periode)}`).join(' · '), url: '/#/entreprise', tag: 'factures-envoi' });
    }
    if (P.notif('loyers')) {
      const lateDay = Math.round(P.notifNum('loyer_jour', 5));
      const late = byId('loyers_retard');
      const cur = day >= lateDay ? ctx.lots.map((l: any) => ({ l, c: core.rentCell(ctx, l.nom, month) })).filter((x: any) => x.c.status === 'due' || x.c.status === 'part') : [];
      if (late || cur.length) {
        const n = (late ? Number(late.title.split(' ')[0]) : 0) + cur.length;
        const amt = cur.reduce((s: number, x: any) => s + x.c.expected - x.c.paid, 0);
        const who = [...cur.map((x: any) => x.c.tenant ? x.c.tenant.nom : x.l.nom), ...(late && late.detail ? [late.detail] : [])].join(', ');
        notes.push({ key: day === lateDay ? `loyers_retard:${month}:j${lateDay}` : `loyers_retard:${week}`, title: `${n} loyer${n > 1 ? 's' : ''} en retard`, body: `${late ? late.sub + '. ' : ''}${cur.length ? `Ce mois-ci : ${mad(amt)} non reçus. ` : ''}${who}`.slice(0, 230), url: '/#/immo', tag: 'loyers' });
      }
      if (day === 1) { const due = byId('loyers_mois'); if (due) notes.push({ key: `loyers_mois:${month}`, title: due.title, body: due.sub, url: '/#/immo', tag: 'loyers-mois' }); }
    }
    if (P.notif('recurrents') && day <= 3) {
      const miss = core.missingRecurring(ctx, month);
      if (miss.length) notes.push({ key: `recurrents:${month}`, title: `${miss.length} opération${miss.length > 1 ? 's' : ''} récurrente${miss.length > 1 ? 's' : ''} à générer`, body: `${miss.slice(0, 4).map((r: any) => r.libelle).join(', ')} — pour ${monthLong(month)}`, url: '/#/recurring', tag: 'recurrents' });
    }
    if (P.notif('releve') && today === core.lastBusinessDay(month)) {
      notes.push({ key: `releve:${month}`, title: 'Relevé de soldes de fin de mois', body: 'Note les soldes de tes comptes pour suivre ton patrimoine (1 minute).', url: '/#/wealth', tag: 'releve' });
    }
    if (P.notif('echeances')) {
      for (const r of data.rappels as any[]) {
        if (r.actif === 'Non') continue;
        const next = core.nextOccurrence(r, today);
        if (!next) continue;
        const inDays = daysBetween(today, next);
        if (inDays === 0) notes.push({ key: `rappel:${r.id}:${next}:J`, title: `Aujourd’hui : ${r.titre}`, body: r.note || 'Échéance du jour.', url: '/#/recurring', tag: 'rappel-' + r.id });
        else if (r.avance > 0 && inDays === r.avance) notes.push({ key: `rappel:${r.id}:${next}:avant`, title: `Dans ${inDays} jours : ${r.titre}`, body: `Échéance le ${next.split('-').reverse().join('/')}. ${r.note || ''}`.trim(), url: '/#/recurring', tag: 'rappel-' + r.id });
      }
    }
    if (P.notif('elec')) {
      // facture d'électricité : du 1er au 3 de chaque mois, une notification par jour jusqu'à ce que le paiement soit saisi
      const el = core.elecDue(ctx);
      if (el.due) notes.push({ key: `elec:${today}`, title: 'Facture d’électricité à payer', body: `Du ${el.from} au ${el.to} du mois : règle la facture de l’immeuble, puis saisis la dépense (Eau & électricité) pour arrêter le rappel.`, url: '/#/ops?new=1', tag: 'elec' });
    }
    if (P.notif('imports') && now.weekday === 'Mon') {
      const n = (data.import_lignes as any[] || []).filter((l: any) => l.statut === 'attente').length;
      if (n) notes.push({ key: `imports:${week}`, title: `${n} opération${n > 1 ? 's' : ''} à valider`, body: 'Importées depuis ton relevé bancaire : valide-les pour les intégrer à tes calculs.', url: '/#/imports', tag: 'imports' });
    }
    // plafonds / TVA des entreprises (une alerte par entreprise) : une notification par mois
    for (const a of alerts.filter((x: any) => /^seuil_/.test(x.id))) notes.push({ key: `${a.id}:${month}`, title: a.title, body: a.sub, url: '/#/entreprise', tag: 'seuils' });
    // déclarations et paiements des entreprises : à J-7, J-1 et le jour J (une seule fois chacun)
    if (P.notif('declarations')) {
      for (const d of ent.upcomingDeadlines(ctx, today, 7)) {
        if (![7, 1, 0].includes(d.inDays) && !(d.late && d.inDays === -1)) continue;
        notes.push({ key: `decl:${d.projetId}:${d.code}:${d.periode}:${d.late ? 'retard' : 'J' + d.inDays}`, title: `${d.late ? 'En retard : ' : d.inDays === 0 ? 'Aujourd’hui : ' : `Dans ${d.inDays} j : `}${d.label}`, body: `${d.nom} — échéance le ${d.date.split('-').reverse().join('/')}. Marque-la « fait » ou « payé » dans Entreprise pour arrêter les rappels.`, url: '/#/entreprise', tag: 'decl-' + d.code });
      }
    }
    if (P.notif('provision')) {
      const since = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
      for (const t of data.tx as any[]) {
        if (!/^FAC[0-9a-f-]+$/.test(t.ref) || t.date < since) continue;
        notes.push({ key: `provision:${t.ref}`, title: 'Facture payée : mets de côté', body: `${t.libelle} : mets ${eur(t.montantEur * P.provision)} de côté (${Math.round(P.provision * 100)} % pour cotisations et impôt).`, url: '/#/entreprise', tag: 'provision' });
      }
    }
  }

  if (hour === 17 && P.notif('jours') && today === core.lastBusinessDay(month)) {
    const inv = data.invoices.filter((i: any) => i.periode === month && i.statut === 'Planifiée');
    const who = inv.length ? [...new Set(inv.map((i: any) => i.client))].join(', ') : 'tes clients';
    notes.push({ key: `jours:${month}`, title: `Jours travaillés en ${monthLong(month).split(' ')[0]} ?`, body: `Renseigne le nombre de jours pour ${who} et prépare la facture.`, url: `/#/entreprise?jours=${month}`, tag: 'jours' });
  }

  if (hour === 20 && P.notif('saisie')) {
    const n = Math.max(1, Math.round(P.notifNum('saisie_jours', 3)));
    const { data: last } = await admin.from('tx').select('created_at').eq('user_id', uid).is('deleted_at', null).order('created_at', { ascending: false }).limit(1);
    const lastAt = last && last[0] ? last[0].created_at.slice(0, 10) : null;
    if (!lastAt || daysBetween(lastAt, today) >= n) {
      notes.push({ key: `saisie:${today}`, title: 'Pense à saisir tes dépenses', body: lastAt ? `Rien de saisi depuis ${daysBetween(lastAt, today)} jours. 30 secondes avec le bouton +.` : 'Ajoute tes premières opérations avec le bouton +.', url: '/#/ops?new=1', tag: 'saisie' });
    }
  }
  const badge = alerts.filter((a: any) => a.kind === 'bad' || a.kind === 'warn').length;
  return { notes, badge };
}

async function sendTo(uid: string, payload: Record<string, unknown>) {
  const { data: subs } = await admin.from('push_subscriptions').select('*').eq('user_id', uid);
  let sent = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 86400, urgency: 'normal' });
      sent++;
      await admin.from('push_subscriptions').update({ last_ok_at: new Date().toISOString(), fail_count: 0 }).eq('id', s.id);
    } catch (e: any) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) await admin.from('push_subscriptions').delete().eq('id', s.id);
      else await admin.from('push_subscriptions').update({ fail_count: (s.fail_count || 0) + 1 }).eq('id', s.id);
      console.error('push', s.label, e && (e.statusCode || e.message));
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const body = await req.json().catch(() => ({}));

  // --- appel planifié ---
  if (CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET) {
    const now = paris();
    const fx = await ensureFx(now.date).catch((e) => ({ error: e.message }));
    const fx2 = await ensureFxOthers(now.date).catch((e) => ({ error: e.message }));
    const { data: users } = await admin.from('push_subscriptions').select('user_id');
    const ids = [...new Set((users || []).map((u: any) => u.user_id))];
    const report: unknown[] = [];
    for (const uid of ids) {
      try {
        const { notes, badge } = await compute(uid, now, body.force_hour);
        let n = 0;
        for (const note of notes) {
          const { error } = await admin.from('notif_log').insert({ user_id: uid, key: note.key, title: note.title, body: note.body });
          if (error) continue;   // déjà envoyée (clé unique)
          n += await sendTo(uid, { title: note.title, body: note.body, url: note.url, tag: note.tag, badge });
        }
        report.push({ notes: notes.length, sent: n });
      } catch (e: any) { console.error(e); report.push({ error: e.message }); }
    }
    return json({ ok: true, at: now, fx, fx2, report });
  }

  // --- test depuis l'application ---
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'non autorisé' }, 401);
  const { data: u, error } = await admin.auth.getUser(jwt);
  if (error || !u.user) return json({ error: 'session invalide' }, 401);
  let aal = '';
  try { aal = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal; } catch { /* ignore */ }
  if (aal !== 'aal2') return json({ error: 'MFA requise' }, 403);
  if (body.test) {
    const sent = await sendTo(u.user.id, { title: 'Cockpit ✓', body: 'Les notifications fonctionnent sur cet appareil.', url: '/#/settings', tag: 'test' });
    return json({ ok: true, sent });
  }
  if (body.preview) {
    const { notes } = await compute(u.user.id, paris(), body.force_hour);
    return json({ ok: true, notes });
  }
  return json({ error: 'requête inconnue' }, 400);
});
