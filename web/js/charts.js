import { h, sv, clear, compact, eur, monthShort, num0 } from './util.js';

// ---------- Tooltip ----------
let tip;
function tipEl() { if (!tip) { tip = h('div', { class: 'tip' }); document.body.append(tip); } return tip; }
export function showTip(e, html) {
  const t = tipEl(); t.innerHTML = html; t.classList.add('on');
  const w = t.offsetWidth, hh = t.offsetHeight;
  let x = e.clientX + 16, y = e.clientY - hh / 2;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - 16;
  y = Math.max(8, Math.min(y, window.innerHeight - hh - 8));
  t.style.left = x + 'px'; t.style.top = y + 'px';
}
export function hideTip() { tip && tip.classList.remove('on'); }

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
function roundedTop(x, y, w, hgt, r) {
  r = Math.min(r, w / 2, hgt);
  if (hgt <= 0) return '';
  return `M${x},${y + hgt} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + hgt} Z`;
}
function observe(el, draw) {
  let last = 0;
  const run = () => { const w = Math.floor(el.clientWidth); if (w > 40 && w !== last) { last = w; draw(w); } };
  const ro = new ResizeObserver(run); ro.observe(el);
  requestAnimationFrame(run);
}

// ---------- Barres groupées Revenus / Dépenses ----------
export function barChart({ points, mode, height = 250 }) {
  const el = h('div', { class: 'chart' });
  const draw = (W) => {
    clear(el);
    const m = { l: 46, r: 6, t: 10, b: 36 }, H = height;
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const max = niceMax(Math.max(1, ...points.map((p) => Math.max(p.rev, p.dep))));
    const y = (v) => m.t + ph - (v / max) * ph;
    const svg = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Revenus et dépenses par période' });
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i, yy = y(v);
      svg.append(sv('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy, style: `stroke:var(${i === 0 ? '--line' : '--line-2'})`, 'stroke-width': 1 }));
      svg.append(sv('text', { x: m.l - 8, y: yy + 4, 'text-anchor': 'end', style: 'fill:var(--ink-3)', 'font-size': 11.5 }, compact(v)));
    }
    const n = points.length, slot = pw / n, gw = Math.min(slot * 0.66, 64), bw = (gw - 2) / 2;
    const band = sv('rect', { y: m.t, height: ph, width: slot, rx: 6, style: 'fill:var(--hover)', opacity: 0 });
    svg.append(band);
    const every = Math.ceil(n / Math.max(1, Math.floor(pw / 46)));
    points.forEach((p, i) => {
      const cx = m.l + slot * i + slot / 2, x0 = cx - gw / 2;
      const hr = (p.rev / max) * ph, hd = (p.dep / max) * ph;
      if (p.rev > 0) svg.append(sv('path', { d: roundedTop(x0, m.t + ph - hr, bw, hr, 4), style: 'fill:var(--flow-in)' }));
      if (p.dep > 0) svg.append(sv('path', { d: roundedTop(x0 + bw + 2, m.t + ph - hd, bw, hd, 4), style: 'fill:var(--flow-out)' }));
      if (i % every === 0) {
        const lab = mode === 'm' ? monthShort(p.key) : p.key;
        svg.append(sv('text', { x: cx, y: H - m.b + 17, 'text-anchor': 'middle', style: 'fill:var(--ink-3)', 'font-size': 11.5 }, lab));
        if (mode === 'm' && (i === 0 || p.key.endsWith('-01')))
          svg.append(sv('text', { x: cx, y: H - m.b + 31, 'text-anchor': 'middle', style: 'fill:var(--ink-3)', 'font-size': 10.5, 'font-weight': 700 }, p.key.slice(0, 4)));
      }
      const hit = sv('rect', { x: m.l + slot * i, y: m.t, width: slot, height: ph + 20, fill: 'transparent' });
      hit.addEventListener('mousemove', (e) => {
        band.setAttribute('x', m.l + slot * i); band.setAttribute('opacity', 1);
        const lab = mode === 'm' ? `${monthShort(p.key)} ${p.key.slice(0, 4)}` : p.key;
        showTip(e, `<div class="th">${lab}</div>
          <div class="tr"><span><i style="background:var(--flow-in)"></i>Revenus</span><b class="num">${eur(p.rev)}</b></div>
          <div class="tr"><span><i style="background:var(--flow-out)"></i>Dépenses</span><b class="num">${eur(p.dep)}</b></div>
          <div class="tr" style="border-top:1px solid var(--line);margin-top:4px;padding-top:4px"><span>Résultat</span><b class="num ${p.res >= 0 ? 'pos' : 'neg'}">${p.res >= 0 ? '+' : ''}${eur(p.res)}</b></div>`);
      });
      hit.addEventListener('mouseleave', () => { band.setAttribute('opacity', 0); hideTip(); });
      svg.append(hit);
    });
    el.append(svg);
  };
  observe(el, draw);
  return el;
}

// ---------- Courbe (patrimoine) ----------
export function lineChart({ points, height = 240, fmt = eur }) {
  const el = h('div', { class: 'chart' });
  const draw = (W) => {
    clear(el);
    const m = { l: 56, r: 16, t: 14, b: 30 }, H = height, pw = W - m.l - m.r, ph = H - m.t - m.b;
    const t0 = points[0].t, t1 = points[points.length - 1].t, span = Math.max(1, t1 - t0);
    const lo = Math.min(...points.map((p) => p.y)), hi = Math.max(...points.map((p) => p.y));
    const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.1 || 1;
    const a = Math.max(0, lo - pad), b = hi + pad;
    const X = (t) => m.l + (points.length === 1 ? pw / 2 : ((t - t0) / span) * pw);
    const Y = (v) => m.t + ph - ((v - a) / (b - a)) * ph;
    const svg = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Évolution du patrimoine' });
    for (let i = 0; i <= 4; i++) {
      const v = a + ((b - a) / 4) * i, yy = Y(v);
      svg.append(sv('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy, style: `stroke:var(${i === 0 ? '--line' : '--line-2'})` }));
      svg.append(sv('text', { x: m.l - 8, y: yy + 4, 'text-anchor': 'end', style: 'fill:var(--ink-3)', 'font-size': 11.5 }, compact(v)));
    }
    if (points.length > 1) {
      const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.t)},${Y(p.y)}`).join(' ');
      svg.append(sv('path', { d: `${d} L${X(t1)},${m.t + ph} L${X(t0)},${m.t + ph} Z`, style: 'fill:var(--flow-in)', opacity: 0.08 }));
      svg.append(sv('path', { d, fill: 'none', style: 'stroke:var(--flow-in)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    }
    const every = Math.ceil(points.length / Math.max(1, Math.floor(pw / 70)));
    const cross = sv('line', { y1: m.t, y2: m.t + ph, style: 'stroke:var(--ink-3)', 'stroke-dasharray': '3 3', opacity: 0 });
    svg.append(cross);
    points.forEach((p, i) => {
      if (i % every === 0 || i === points.length - 1)
        svg.append(sv('text', { x: X(p.t), y: H - 8, 'text-anchor': 'middle', style: 'fill:var(--ink-3)', 'font-size': 11.5 }, p.label));
      const c = sv('circle', { cx: X(p.t), cy: Y(p.y), r: 4.5, style: 'fill:var(--flow-in);stroke:var(--surface)', 'stroke-width': 2 });
      svg.append(c);
      const hit = sv('circle', { cx: X(p.t), cy: Y(p.y), r: 16, fill: 'transparent' });
      hit.addEventListener('mousemove', (e) => {
        cross.setAttribute('x1', X(p.t)); cross.setAttribute('x2', X(p.t)); cross.setAttribute('opacity', 1);
        showTip(e, `<div class="th">${p.full || p.label}</div><div class="tr"><span>Patrimoine</span><b class="num">${fmt(p.y)}</b></div>`);
      });
      hit.addEventListener('mouseleave', () => { cross.setAttribute('opacity', 0); hideTip(); });
      svg.append(hit);
    });
    el.append(svg);
  };
  observe(el, draw);
  return el;
}

// ---------- Sparkline ----------
export function spark(values, { w = 84, hgt = 30, color = 'var(--flow-in)' } = {}) {
  const svg = sv('svg', { width: w, height: hgt, viewBox: `0 0 ${w} ${hgt}`, class: 'spark', 'aria-hidden': 'true' });
  if (values.length < 2) return svg;
  const lo = Math.min(...values), hi = Math.max(...values), r = hi - lo || 1;
  const X = (i) => 3 + (i / (values.length - 1)) * (w - 6), Y = (v) => hgt - 4 - ((v - lo) / r) * (hgt - 8);
  svg.append(sv('path', { d: values.map((v, i) => `${i ? 'L' : 'M'}${X(i)},${Y(v)}`).join(' '), fill: 'none', style: `stroke:${color}`, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  const li = values.length - 1;
  svg.append(sv('circle', { cx: X(li), cy: Y(values[li]), r: 3, style: `fill:${color}` }));
  return svg;
}

// ---------- Liste de barres horizontales (HTML) ----------
export function barList(items, { fmt = eur, color, total } = {}) {
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  return h('div', { class: 'bl' }, items.map((it) =>
    h('div', { class: 'it', title: `${it.label} : ${fmt(it.value)}` },
      h('div', { class: 'lb' }, it.dot ? h('i', { class: 'adot ' + it.dot, style: { margin: 0 } }) : null, it.icon ? h('span', { style: { flex: 'none' } }, it.icon) : null, h('span', null, it.label)),
      h('div', { class: 'tr' }, h('div', { class: 'fl', style: { width: Math.max(0, (Math.abs(it.value) / max) * 100) + '%', background: it.color || color || null } })),
      h('div', { class: 'vl num' }, fmt(it.value), total ? h('span', { class: 'muted', style: { fontWeight: 500, marginLeft: '6px', fontSize: '12px' } }, Math.round((it.value / total) * 100) + '%') : null))));
}
export { num0 };
