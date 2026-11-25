#!/usr/bin/env node
// Remplit l'historique des taux MAD -> EUR jour par jour (source : fawazahmed0/currency-api, disponible depuis le 2024-03-02)
//   node tools/cloud/fx-backfill.mjs [AAAA-MM-JJ début]
import { loadEnv, sql } from './lib.mjs';
const env = loadEnv();
const start = process.argv[2] || '2024-03-02';
const have = new Set((await sql(env, "select date::text d from public.fx_rates where pair = 'MAD/EUR'")).map((r) => r.d));
const days = [];
for (let d = new Date(start + 'T12:00:00Z'); d < new Date(); d.setUTCDate(d.getUTCDate() + 1)) { const k = d.toISOString().slice(0, 10); if (!have.has(k)) days.push(k); }
console.log(`${days.length} jours à récupérer`);
const rows = [];
for (let i = 0; i < days.length; i += 20) {
  const batch = await Promise.all(days.slice(i, i + 20).map(async (k) => {
    for (const url of [`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${k}/v1/currencies/mad.json`, `https://${k}.currency-api.pages.dev/v1/currencies/mad.json`]) {
      try { const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); if (!r.ok) continue; const j = await r.json(); if (j.mad && j.mad.eur > 0.05 && j.mad.eur < 0.2) return [k, j.mad.eur]; } catch { /* source suivante */ }
    }
    return null;
  }));
  rows.push(...batch.filter(Boolean));
  process.stdout.write(`\r${Math.min(i + 20, days.length)}/${days.length}`);
}
console.log(`\n${rows.length} taux récupérés`);
for (let i = 0; i < rows.length; i += 300) {
  const values = rows.slice(i, i + 300).map(([d, r]) => `('${d}', 'MAD/EUR', ${Number(r)}, 'fawazahmed0/currency-api (historique)')`).join(',');
  await sql(env, `insert into public.fx_rates (date, pair, rate, source) values ${values} on conflict (pair, date) do nothing`);
}
const [s] = await sql(env, "select count(*)::int n, min(date)::text d0, max(date)::text d1, round(min(rate), 5) mn, round(max(rate), 5) mx from public.fx_rates");
console.log(`Historique : ${s.n} jours du ${s.d0} au ${s.d1} (taux entre ${s.mn} et ${s.mx})`);
