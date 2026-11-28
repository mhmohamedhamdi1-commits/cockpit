// « Où je me situe » : position des revenus, du patrimoine et du taux d'épargne de l'utilisateur
// par rapport aux populations de la France, du Maroc et du monde.
// Module PUR : aucun DOM, aucun import. Données relevées le 2026-11-28 ; à relire une fois par an
// (voir docs/11_Comparaison_pays.md pour le tableau des sources et les limites).
//
// Conventions :
//  - fx = { MAD: <1 MAD en EUR>, USD: <1 USD en EUR> } (même convention que `tx.taux` : 1 devise en EUR).
//  - Un percentile est une probabilité cumulative dans [0..1] : part de la population située EN DESSOUS de la valeur.
//  - topPct = part (en %) de la population située AU-DESSUS (7 ⇒ « parmi les 7 % les plus aisés »).

export const COUNTRIES = [
  { code: 'FR', label: 'France', flag: '🇫🇷', currency: 'EUR', in: 'en France' },
  { code: 'MA', label: 'Maroc', flag: '🇲🇦', currency: 'MAD', in: 'au Maroc' },
  { code: 'WORLD', label: 'Monde', flag: '🌍', currency: 'USD', in: 'dans le monde' },
];

// Borne haute d'un percentile (au-delà des données, on ne prétend pas mieux que « 0,01 % les plus aisés »).
const CAP = 0.9999;

const UBS_DATABOOK_2023 = 'https://www.ubs.com/global/en/family-office-uhnw/reports/global-wealth-report-2023/_jcr_content/mainpar/toplevelgrid_5684475/col2/linklistnewlook/link_copy.0357374027.file/PS9jb250ZW50L2RhbS9hc3NldHMvd20vZ2xvYmFsL2ltZy9nbG9iYWwtZmFtaWx5LW9mZmljZS9kb2NzL2RhdGFib29rLWdsb2JhbC13ZWFsdGgtcmVwb3J0LTIwMjMtZW4ucGRm/databook-global-wealth-report-2023-en.pdf';
const UBS_GWR_2026 = 'https://www.ubs.com/global/en/wealthmanagement/insights/global-wealth-report.html';

