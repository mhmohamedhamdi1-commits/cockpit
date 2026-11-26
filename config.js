// Configuration publique de l'application (aucun secret ici : la clé « publishable » est faite pour être visible,
// les données sont protégées par les règles d'accès RLS + MFA de la base). Régénéré par tools/cloud/deploy.mjs.
export const CONFIG = {
  url: 'https://gliensrtmkczalbhhodm.supabase.co',
  key: '__SUPABASE_PUBLISHABLE_KEY__',
  vapid: '__VAPID_PUBLIC_KEY__',
  backupUrl: '__BACKUP_URL__',
  allowSignup: true,
  build: 'dev',
};
