// Connexion : e-mail + mot de passe, puis code de sécurité (MFA TOTP) obligatoire.
// Tant que la session n'est pas au niveau « aal2 », la base ne renvoie aucune donnée (RLS restrictive).
import { h, clear, icon } from './util.js';
import { sb, isIOS } from './supa.js';
import { CONFIG } from '../config.js';
import { toast } from './ui.js';
import { LANGS, setLang, getLang } from './i18n.js';

const app = () => document.getElementById('app');

function screen(title, sub, body) {
  const root = app(); clear(root);
  root.append(h('div', { class: 'auth' }, h('div', { class: 'auth-card card' },
    h('div', { class: 'brand' }, h('div', { class: 'logo' }, icon('chart', 17)), 'Cockpit', langPick()),
    h('h1', null, title), sub ? h('p', { class: 'sec' }, sub) : null, body)));
}
function langPick() {
  const s = h('select', { class: 'prefsel', style: { marginInlineStart: 'auto' }, 'aria-label': 'Langue' }, LANGS.map((l) => h('option', { value: l.value, selected: l.value === getLang() }, l.label)));
  s.addEventListener('change', () => { try { const p = JSON.parse(localStorage.getItem('cockpit.prefs.v1') || '{}'); p.lang = s.value; localStorage.setItem('cockpit.prefs.v1', JSON.stringify(p)); } catch { /* */ } setLang(s.value); location.reload(); });
  return s;
}
const errEl = () => h('div', { class: 'err', role: 'alert' });
const fr = (e) => {
  const m = (e && (e.message || e.error_description)) || String(e);
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou mot de passe incorrect.';
  if (/Invalid TOTP code|invalid.*code|expired/i.test(m)) return 'Code incorrect ou expiré : réessaie avec le code affiché maintenant.';
  if (/Signups not allowed/i.test(m)) return 'La création de compte est désactivée.';
  if (/Password should be at least/i.test(m)) return 'Mot de passe trop court (12 caractères minimum).';
  if (/rate limit/i.test(m)) return 'Trop de tentatives : patiente quelques minutes.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Pas de connexion Internet.';
  if (/already registered/i.test(m)) return 'Un compte existe déjà avec cet e-mail : connecte-toi.';
  return m;
};

// Résout quand la session est au niveau aal2.
export async function ensureAuth({ offlineOk = false } = {}) {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    const lvl = await aal();
    if (lvl.currentLevel === 'aal2') return session.user;
    if (!navigator.onLine && offlineOk) return session.user;
    return await mfaStep(session.user, lvl);
  }
  return await loginStep();
}