export const DATA = {
  // Année de référence des prix : les seuils de revenu sont revalorisés de l'inflation jusqu'à cette année.
  refYear: 2026,

  // ── Inflation annuelle moyenne des prix à la consommation (%) ──────────────────────────────────────
  // FMI, World Economic Outlook (octobre 2026), indicateur PCPIPCH, API DataMapper
  // https://www.imf.org/external/datamapper/api/v1/PCPIPCH — 2026 = estimation du FMI.
  inflation: {
    year: 2026,
    source: 'FMI, World Economic Outlook (octobre 2026), inflation moyenne des prix à la consommation (PCPIPCH)',
    url: 'https://www.imf.org/external/datamapper/PCPIPCH@WEO',
    FR: { 2020: 0.5, 2021: 2.1, 2022: 5.9, 2023: 5.7, 2024: 2.3, 2025: 0.9, 2026: 2.4 },
    MA: { 2020: 0.7, 2021: 1.4, 2022: 6.6, 2023: 6.1, 2024: 0.9, 2025: 0.8, 2026: 0.9 },
    USA: { 2020: 1.3, 2021: 4.7, 2022: 8.0, 2023: 4.1, 2024: 3.0, 2025: 2.7, 2026: 3.6 },
    note: 'Pour la France, le FMI utilise l’IPCH. Valeurs 2026 estimées (WEO d’octobre 2026).',
  },

  // ── Parités de pouvoir d'achat ────────────────────────────────────────────────────────────────────
  // FMI WEO (octobre 2026), « Implied PPP conversion rate » (PPPEX), monnaie nationale par dollar international,
  // basé sur le PIB (benchmark PCI 2021 de la Banque mondiale). API : https://www.imf.org/external/datamapper/api/v1/PPPEX
  // Valeurs 2025 : FR 0,654 ; MA 3,93. Valeurs 2026 (estimations) retenues ci-dessous.
  // NB : l'API de la Banque mondiale (PA.NUS.PRVT.PP) était inaccessible lors de la relève ; les facteurs FMI reposent
  // sur le même programme de comparaison internationale (PCI 2021).
  ppp: {
    year: 2026,
    FR: 0.643, // EUR par $ international
    MA: 3.836, // MAD par $ international
    USA: 1,
    source: 'FMI, World Economic Outlook (octobre 2026), Implied PPP conversion rate (PPPEX)',
    url: 'https://www.imf.org/external/datamapper/PPPEX@WEO',
    note: 'Facteur de conversion PPA basé sur le PIB (et non sur la seule consommation des ménages) ; estimation 2026.',
    estimated: true,
  },

  // ── REVENU ────────────────────────────────────────────────────────────────────────────────────────
  income: {
    // INSEE, « Distribution des niveaux de vie » (publié le 09/07/2026), enquête Revenus fiscaux et sociaux 2024,
    // France métropolitaine. https://www.insee.fr/fr/statistiques/2416808 — et Insee Première n° 2117 (09/07/2026),
    // https://www.insee.fr/fr/statistiques/9019316 : médiane 26 740 €, D9/D1 = 3,48, Gini 0,302.
    // Niveau de vie = revenu disponible du ménage (après impôts directs et prestations) / nombre d'unités de consommation.
    // P99 non publié pour 2024 : extrapolé (Pareto P90–P95, α ≈ 3,0 ⇒ P99 ≈ 105 k€) ; cohérent avec le seuil des 1 %
    // de Filosofi 2021 (90 140 € courants 2021, https://www.insee.fr/fr/statistiques/7941389) revalorisé de l'inflation.
    FR: {
      code: 'FR',
      measure: 'niveau de vie annuel (revenu disponible par unité de consommation, après impôts et prestations)',
      currency: 'EUR',
      ppp: false,
      year: 2024,
      priceYear: 2024,
      inflationCountry: 'FR',
      method: 'deciles',
      median: 26740,
      gini: 0.302,
      points: [
        { p: 0.10, v: 13970 }, { p: 0.20, v: 17700 }, { p: 0.30, v: 20980 }, { p: 0.40, v: 23880 },
        { p: 0.50, v: 26740 }, { p: 0.60, v: 29880 }, { p: 0.70, v: 33680 }, { p: 0.80, v: 38780 },
        { p: 0.90, v: 48580 }, { p: 0.95, v: 61220 },
      ],
      source: 'INSEE, ERFS 2024 – Distribution des niveaux de vie (publié le 09/07/2026)',
      url: 'https://www.insee.fr/fr/statistiques/2416808',
      note: 'France métropolitaine, personnes en logement ordinaire. Au-delà du P95 : extrapolation de Pareto (P99 ≈ 105 000 €).',
    },

    // HCP, « Revenus des ménages : niveaux, sources et distribution sociale » (note du 28/04/2021), enquête nationale
    // sur les sources de revenus (déc. 2019 – mars 2020, 3 290 ménages). Revenu annuel par personne :
    // moyenne 21 515 DH ; 10 % les moins aisés < 6 270 DH ; 10 % les plus aisés > 41 705 DH ; part des 10 % du haut 37,8 % ;
    // Gini 46,4 %. https://www.hcp.ma/Revenus-des-menages-Niveaux-sources-et-distribution-sociale_a2697.html
    // (chiffres repris par https://ecoactu.ma/revenus-des-menages/ et https://fr.le360.ma/economie/hcp-au-maroc-le-revenu-median-par-menage-est-de-5133-dirhams-par-mois-237648/).
    // Déciles intermédiaires et médiane PAR PERSONNE non publiés ⇒ ajustement log-normal sur P10 et P90 :
    //   σ = ln(41 705 / 6 270) / (2 × 1,28155) = 0,7393 ; médiane = √(6 270 × 41 705) ≈ 16 171 DH
    //   (moyenne implicite 21 254 DH, à 1,2 % de la moyenne publiée de 21 515 DH).
    // La log-normale sous-estime le haut de la distribution (Gini implicite 0,40 < 0,464) ⇒ au-delà du P90, queue de Pareto
    // calibrée sur la part des 10 % les plus aisés : moyenne du décile du haut = 0,378 × 10 × 21 515 = 81 327 DH = α/(α−1) × 41 705
    // ⇒ α ≈ 2,05.
    // Repère plus récent : HCP, ENNVM 2022-2023, revenu annuel moyen par personne 21 949 DH en 2022 (+2 % vs 2019) ;
    // https://www.hcp.ma/Note-sur-les-principaux-resultats-de-l-Enquete-Nationale-sur-le-Niveau-de-Vie-des-Menages-2022-2023_a4061.html
    MA: {
      code: 'MA',
      measure: 'revenu annuel par personne (revenu du ménage / taille du ménage)',
      currency: 'MAD',
      ppp: false,
      year: 2019,
      priceYear: 2019,
      inflationCountry: 'MA',
      method: 'lognormal',
      median: 16171,
      sigma: 0.7393,
      mean: 21515,
      gini: 0.464,
      tail: { v: 41705, alpha: 2.05 },
      points: [{ p: 0.10, v: 6270 }, { p: 0.90, v: 41705 }], // seuils publiés (référence et tests)
      estimated: true,
      source: 'HCP, enquête nationale sur les sources de revenus 2019 (note du 28/04/2021)',
      url: 'https://www.hcp.ma/Revenus-des-menages-Niveaux-sources-et-distribution-sociale_a2697.html',
      note: 'Médiane par personne estimée (log-normale ajustée sur P10 = 6 270 DH et P90 = 41 705 DH) ; queue de Pareto α ≈ 2,05 au-delà du P90.',
    },

    // Banque mondiale, Poverty and Inequality Platform (PIP, version 20260922, PPA 2021), distribution mondiale 2024
    // (estimations « actual »), revenu OU consommation par personne (selon l'enquête de chaque pays), en $ PPA 2021 / jour.
    // Seuils obtenus en interrogeant l'API (taux de pauvreté mondial pour 71 seuils de 1 à 400 $/jour) puis interpolation :
    // https://api.worldbank.org/pip/v1/pip-grp?country=all&year=2024&povline=<seuil>&group_by=wb&ppp_version=2021
    // $/jour : P10 2,98 · P20 4,43 · P30 5,67 · P40 7,13 · P50 9,20 · P60 12,51 · P70 18,10 · P80 28,92 · P90 54,08 · P95 81,98 · P99 162,84
    // (× 365 ci-dessous). Les enquêtes captent mal les très hauts revenus ⇒ haut de distribution sous-estimé.
    WORLD: {
      code: 'WORLD',
      measure: 'revenu ou consommation annuel par personne, en dollars PPA 2021',
      currency: 'USD',
      ppp: true,
      year: 2024,
      priceYear: 2021,
      inflationCountry: 'USA',
      method: 'deciles',
      median: 3360,
      points: [
        { p: 0.10, v: 1087 }, { p: 0.20, v: 1616 }, { p: 0.30, v: 2071 }, { p: 0.40, v: 2603 },
        { p: 0.50, v: 3360 }, { p: 0.60, v: 4566 }, { p: 0.70, v: 6605 }, { p: 0.80, v: 10557 },
        { p: 0.90, v: 19739 }, { p: 0.95, v: 29922 }, { p: 0.99, v: 59435 },
      ],
      source: 'Banque mondiale, Poverty and Inequality Platform (version 20260922, PPA 2021), distribution mondiale 2024',
      url: 'https://pip.worldbank.org',
      note: 'Distribution en $ PPA : en mode nominal, ton revenu converti au taux de marché est comparé à cette distribution PPA (approximation prudente).',
    },
  },

  // ── PATRIMOINE (net, par adulte, USD courants au taux de change de fin d'année) ───────────────────
  // UBS Global Wealth Databook 2023 (données fin 2022) — dernière édition publiant la distribution complète par pays
  // (Table 3-1 « Wealth pattern within markets », Table 3-6 HNWI, Table 4-1, Table 4-5 seuils mondiaux).
  // Copie : https://elements.visualcapitalist.com/wp-content/uploads/2024/08/global-wealth-databook-2023-ubs.pdf
  wealth: {
    // France (Table 3-1) : 50 368 k adultes ; moyenne 312 235 $ ; médiane 133 137 $ ; < 10 k$ 15,5 % ; 10–100 k$ 26,1 % ;
    // 100 k–1 M$ 52,7 % ; > 1 M$ 5,6 % ; Gini 70,3 %. Table 3-6 : 1–5 M$ 2 628 568 ; 5–10 M$ 137 305 ; 10–50 M$ 51 403 ;
    // 50–100 M$ 2 638 ; 100–500 M$ 1 168 ; 500 M$+ 82 adultes ⇒ > 5 M$ 0,382 % ; > 10 M$ 0,110 % ; > 50 M$ 0,0077 %.
    // Repère plus récent : UBS Global Wealth Report 2026 (fin 2025) : moyenne 341 359 $, médiane 121 898 $,
    // 2 388 k millionnaires en USD (≈ 4,5 % des adultes). https://www.ubs.com/global/en/wealthmanagement/insights/global-wealth-report.html
    FR: {
      code: 'FR',
      measure: 'patrimoine net par adulte (USD)',
      currency: 'USD',
      year: 2022,
      method: 'deciles',
      median: 133137,
      mean: 312235,
      gini: 0.703,
      points: [
        { p: 0.155, v: 10000 }, { p: 0.416, v: 100000 }, { p: 0.5, v: 133137 }, { p: 0.944, v: 1000000 },
        { p: 0.99618, v: 5000000 }, { p: 0.9989, v: 10000000 }, // > 50 M$ (0,0077 %) dépasse le plafond 0,9999
      ],
      bands: { lt10k: 15.5, k10to100k: 26.1, k100kto1m: 52.7, gt1m: 5.6 },
      latest: { year: 2025, median: 121898, mean: 341359, millionairesK: 2388, source: 'UBS Global Wealth Report 2026', url: UBS_GWR_2026 },
      source: 'UBS Global Wealth Databook 2023 (fin 2022), Tables 3-1 et 3-6',
      url: UBS_DATABOOK_2023,
      note: 'Tranches de patrimoine UBS (fin 2022) interpolées. Repère fin 2025 (GWR 2026) : médiane 121 898 $, moyenne 341 359 $.',
    },

    // Maroc (Table 3-1) : 25 026 k adultes ; moyenne 13 862 $ ; médiane 3 896 $ ; < 10 k$ 77,6 % ; 10–100 k$ 20,3 % ;
    // 100 k–1 M$ 2,0 % ; > 1 M$ 0,1 % ; Gini 82,3 %. Qualité des données jugée « Poor » par UBS (estimation par régression,
    // Table 2-1). Le Maroc ne fait pas partie des 56 marchés du Global Wealth Report 2026.
    MA: {
      code: 'MA',
      measure: 'patrimoine net par adulte (USD)',
      currency: 'USD',
      year: 2022,
      method: 'deciles',
      median: 3896,
      mean: 13862,
      gini: 0.823,
      points: [{ p: 0.5, v: 3896 }, { p: 0.776, v: 10000 }, { p: 0.979, v: 100000 }, { p: 0.999, v: 1000000 }],
      bands: { lt10k: 77.6, k10to100k: 20.3, k100kto1m: 2.0, gt1m: 0.1 },
      estimated: true,
      source: 'UBS Global Wealth Databook 2023 (fin 2022), Table 3-1',
      url: UBS_DATABOOK_2023,
      note: 'Estimation UBS par régression (qualité des données « faible ») ; entre 0 et la médiane, interpolation linéaire.',
    },

    // Monde (Table 4-5, II « Minimum wealth of deciles and top percentiles ») : P10 −168 $ ; P20 855 ; P30 2 236 ; P40 4 569 ;
    // P50 8 654 ; P60 14 589 ; P70 25 669 ; P80 52 187 ; P90 137 333 ; P95 292 510 ; P99 1 081 342 $.
    // Table 4-1 : 5 363 519 k adultes, moyenne 84 718 $, médiane 8 654 $. Table 3-6 (monde) : > 5 M$ 7 841 314 adultes (0,146 %),
    // > 10 M$ 2 753 380 (0,0513 %).
    // Repère plus récent : UBS GWR 2026, pyramide fin 2025 sur 56 marchés (3,85 Md d'adultes) : < 10 k$ 42,1 % ; 10–100 k$ 41,1 % ;
    // 100 k–1 M$ 15,3 % ; > 1 M$ 1,5 %.
    WORLD: {
      code: 'WORLD',
      measure: 'patrimoine net par adulte (USD)',
      currency: 'USD',
      year: 2022,
      method: 'deciles',
      median: 8654,
      mean: 84718,
      points: [
        { p: 0.10, v: -168 }, { p: 0.20, v: 855 }, { p: 0.30, v: 2236 }, { p: 0.40, v: 4569 }, { p: 0.50, v: 8654 },
        { p: 0.60, v: 14589 }, { p: 0.70, v: 25669 }, { p: 0.80, v: 52187 }, { p: 0.90, v: 137333 },
        { p: 0.95, v: 292510 }, { p: 0.99, v: 1081342 }, { p: 0.998538, v: 5000000 }, { p: 0.999487, v: 10000000 },
      ],
      bands: { lt10k: 52.5, k10to100k: 34.4, k100kto1m: 12.0, gt1m: 1.1 },
      latestBands: { year: 2025, lt10k: 42.1, k10to100k: 41.1, k100kto1m: 15.3, gt1m: 1.5, coverage: '56 marchés', source: 'UBS Global Wealth Report 2026', url: UBS_GWR_2026 },
      source: 'UBS Global Wealth Databook 2023 (fin 2022), Tables 4-1, 4-5 et 3-6',
      url: UBS_DATABOOK_2023,
      note: 'Seuils mondiaux de déciles et percentiles (217 marchés). Repère fin 2025 (56 marchés) : 42,1 % des adultes sous 10 000 $.',
    },
  },

  // ── ÉPARGNE (taux d'épargne brut des ménages, % du revenu disponible brut) ──────────────────────────
  savings: {
    // INSEE, comptes nationaux annuels 2025 (base 2020, publiés le 29/05/2026), Insee Première n° 2105 :
    // taux d'épargne 17,9 % en 2025 (18,5 % en 2024 ; moyenne 2009-2019 : 14,7 %).
    FR: {
      code: 'FR', rate: 0.179, year: 2025,
      source: 'INSEE, Les comptes de la Nation en 2025 (Insee Première n° 2105, mai 2026)',
      url: 'https://www.insee.fr/fr/statistiques/8996855',
      note: 'Épargne brute des ménages / revenu disponible brut. Moyenne 2009-2019 : 14,7 %.',
    },
    // HCP, Comptes nationaux des secteurs institutionnels 2024 (base 2014), décembre 2025 : épargne brute des ménages
    // 119 981 MDH pour un RDB de 1 059,7 Md DH ⇒ taux d'épargne 11,3 %.
    MA: {
      code: 'MA', rate: 0.113, year: 2024,
      source: 'HCP, Comptes nationaux des secteurs institutionnels 2024 (décembre 2025)',
      url: 'https://www.hcp.ma/Les-comptes-nationaux-des-secteurs-institutionnels-2024-Base-2014-Decembre-2025-Rapport-complet_a4225.html',
      note: 'Épargne brute des ménages (119,98 Md DH) / revenu disponible brut (1 059,7 Md DH).',
    },
    // Eurostat, euro indicators (13/01/2026) : taux d'épargne des ménages de la zone euro (CVS) T1-T4 2024 : 15,2 / 15,4 / 15,2 / 15,0 %
    // ⇒ ≈ 15,2 % en 2024 (même définition brute que l'INSEE).
    EA: {
      code: 'EA', label: 'Zone euro', flag: '🇪🇺', in: 'dans la zone euro', rate: 0.152, year: 2024,
      source: 'Eurostat, Household saving rate – euro area (communiqué du 13/01/2026)',
      url: 'https://ec.europa.eu/eurostat/web/products-euro-indicators/w/2-13012026-ap',
      note: 'Moyenne des quatre trimestres 2024 (données corrigées des variations saisonnières).',
    },
    // Aucune moyenne mondiale (ni OCDE comparable) du taux d'épargne des MÉNAGES n'est publiée sur une base homogène :
    // l'OCDE publie un taux NET (après amortissement), non comparable aux taux bruts ci-dessus.
    WORLD: {
      code: 'WORLD', rate: null, year: null, source: null, url: null,
      note: 'Pas de moyenne mondiale homogène du taux d’épargne des ménages ; la zone euro sert de référence.',
    },
  },
};

