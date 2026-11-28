import { h, icon, clear, append } from './util.js';

// ---------- Toasts ----------
let toastBox;
export function toast(msg, kind = 'ok', ms = 3200) {
  if (!toastBox) { toastBox = h('div', { class: 'toasts' }); document.body.append(toastBox); }
  const t = h('div', { class: 'toast ' + kind }, icon(kind === 'error' ? 'alert' : 'check', 17), h('span', null, msg));
  toastBox.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? Math.max(ms, 6500) : ms);
}

// ---------- Modal ----------
const stack = [];
export function modal({ title, width, body, footer, onClose, sub }) {
  const m = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', style: width ? { maxWidth: width + 'px' } : null });
  const close = () => {
    const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
    ov.remove(); onClose && onClose();
  };
  const head = h('header', null, h('div', null, h('h2', null, title), sub ? h('div', { class: 'muted', style: { fontSize: '12.5px', marginTop: '2px' } }, sub) : null),
    h('button', { class: 'btn ghost icon x', onClick: close, 'aria-label': 'Fermer', type: 'button' }, icon('x')));
  const bodyEl = h('div', { class: 'body' }, body);
  const foot = footer ? h('footer', null, footer) : null;
  append(m, [head, bodyEl, foot]);
  const ov = h('div', { class: 'overlay', onMousedown: (e) => { if (e.target === ov) close(); } }, m);
  document.body.append(ov);
  const api = { el: m, close, bodyEl, footEl: foot };
  stack.push(api);
  setTimeout(() => { const f = m.querySelector('[autofocus]') || m.querySelector('input,select,button.primary'); f && f.focus(); }, 30);
  return api;
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const pop = document.querySelector('.pop'); if (pop) { pop.remove(); return; }
    if (stack.length) stack[stack.length - 1].close();
  }
});

export function confirmBox(message, { ok = 'Confirmer', danger = false, title = 'Confirmation' } = {}) {
  return new Promise((res) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; res(v); } };
    const m = modal({ title, width: 440, body: h('p', { class: 'sec' }, message), onClose: () => fin(false),
      footer: [h('span', { class: 'sp' }),
        h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onClick: () => { fin(true); m.close(); } }, ok)] });
  });
}

// Confirmation « forte » : il faut recopier un texte (ex. le nom du projet) pour pouvoir confirmer
export function confirmTyped(message, expected, { ok = 'Supprimer définitivement', title = 'Confirmation' } = {}) {
  return new Promise((res) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; res(v); } };
    const input = h('input', { type: 'text', placeholder: expected, autocomplete: 'off', 'aria-label': 'Recopie le texte pour confirmer' });
    const go = h('button', { class: 'btn danger', disabled: true, onClick: () => { fin(true); m.close(); } }, ok);
    const same = () => input.value.trim().toLowerCase() === String(expected).trim().toLowerCase();
    input.addEventListener('input', () => { go.disabled = !same(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && same()) { fin(true); m.close(); } });
    const m = modal({ title, width: 470, onClose: () => fin(false),
      body: [h('div', { class: 'infobox', style: { background: 'var(--crit-bg)', color: 'var(--crit-ink)' } }, message), h('div', { class: 'field' }, h('label', null, `Pour confirmer, recopie : ${expected}`), input)],
      footer: [h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Annuler'), go] });
    setTimeout(() => input.focus(), 60);
  });
}

// ---------- Popover ----------
export function popover(anchor, content, { align = 'left' } = {}) {
  document.querySelectorAll('.pop').forEach((p) => p.remove());
  const p = h('div', { class: 'pop' }, content);
  document.body.append(p);
  const r = anchor.getBoundingClientRect();
  const pw = p.offsetWidth;
  let left = align === 'right' ? r.right - pw : r.left;
  left = Math.max(10, Math.min(left, window.innerWidth - pw - 10));
  p.style.left = left + 'px'; p.style.top = (r.bottom + 8) + 'px';
  const off = (e) => { if (!p.contains(e.target) && !anchor.contains(e.target)) { p.remove(); document.removeEventListener('mousedown', off, true); } };
  setTimeout(() => document.addEventListener('mousedown', off, true), 0);
  p.close = () => { p.remove(); document.removeEventListener('mousedown', off, true); };
  return p;
}

// ---------- Contrôles ----------
export function segmented(items, value, onChange, cls = '') {
  const el = h('div', { class: 'seg ' + cls, role: 'tablist' });
  const draw = (v) => {
    clear(el);
    for (const it of items) {
      el.append(h('button', { type: 'button', class: it.value === v ? 'on' : '', onClick: () => { draw(it.value); onChange(it.value); } },
        it.dot ? h('span', { class: 'dotc ' + it.dot }) : null, it.label));
    }
  };
  draw(value);
  el.set = draw;
  return el;
}
export function field(label, control, hint) {
  return h('div', { class: 'field' }, label ? h('label', null, label) : null, control, hint ? h('div', { class: 'hint' }, hint) : null);
}
export function select(options, value, props = {}) {
  const s = h('select', props, options.map((o) => {
    const v = typeof o === 'object' ? o.value : o, l = typeof o === 'object' ? o.label : o;
    return h('option', { value: v, selected: v === value }, l);
  }));
  s.value = value ?? (options[0] && (typeof options[0] === 'object' ? options[0].value : options[0]));
  return s;
}
export function toggle(on, onChange) {
  const b = h('button', { type: 'button', class: 'toggle' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(!!on) });
  b.addEventListener('click', () => { const v = !b.classList.contains('on'); b.classList.toggle('on', v); b.setAttribute('aria-checked', String(v)); onChange(v); });
  return b;
}
export function empty(title, text, action) {
  return h('div', { class: 'empty' }, h('b', null, title), text, action ? h('div', { style: { marginTop: '12px' } }, action) : null);
}
export function pill(kind, text, ic) { return h('span', { class: 'pill ' + kind }, ic ? icon(ic, 13) : null, text); }
