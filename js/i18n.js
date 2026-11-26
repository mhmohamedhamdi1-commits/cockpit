// Langue de l'interface (fr / en / ar) : traduction des textes affichés + sens d'écriture (RTL pour l'arabe).
// Les données saisies (libellés, catégories personnalisées…) ne sont pas traduites.
import { DICT } from './i18n-data.js';
import { setLocale } from './util.js';

export const LANGS = [{ value: 'fr', label: 'Français' }, { value: 'en', label: 'English' }, { value: 'ar', label: 'العربية' }];
let lang = 'fr';
const IDX = { en: 0, ar: 1 };

// Textes avec variables (nombres, noms) : motifs les plus fréquents
const PATTERNS = [
  [/^Tu mets de côté (\d+) % de tes revenus : au-dessus de l’objectif de 20 %\.$/, ['You save $1% of your income: above the 20% target.', 'تدخر $1 % من مداخيلك: فوق هدف 20 %.']],
  [/^Objectif conseillé : 20 % de tes revenus, soit (.+) par mois \(aujourd’hui (.+)\)\.$/, ['Recommended target: 20% of your income, i.e. $1 per month (today $2).', 'الهدف الموصى به: 20 % من مداخيلك، أي $1 شهريًا (حاليًا $2).']],
  [/^(.+) mois de dépenses couverts par ton disponible : confortable\.$/, ['$1 months of expenses covered by your available cash: comfortable.', '$1 أشهر من المصاريف مغطاة بسيولتك: مريح.']],
  [/^(.+) mois couverts\. Vise 3 à 6 mois de dépenses \((.+) à (.+)\) sur un compte disponible\.$/, ['$1 months covered. Aim for 3 to 6 months of expenses ($2 to $3) in an available account.', '$1 أشهر مغطاة. استهدف 3 إلى 6 أشهر من المصاريف ($2 إلى $3) في حساب متاح.']],
  [/^Dépenses en hausse de (\d+) % sur les 3 derniers mois(.*)\.$/, ['Spending up $1% over the last 3 months$2.', 'ارتفاع المصاريف بـ $1 % خلال الأشهر الثلاثة الأخيرة$2.']],
  [/^(\d+) % de tes revenus viennent de « (.+) »\.(.*)$/, ['$1% of your income comes from “$2”.$3', '$1 % من مداخيلك تأتي من «$2».$3']],
  [/^(\d+) % de tes revenus investis sur 12 mois\.$/, ['$1% of your income invested over 12 months.', '$1 % من مداخيلك مستثمرة خلال 12 شهرًا.']],
  [/^Investir au moins 10 % de tes revenus \((.+)\/mois\) fait travailler ton épargne\.$/, ['Investing at least 10% of your income ($1/month) puts your savings to work.', 'استثمار 10 % على الأقل من مداخيلك ($1/شهر) يجعل ادخارك يعمل.']],
  [/^(.+) de loyers manquants sur 3 mois : relance les locataires concernés\.$/, ['$1 of rent missing over 3 months: remind the tenants concerned.', '$1 من الكراء ناقص خلال 3 أشهر: ذكّر المكترين المعنيين.']],
  [/^(\d+) facture\(s\) impayée\(s\) depuis plus de 30 jours\.$/, ['$1 invoice(s) unpaid for more than 30 days.', '$1 فاتورة غير مؤداة منذ أكثر من 30 يومًا.']],
  [/^compte en France · depuis le (.+)$/, ['account in France · since $1', 'الحساب في فرنسا · منذ $1']],
  [/^ma part (\d+) % de (.+)$/, ['my share $1% of $2', 'حصتي $1 % من $2']],
  [/^partagé · ma part (\d+) % de (.+)$/, ['shared · my share $1% of $2', 'مشارك · حصتي $1 % من $2']],
  [/^(\d+) points?$/, ['$1 item(s)', '$1 نقطة']],
  [/^(\d+) derniers mois$/, ['last $1 months', 'آخر $1 شهرًا']],
  [/^cours du (.+) · Yahoo Finance \(différé possible\)$/, ['prices as of $1 · Yahoo Finance (may be delayed)', 'الأسعار بتاريخ $1 · Yahoo Finance (قد تتأخر)']],
  [/^(\d+) lignes? · coût (.+)$/, ['$1 position(s) · cost $2', '$1 مركز · التكلفة $2']],
  [/^plus-values (.+) · dividendes (.+)$/, ['gains $1 · dividends $2', 'الأرباح $1 · التوزيعات $2']],
  [/^gain total (.+) sur (.+) investis \(non annualisé\)$/, ['total gain $1 on $2 invested (not annualized)', 'الربح الكلي $1 على $2 مستثمرة (غير سنوي)']],
  [/^Dernier relevé de comptes \((.+)\) : (.+) disponibles\. L’écart \((.+)\) correspond aux soldes antérieurs au (.+) ou à des opérations non saisies\.$/, ['Last account statement ($1): $2 available. The gap ($3) comes from balances before $4 or unrecorded transactions.', 'آخر كشف حسابات ($1): $2 متاحة. الفرق ($3) يعود لأرصدة قبل $4 أو عمليات غير مسجلة.']],
  [/^(.+) · loyer de (.+) · (.+) attendus$/, ['$1 · rent for $2 · $3 expected', '$1 · كراء $2 · $3 متوقعة']],
  [/^Synchronisé (.+)$/, ['Synced $1', 'تمت المزامنة $1']],
  [/^il y a (\d+) min$/, ['$1 min ago', 'منذ $1 دقيقة']],
  [/^il y a (\d+) h$/, ['$1 h ago', 'منذ $1 ساعة']],
  [/^(\d+) opérations?$/, ['$1 transactions', '$1 عملية']],
  [/^(\d+) opérations? · (.+)$/, ['$1 transactions · $2', '$1 عملية · $2']],
  [/^Dans (\d+) j$/, ['In $1 d', 'بعد $1 يوم']],
  [/^dans (\d+) j$/, ['in $1 d', 'بعد $1 يوم']],
  [/^le (\d+)$/, ['on the $1th', 'يوم $1']],
  [/^(\d+) loyers? en retard$/, ['$1 late rent(s)', '$1 كراء متأخر']],
  [/^(\d+) factures? à envoyer$/, ['$1 invoice(s) to send', '$1 فاتورة للإرسال']],
  [/^(\d+) lots? · (.+)$/, ['$1 unit(s) · $2', '$1 وحدة · $2']],
  [/^(\d+) actifs?$/, ['$1 active', '$1 نشط']],
  [/^(\d+) sur la période$/, ['$1 in the period', '$1 خلال الفترة']],
  [/^Revenus (.+)\/mois · dépenses (.+)\/mois$/, ['Income $1/month · expenses $2/month', 'المداخيل $1/شهر · المصاريف $2/شهر']],
  [/^Épargne (.+)$/, ['Savings $1', 'الادخار $1']],
  [/^Ma part \((\d+) %\)$/, ['My share ($1%)', 'حصتي ($1 %)']],
  [/^ma part (\d+) %(.*)$/, ['my share $1%$2', 'حصتي $1 %$2']],
  [/^Plafonds (\d{4})$/, ['Thresholds $1', 'السقوف $1']],
  [/^Encaisser les loyers de (.+)$/, ['Collect rents for $1', 'تحصيل كراء $1']],
  [/^Générer (\d+) opérations?$/, ['Generate $1 transaction(s)', 'إنشاء $1 عملية']],
  [/^Relancer (.+)$/, ['Remind $1', 'تذكير $1']],
  [/^Partager « (.+) »$/, ['Share “$1”', 'مشاركة «$1»']],
  [/^Partagé par (.+) — lecture seule$/, ['Shared by $1 — read-only', 'شاركه $1 — قراءة فقط']],
  [/^Relevé du (.+)$/, ['Statement of $1', 'كشف $1']],
  [/^depuis le (.+)$/, ['since $1', 'منذ $1']],
  [/^Dernier relevé : (.+)$/, ['Last statement: $1', 'آخر كشف: $1']],
];