async function aal() {
  const { data, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  return data;
}

function loginStep(mode = 'login') {
  return new Promise((resolve) => {
    const email = h('input', { type: 'email', autocomplete: 'username', placeholder: 'ton@email.fr', required: true });
    const pass = h('input', { type: 'password', autocomplete: mode === 'signup' ? 'new-password' : 'current-password', placeholder: mode === 'signup' ? '12 caractères minimum' : 'Mot de passe', required: true });
    const pass2 = mode === 'signup' ? h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Confirme le mot de passe' }) : null;
    const err = errEl();
    const btn = h('button', { class: 'btn primary lg', type: 'submit', style: { justifyContent: 'center' } }, mode === 'signup' ? 'Créer mon compte' : 'Se connecter');
    const form = h('form', { class: 'auth-form', onSubmit: async (e) => {
      e.preventDefault(); err.textContent = ''; btn.disabled = true;
      try {
        if (mode === 'signup') {
          if (pass.value.length < 12) throw new Error('Mot de passe trop court (12 caractères minimum).');
          if (pass.value !== pass2.value) throw new Error('Les deux mots de passe ne correspondent pas.');
          const { data, error } = await sb.auth.signUp({ email: email.value.trim(), password: pass.value });
          if (error) throw error;
          if (!data.session) { err.textContent = 'Compte créé : confirme ton adresse via l’e-mail reçu, puis connecte-toi.'; btn.disabled = false; return; }
          resolve(await mfaStep(data.user, await aal()));
        } else {
          const { data, error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
          if (error) throw error;
          resolve(await mfaStep(data.user, await aal()));
        }
      } catch (ex) { err.textContent = fr(ex); btn.disabled = false; }
    } },
      h('div', { class: 'field' }, h('label', null, 'E-mail'), email),
      h('div', { class: 'field' }, h('label', null, 'Mot de passe'), pass),
      pass2 ? h('div', { class: 'field' }, h('label', null, 'Confirmation'), pass2) : null,
      err, btn);
    const links = h('div', { class: 'auth-links' },
      mode === 'login' ? h('button', { class: 'btn ghost sm', type: 'button', onClick: () => forgot(email.value) }, 'Mot de passe oublié') : null,
      CONFIG.allowSignup ? h('button', { class: 'btn ghost sm', type: 'button', onClick: () => loginStep(mode === 'login' ? 'signup' : 'login').then(resolve) },
        mode === 'login' ? 'Pas encore de compte ? Créer un compte' : 'J’ai déjà un compte : me connecter') : null);
    screen(mode === 'signup' ? 'Créer ton compte' : 'Connexion', mode === 'signup' ? 'Ton espace est privé : personne d’autre (y compris les autres utilisateurs) ne peut voir tes données.' : 'Tes données financières sont protégées : mot de passe + code de sécurité.', [form, links]);
    setTimeout(() => email.focus(), 50);
  });
}

async function forgot(prefill) {
  const email = prompt('Adresse e-mail du compte :', prefill || '');
  if (!email) return;
  const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + '/' });
  toast(error ? fr(error) : 'Si ce compte existe, un e-mail de réinitialisation vient d’être envoyé.', error ? 'error' : 'ok');
}

// Après un lien « mot de passe oublié » : saisir le nouveau mot de passe
export function watchRecovery() {
  sb.auth.onAuthStateChange((event) => {
    if (event !== 'PASSWORD_RECOVERY') return;
    const p = h('input', { type: 'password', autocomplete: 'new-password', placeholder: '12 caractères minimum' });
    const err = errEl();
    screen('Nouveau mot de passe', null, h('form', { class: 'auth-form', onSubmit: async (e) => {
      e.preventDefault();
      if (p.value.length < 12) { err.textContent = 'Mot de passe trop court (12 caractères minimum).'; return; }
      const { error } = await sb.auth.updateUser({ password: p.value });
      if (error) { err.textContent = fr(error); return; }
      location.replace('/');
    } }, h('div', { class: 'field' }, h('label', null, 'Nouveau mot de passe'), p), err, h('button', { class: 'btn primary lg', type: 'submit' }, 'Enregistrer')));
  });
}

async function mfaStep(user, lvl) {
  if (lvl.currentLevel === 'aal2') return user;
  const { data, error } = await sb.auth.mfa.listFactors();
  if (error) throw error;
  const verified = (data.totp || []).filter((f) => f.status === 'verified');
  if (verified.length) return await challengeStep(user, verified);
  return await enrollStep(user, data.all || data.totp || []);
}

function codeInput() {
  return h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]*', maxlength: 6, placeholder: '123456', class: 'otp' });
}

function challengeStep(user, factors) {
  return new Promise((resolve) => {
    const code = codeInput();
    const err = errEl();
    const sel = factors.length > 1 ? h('select', null, factors.map((f) => h('option', { value: f.id }, f.friendly_name || 'Application'))) : null;
    const form = h('form', { class: 'auth-form', onSubmit: async (e) => {
      e.preventDefault(); err.textContent = '';
      try {
        const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: sel ? sel.value : factors[0].id, code: code.value.trim() });
        if (error) throw error;
        resolve(user);
      } catch (ex) { err.textContent = fr(ex); code.select(); }
    } }, sel ? h('div', { class: 'field' }, h('label', null, 'Appareil'), sel) : null,
      h('div', { class: 'field' }, h('label', null, 'Code de sécurité à 6 chiffres'), code), err,
      h('button', { class: 'btn primary lg', type: 'submit' }, 'Valider'));
    code.addEventListener('input', () => { if (code.value.trim().length === 6) form.requestSubmit(); });
    screen('Code de sécurité', 'Ouvre ton application d’authentification et saisis le code affiché pour Cockpit.', [form,
      h('div', { class: 'auth-links' }, h('button', { class: 'btn ghost sm', type: 'button', onClick: async () => { await sb.auth.signOut(); location.reload(); } }, 'Changer de compte'))]);
    setTimeout(() => code.focus(), 50);
  });
}

