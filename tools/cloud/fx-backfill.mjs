#!/usr/bin/env node
// Remplit l'historique des taux « devise -> EUR » jour par jour (source : fawazahmed0/currency-api, disponible depuis le 2024-03-02).
//   node tools/cloud/fx-backfill.mjs [AAAA-MM-JJ début] [MAD,USD,GBP,CHF]
import { loadEnv, sql } from './lib.mjs';
const env = loadEnv();
const start = process.argv[2] && /^\d{4}-/.test(process.argv[2]) ? process.argv[2] : '2024-03-02';
const curs = (process.argv.find((a) => /^[A-Z]{3}(,[A-Z]{3})*$/.test(a)) || 'MAD,USD,GBP,CHF').split(',');
const RANGE = { MAD: [0.05, 0.2], USD: [0.5, 1.5], GBP: [0.8, 1.6], CHF: [0.7, 1.4] };
for (const cur of curs) {
  const pair = `${cur}/EUR`, low = cur.toLowerCase();
  const have = new Set((await sql(env, `select date::text d from public.fx_rates where pair = '${pair}'`)).map((r) => r.d));
  const days = [];
  for (let d = new Date(start + 'T12:00:00Z'); d < new Date(); d.setUTCDate(d.getUTCDate() + 1)) { const k = d.toISOString().slice(0, 10); if (!have.has(k)) days.push(k); }
  console.log(`${pair} : ${days.length} jours à récupérer`);
  const rows = [];
  for (let i = 0; i < days.length; i += 20) {
    const batch = await Promise.all(days.slice(i, i + 20).map(async (k) => {
      for (const url of [`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${k}/v1/currencies/${low}.json`, `https://${k}.currency-api.pages.dev/v1/currencies/${low}.json`]) {
        try { const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); if (!r.ok) continue; const j = await r.json(); const v = j[low] && j[low].eur; if (v > RANGE[cur][0] && v < RANGE[cur][1]) return [k, v]; } catch { /* source suivante */ }
      }
      return null;
    }));
    rows.push(...batch.filter(Boolean));
    process.stdout.write(`\r${Math.min(i + 20, days.length)}/${days.length}`);
  }
  console.log(`\n${rows.length} taux récupérés`);
  for (let i = 0; i < rows.length; i += 300) {
    const values = rows.slice(i, i + 300).map(([d, r]) => `('${d}', '${pair}', ${Number(r)}, 'fawazahmed0/currency-api (historique)')`).join(',');
    await sql(env, `insert into public.fx_rates (date, pair, rate, source) values ${values} on conflict (pair, date) do nothing`);
  }
}
const s = await sql(env, "select pair, count(*)::int n, min(date)::text d0, max(date)::text d1, round(min(rate), 5) mn, round(max(rate), 5) mx from public.fx_rates group by pair order by pair");
for (const r of s) console.log(`${r.pair} : ${r.n} jours du ${r.d0} au ${r.d1} (entre ${r.mn} et ${r.mx})`);