// ── Outils mathématiques ────────────────────────────────────────────────────────────────────────────

// Fonction de répartition de la loi normale centrée réduite (Abramowitz & Stegun 7.1.26, erreur < 1,5e-7).
function normCdf(z) {
  if (z === Infinity) return 1;
  if (z === -Infinity) return 0;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Queue de Pareto au-delà du point (v0, p0) : 1 − F(v) = (1 − p0) · (v / v0)^−α, bornée à CAP.
function pareto(v, v0, p0, alpha) {
  return Math.min(CAP, 1 - (1 - p0) * Math.pow(v / v0, -alpha));
}

/**
 * Probabilité cumulative [0..1] d'une valeur dans une distribution.
 * - method 'deciles' : `points` [{ p, v }] triés ; interpolation linéaire de p en ln(v) (monotone), linéaire en v si un point ≤ 0 ;
 *   sous le premier point : interpolation linéaire depuis (0, dist.zeroShare ?? 0) ; au-delà du dernier : Pareto (α = dist.tailAlpha
 *   ou déduit des deux derniers points, borné à [1,1 ; 5]).
 * - method 'lognormal' : Φ((ln v − ln médiane) / σ), avec queue de Pareto optionnelle `tail: { v, alpha }`.
 * Cas limites : valeur ≤ 0 (et sous le premier point) ⇒ 0 ; résultat borné à 0,9999 ; NaN ⇒ NaN.
 */
export function percentileOf(value, dist) {
  if (!dist) throw new TypeError('percentileOf : distribution manquante');
  if (typeof value !== 'number' || Number.isNaN(value)) return NaN;

  if (dist.method === 'lognormal') {
    if (value <= 0) return 0;
    const z = (v) => (Math.log(v) - Math.log(dist.median)) / dist.sigma;
    if (dist.tail && value > dist.tail.v) return pareto(value, dist.tail.v, normCdf(z(dist.tail.v)), dist.tail.alpha);
    return clamp(normCdf(z(value)), 0, CAP);
  }

  const pts = dist.points;
  if (!Array.isArray(pts) || pts.length < 2) throw new TypeError('percentileOf : au moins deux points sont requis');
  const first = pts[0];
  const last = pts[pts.length - 1];

  if (value < first.v) {
    if (value <= 0) return 0;
    const z0 = dist.zeroShare ?? 0;
    return z0 + (first.p - z0) * (value / first.v);
  }
  if (value >= last.v) {
    const prev = pts[pts.length - 2];
    const alpha = dist.tailAlpha ?? clamp(Math.log((1 - prev.p) / (1 - last.p)) / Math.log(last.v / prev.v), 1.1, 5);
    return pareto(value, last.v, last.p, alpha);
  }
  let i = 0;
  while (pts[i + 1].v <= value) i++;
  const a = pts[i];
  const b = pts[i + 1];
  const t = a.v > 0 ? Math.log(value / a.v) / Math.log(b.v / a.v) : (value - a.v) / (b.v - a.v);
  return Math.min(CAP, a.p + t * (b.p - a.p));
}

// Facteur de revalorisation des prix de `fromYear` à `toYear` (inflation FMI WEO).
export function priceFactor(country, fromYear, toYear = DATA.refYear) {
  const rates = DATA.inflation[country];
  if (!rates) return 1;
  let f = 1;
  for (let y = fromYear + 1; y <= toYear; y++) f *= 1 + (rates[y] ?? 0) / 100;
  return f;
}

// « parmi les X % les plus aisés » : entier au-delà de 10 %, une décimale entre 1 et 10 %, un chiffre significatif sous 1 %.
function topPctOf(p) {
  const t = (1 - p) * 100;
  if (t >= 9.95) return Math.round(t);
  if (t >= 1) return Math.round(t * 10) / 10;
  return Number(t.toPrecision(1));
}

function needFx(fx, cur) {
  const r = fx && fx[cur];
  if (!(typeof r === 'number' && r > 0)) throw new TypeError(`compare : fx.${cur} (valeur de 1 ${cur} en EUR) est requis`);
  return r;
}

const country = (code) => COUNTRIES.find((c) => c.code === code);

// `pValue` : valeur placée dans la distribution (par défaut `value` ; pour le revenu, la valeur ramenée aux prix de l'enquête).
function row(code, dist, value, median, extra, pValue = value) {
  const c = country(code);
  const percentile = percentileOf(pValue, dist);
  return {
    code, label: c.label, flag: c.flag,
    currency: dist.currency,
    value,
    percentile,
    topPct: topPctOf(percentile),
    medianLocal: median,
    ratioToMedian: median > 0 ? value / median : NaN,
    method: dist.method,
    year: dist.year,
    source: dist.source,
    url: dist.url,
    note: dist.note,
    estimated: !!dist.estimated,
    ...extra,
  };
}

/**
 * Position d'un revenu annuel net (en EUR) en France, au Maroc et dans le monde.
 * Pour la France, passer idéalement le NIVEAU DE VIE : revenu disponible du ménage après impôt / unités de consommation
 * (1 pour le premier adulte, 0,5 par personne de 14 ans ou plus, 0,3 par enfant de moins de 14 ans). Pour une personne seule,
 * c'est le revenu net après impôt sur le revenu.
 * @param {number} annualNetEur
 * @param {{ fx?: { MAD: number, USD: number }, ppp?: boolean, inflation?: boolean }} opts
 *   ppp = true : conversion par les parités de pouvoir d'achat (FMI) au lieu des taux de marché ;
 *   inflation = true (défaut) : les seuils publiés sont revalorisés de l'inflation jusqu'à DATA.refYear.
 */
export function compareIncome(annualNetEur, { fx, ppp = false, inflation = true } = {}) {
  const P = DATA.ppp;
  const zones = COUNTRIES.map(({ code }) => {
    const dist = DATA.income[code];
    const f = inflation ? priceFactor(dist.inflationCountry, dist.priceYear) : 1;
    let local;
    let toEur;
    if (code === 'FR') { local = annualNetEur; toEur = 1; }
    else if (code === 'MA') { toEur = ppp ? P.FR / P.MA : needFx(fx, 'MAD'); local = annualNetEur / toEur; }
    else { toEur = ppp ? P.FR / P.USA : needFx(fx, 'USD'); local = annualNetEur / toEur; }
    const median = dist.median * f; // médiane revalorisée aux prix de DATA.refYear
    return row(code, dist, local, median, { medianEur: median * toEur, priceFactor: f }, local / f);
  });
  return { kind: 'income', amountEur: annualNetEur, ppp: !!ppp, refYear: DATA.refYear, zones };
}

/**
 * Position d'un patrimoine net (en EUR, par adulte) en France, au Maroc et dans le monde (distributions UBS en USD, fin 2022,
 * non revalorisées). `value` et `medianLocal` sont en USD ; `valueEur` / `medianEur` au taux du jour.
 * ppp = true : pour le Maroc, le patrimoine est d'abord exprimé en équivalent pouvoir d'achat marocain ; pour le monde,
 * en dollars internationaux. La France est inchangée.
 */
export function compareWealth(netWorthEur, { fx, ppp = false } = {}) {
  const usdEur = needFx(fx, 'USD');
  const P = DATA.ppp;
  const zones = COUNTRIES.map(({ code }) => {
    const dist = DATA.wealth[code];
    let usd = netWorthEur / usdEur;
    if (ppp && code === 'MA') usd = (netWorthEur / P.FR) * P.MA * needFx(fx, 'MAD') / usdEur;
    if (ppp && code === 'WORLD') usd = netWorthEur / P.FR;
    return row(code, dist, usd, dist.median, { valueEur: usd * usdEur, medianEur: dist.median * usdEur });
  });
  return { kind: 'wealth', amountEur: netWorthEur, ppp: !!ppp, refYear: DATA.refYear, zones };
}

/**
 * Taux d'épargne de l'utilisateur comparé aux taux d'épargne moyens des ménages (France, Maroc, zone euro).
 * @param {number} rate fraction (0,25) ; une valeur dont la valeur absolue dépasse 1 est lue comme un pourcentage (25).
 */
export function compareSavings(rate) {
  const r = Math.abs(rate) > 1 ? rate / 100 : rate;
  const zones = ['FR', 'MA', 'EA']
    .map((code) => {
      const d = DATA.savings[code];
      const c = country(code) || d;
      return {
        code, label: c.label, flag: c.flag, in: c.in,
        rate: d.rate,
        diffPts: Math.round((r - d.rate) * 1000) / 10,
        ratio: d.rate ? r / d.rate : NaN,
        above: r > d.rate,
        year: d.year, source: d.source, url: d.url, note: d.note,
      };
    });
  return { kind: 'savings', rate: r, zones };
}

// ── Textes ──────────────────────────────────────────────────────────────────────────────────────────

const NBSP = '\u00a0';
function fmtInt(n) {
  const s = String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return (n < 0 ? '−' : '') + s;
}
const fmtNum = (x) => String(x).replace('.', ',');
const fmtPct = (fraction) => fmtNum(Math.round(fraction * 1000) / 10);

function joinFr(list) {
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} et ${list[list.length - 1]}`;
}

/** Phrase française résumant un résultat de compareIncome, compareWealth ou compareSavings. */
export function explain(result) {
  if (!result || !Array.isArray(result.zones)) return '';
  if (result.kind === 'savings') {
    const sup = result.zones.filter((z) => z.rate != null && result.rate > z.rate);
    const inf = result.zones.filter((z) => z.rate != null && result.rate <= z.rate);
    const desc = (z) => `${z.in} (${fmtPct(z.rate)}${NBSP}%)`;
    const parts = [];
    if (sup.length) parts.push(`supérieur à la moyenne des ménages ${joinFr(sup.map(desc))}`);
    if (inf.length) parts.push(`${sup.length ? 'mais ' : ''}inférieur ou égal à celle des ménages ${joinFr(inf.map(desc))}`);
    return `Ton taux d'épargne de ${fmtPct(result.rate)}${NBSP}% est ${parts.join(', ')}.`;
  }

  const income = result.kind === 'income';
  const head = income
    ? `Avec ${fmtInt(result.amountEur)}${NBSP}€ nets par an`
    : `Avec un patrimoine net de ${fmtInt(result.amountEur)}${NBSP}€`;
  const where = (z) => country(z.code).in;
  const top = result.zones.filter((z) => z.topPct <= 50);
  const mid = result.zones.filter((z) => z.topPct > 50 && z.percentile >= 0.005);
  const bottom = result.zones.filter((z) => z.percentile < 0.005);
  const parts = [];
  if (top.length) {
    const adj = income ? 'les mieux rémunérés' : 'les plus fortunés';
    const frag = top.map((z, i) => `des ${fmtNum(z.topPct)}${NBSP}%${i === 0 ? ` ${adj}` : ''} ${where(z)}`);
    parts.push(`tu fais partie ${joinFr(frag)}`);
  }
  if (mid.length) {
    const who = income ? 'de la population' : 'des adultes';
    const frag = mid.map((z, i) => `${fmtNum(Math.round(z.percentile * 100))}${NBSP}%${i === 0 ? ` ${who}` : ''} ${where(z)}`);
    parts.push(`tu dépasses ${joinFr(frag)}`);
  }
  if (bottom.length) parts.push(`tu te situes tout en bas de l'échelle ${joinFr(bottom.map(where))}`);
  const tail = result.ppp ? '(en parité de pouvoir d’achat)' : '(valeurs nominales)';
  return `${head}, ${parts.join(' ; ')} ${tail}.`;
}
