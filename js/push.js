// Notifications Web Push (iPhone : uniquement depuis l'app ajoutée à l'écran d'accueil, iOS 16.4+)
import { sb, deviceLabel, isIOS, isStandalone } from './supa.js';
import { CONFIG } from '../config.js';

const b64ToBytes = (s) => {
  const p = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

export async function pushStatus() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) return { supported: false, needInstall: isIOS() && !isStandalone(), permission: 'default', subscribed: false };
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return { supported: true, needInstall: false, permission: Notification.permission, subscribed: !!sub && Notification.permission === 'granted' };
}

export async function enablePush() {
  const perm = await Notification.requestPermission();   // doit suivre un appui de l'utilisateur
  if (perm !== 'granted') throw new Error('Notifications refusées. Réactive-les dans les réglages de l’appareil (Notifications › Cockpit).');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(CONFIG.vapid) });
  const j = sub.toJSON();
  const { error } = await sb.from('push_subscriptions').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, label: deviceLabel(), fail_count: 0 }, { onConflict: 'endpoint' });
  if (error) throw error;
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  if (sub) {
    await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  }
}

export async function listDevices() {
  const { data, error } = await sb.from('push_subscriptions').select('id,label,created_at,last_ok_at,fail_count').order('created_at');
  if (error) throw error;
  return data;
}
export async function removeDevice(id) {
  const { error } = await sb.from('push_subscriptions').delete().eq('id', id);
  if (error) throw error;
}

export async function testPush() {
  const { data, error } = await sb.functions.invoke('rappels', { body: { test: true } });
  if (error) throw new Error(error.message || 'Envoi impossible');
  return data;
}
