// Client Supabase unique (clé publique uniquement : les données sont protégées par RLS + MFA côté serveur)
import { CONFIG } from '../config.js';

export const sb = window.supabase.createClient(CONFIG.url, CONFIG.key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'cockpit-auth', flowType: 'pkce' },
  realtime: { params: { eventsPerSecond: 5 } },
});

export function deviceLabel() {
  const ua = navigator.userAgent;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const kind = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Web';
  return `${kind}${standalone ? ' (app)' : ' (navigateur)'}`;
}

export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