function tr(text) {
  if (lang === 'fr') return null;
  const key = text.trim();
  if (!key) return null;
  const hit = DICT[key];
  if (hit) return text.replace(key, hit[IDX[lang]]);
  for (const [re, out] of PATTERNS) if (re.test(key)) return text.replace(key, key.replace(re, out[IDX[lang]]));
  return null;
}
const ATTRS = ['placeholder', 'title', 'aria-label'];
function translate(root) {
  if (lang === 'fr' || !root) return;
  if (root.nodeType === 3) { const t = tr(root.nodeValue); if (t != null && t !== root.nodeValue) root.nodeValue = t; return; }
  if (root.nodeType !== 1 || root.closest && root.closest('[data-notr], textarea, input, code')) return;
  for (const a of ATTRS) if (root.hasAttribute && root.hasAttribute(a)) { const t = tr(root.getAttribute(a)); if (t != null) root.setAttribute(a, t); }
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.nodeType === 1 && (n.tagName === 'TEXTAREA' || n.tagName === 'SCRIPT' || n.tagName === 'STYLE' || n.tagName === 'CODE' || n.hasAttribute('data-notr')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let n;
  while ((n = w.nextNode())) {
    if (n.nodeType === 3) { const t = tr(n.nodeValue); if (t != null && t !== n.nodeValue) n.nodeValue = t; }
    else for (const a of ATTRS) if (n.hasAttribute(a)) { const t = tr(n.getAttribute(a)); if (t != null) n.setAttribute(a, t); }
  }
}
let obs;
export function setLang(l) {
  lang = IDX[l] != null ? l : 'fr';
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  setLocale(lang);
  if (!obs) {
    obs = new MutationObserver((ms) => { if (lang === 'fr') return; for (const m of ms) { if (m.type === 'characterData') translate(m.target); else m.addedNodes.forEach(translate); } });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  translate(document.body);
}
export const getLang = () => lang;
export const t = (fr) => { const x = tr(fr); return x == null ? fr : x; };