function enrollStep(user, existing) {
  return new Promise(async (resolve) => {
    // nettoie les inscriptions inachevées
    for (const f of existing) if (f.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
    const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Cockpit ' + new Date().toISOString().slice(0, 10), issuer: 'Cockpit' });
    if (error) { screen('Erreur', fr(error), h('button', { class: 'btn', onClick: () => location.reload() }, 'Réessayer')); return; }
    const code = codeInput();
    const err = errEl();
    const secret = data.totp.secret;
    const form = h('form', { class: 'auth-form', onSubmit: async (e) => {
      e.preventDefault(); err.textContent = '';
      try {
        const { error: e2 } = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code: code.value.trim() });
        if (e2) throw e2;
        toast('Code de sécurité activé. Pense à en ajouter un 2ᵉ (Paramètres › Compte) en secours.');
        resolve(user);
      } catch (ex) { err.textContent = fr(ex); code.select(); }
    } },
      h('ol', { class: 'steps' },
        h('li', null, 'Installe une application d’authentification si besoin : ', h('b', null, isIOS() ? 'Mots de passe (iPhone), Google Authenticator ou Microsoft Authenticator' : 'Microsoft Authenticator, Google Authenticator ou 1Password'), '.'),
        h('li', null, isIOS() ? 'Touche « Ajouter à l’app d’authentification », ou scanne le QR code depuis un autre appareil :' : 'Scanne ce QR code avec ton téléphone :'),
      ),
      isIOS() ? h('a', { class: 'btn', href: data.totp.uri, style: { justifyContent: 'center' } }, icon('key', 16), 'Ajouter à l’app d’authentification') : null,
      h('div', { class: 'qr' }, h('img', { src: data.totp.qr_code, alt: 'QR code MFA', width: 180, height: 180 })),
      h('div', { class: 'hint', style: { textAlign: 'center' } }, 'Ou saisis cette clé : ', h('code', { class: 'secret' }, secret.replace(/(.{4})/g, '$1 ').trim())),
      h('div', { class: 'field' }, h('label', null, '3. Saisis le code à 6 chiffres affiché'), code), err,
      h('button', { class: 'btn primary lg', type: 'submit' }, 'Activer'));
    code.addEventListener('input', () => { if (code.value.trim().length === 6) form.requestSubmit(); });
    screen('Active le code de sécurité', 'Obligatoire : même si ton mot de passe fuitait, personne ne pourrait accéder à tes données sans ton téléphone.', form);
  });
}

// ---------- gestion depuis les Paramètres ----------
export async function listFactors() {
  const { data, error } = await sb.auth.mfa.listFactors();
  if (error) throw error;
  return (data.totp || []).filter((f) => f.status === 'verified');
}
export async function addFactor() {
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Secours ' + new Date().toISOString().slice(0, 16).replace('T', ' '), issuer: 'Cockpit' });
  if (error) throw error;
  return data;
}
export async function verifyFactor(factorId, code) {
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) throw new Error(fr(error));
}
export async function removeFactor(factorId) {
  const { error } = await sb.auth.mfa.unenroll({ factorId });
  if (error) throw new Error(fr(error));
}
export async function changePassword(pw) {
  if (pw.length < 12) throw new Error('Mot de passe trop court (12 caractères minimum).');
  const { error } = await sb.auth.updateUser({ password: pw });
  if (error) throw new Error(fr(error));
}
export { fr as authError };

// Déconnexion (accessible depuis le menu latéral, le menu « Plus » et les Paramètres)
export async function logout() {
  const { confirmBox } = await import('./ui.js');
  const { flush } = await import('./state.js');
  if (!(await confirmBox('Se déconnecter de cet appareil ? La copie locale des données y sera effacée (elles restent en sécurité dans ton compte).', { ok: 'Se déconnecter', title: 'Déconnexion' }))) return;
  await flush().catch(() => {});
  await sb.auth.signOut();
}
