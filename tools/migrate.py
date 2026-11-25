#!/usr/bin/env python3
"""Importe l'historique des 4 fichiers Excel dans Finances_Data.xlsx (format Cockpit).
Usage: python -I migrate.py <dossier_sources> <fichier_sortie.xlsx>
"""
import sys, re, warnings, datetime, collections, statistics
import openpyxl
warnings.filterwarnings('ignore')
SRC, OUT = sys.argv[1], sys.argv[2]
RATE = 0.093
TODAY = datetime.date(2026, 11, 24)
f = lambda n: f"{SRC}/{n}"
clean = lambda s: str(s if s is not None else '').replace('\xa0', ' ').strip()
d2s = lambda d: d.strftime('%Y-%m-%d') if isinstance(d, (datetime.datetime, datetime.date)) else None

TX_H = ["ID","Date","Activité","Sens","Catégorie","Détail","Libellé","Montant","Devise","Taux vers EUR","Montant EUR","Nature","Tiers","Lot","Période","Réf","Note"]
tx = []
def add_tx(date, act, sens, cat, lib, montant, devise, nature, tiers='', lot='', detail='', note=''):
    if not isinstance(date, (datetime.datetime, datetime.date)) or not isinstance(montant, (int, float)) or montant == 0:
        return False
    taux = 1.0 if devise == 'EUR' else RATE
    tx.append([None, date.date() if isinstance(date, datetime.datetime) else date, act, sens, cat, detail, lib or cat,
               round(montant, 2), devise, taux, round(montant * taux, 2), nature, tiers, lot, d2s(date)[:7], '', note])
    return True

# ---------------------------------------------------------------- PERSO (EUR)
w1 = openpyxl.load_workbook(f('01. [PERSO] Suivi PnL (EUR).xlsx'), data_only=True)
REV_MAP = {'Revenu immobilier': 'Revenu immobilier', 'Revenu boursier': 'Revenu boursier', 'e-commerce': 'E-commerce',
           'Revenu Football': 'Football', 'Autres': 'Autres'}
n_rev = 0
for r in w1['Revenues'].iter_rows(min_row=2, values_only=True):
    nat, typ, amt, date, per, comp, com = (list(r) + [None] * 7)[:7]
    if not typ: continue
    nat, comp, com = clean(nat), clean(comp), clean(com)
    note = com
    if typ == 'Revenu entreprise':
        if 'Client Givenchy' in comp or 'Freelancing' in nat:
            act, cat, nature, tiers = 'Freelance', 'Prestations', 'Courant', 'Talan (Givenchy)'
        else:
            act, cat, nature, tiers = 'Perso', 'Salaire & primes', 'Courant', comp
    elif typ == 'Revenu immobilier' and comp == 'Amal 1':
        act, cat, nature, tiers = 'Perso', 'Distribution Amal 1', 'Financement', 'Amal 1'
    else:
        act, cat, nature, tiers = 'Perso', REV_MAP.get(typ, 'Autres'), 'Courant', comp
    sens = 'Revenu'
    if isinstance(amt, (int, float)) and amt < 0:   # moins-value
        sens, cat, amt, act, nature = 'Dépense', 'Autres', -amt, 'Perso', 'Courant'
        nat = (nat + ' (moins-value)').strip()
    n_rev += add_tx(date, act, sens, cat, nat, amt, 'EUR', nature, tiers, note=note)

EXP_FIX = {'Impôts': 'Impôts', 'Voyages': 'Voyages', 'Amendes': 'Amendes'}
SEED_CATS = {"Loyer","Charges","Assurance Habitation","Entretien & Bricolage","Transports en Commun","Carburant","Entretien Véhicule","Assurance Auto","Stationnement","Autoroute","Courses","Restaurant","Café","Soins Médicaux","Assurance Santé","Soin & Coiffure","Activité Sportive","Vêtements","Loisirs & Divertissements","Mobile","Internet","Abonnements Numériques","Cadeaux","Dons","Impôts","Taxes","Frais Bancaires","Amendes","Voyages","Téléphone","Ordinateur","Electroménager","Mariage","Meubles","Travaux Immeuble","Acquisition voiture","Entreprise","eCommerce","La bourse","Immobilier","Autres"}
n_exp = 0; unknown = collections.Counter()
for r in w1['Expenses'].iter_rows(min_row=2, values_only=True):
    nat, typ, amt, date, per, com, ndf = (list(r) + [None] * 7)[:7]
    if not typ: continue
    typ = clean(typ); nat = clean(nat); com = clean(com)
    if typ not in SEED_CATS:
        unknown[typ] += 1; typ = 'Autres'
    nature = 'Investissement' if typ in ('La bourse', 'Immobilier') else 'Courant'
    note = com + (' · Note de frais' if ndf else '')
    sens = 'Dépense'
    if isinstance(amt, (int, float)) and amt < 0:   # remboursement
        sens, amt = 'Revenu', -amt
        if typ not in ('Autres',): note = (note + f' · remb. {typ}').strip(' ·')
        typ, nature = 'Autres', 'Courant'
    n_exp += add_tx(date, 'Perso', sens, typ, nat, amt, 'EUR', nature, note=note.strip())
print("Perso: revenus", n_rev, "dépenses", n_exp, "catégories inconnues:", dict(unknown))

# comptes / relevés
ACC, SNAP = [], []
pat = w1['Patrimoine']
order = 0
for r in pat.iter_rows(min_row=2, max_row=13, values_only=True):
    nom, montant, dispo = r[0], r[1], r[2]
    if not nom: continue
    order += 1
    devise = 'MAD' if 'CIH' in nom else 'EUR'
    ACC.append([order, nom, devise, 'Oui' if dispo == 'Oui' else 'Non', order])
    if isinstance(montant, (int, float)) and montant != 0:
        SNAP.append([None, datetime.date(2026, 11, 22), nom, round(montant, 2), devise, round(montant * (RATE if devise == 'MAD' else 1), 2)])

# ---------------------------------------------------------------- AMAL 1 (MAD)
w4 = openpyxl.load_workbook(f('04. [PRO] Suivi Projet Amal 1.xlsx'), data_only=True)
fixlot = lambda s: re.sub(r'Coté', 'Côté', clean(s))
loc_rows = [r for r in w4['Loc'].iter_rows(min_row=2, values_only=True) if r[0]]
lot_label = {}
for r in loc_rows:
    lot = fixlot(r[1]); lot_label[lot[:2]] = lot
for r in w4['+'].iter_rows(min_row=2, values_only=True):
    if r[7]: lot_label.setdefault(clean(r[7])[:2], fixlot(r[7]))
canon_lot = lambda s: lot_label.get(clean(s)[:2], fixlot(s)) if s else ''
canon_name = lambda s: re.sub(r'\s*\(Old\)\s*$', '', clean(s))
canon_name_fix = {'Soufiane BZIZ': 'Soufiane BAZIZ'}
cname = lambda s: canon_name_fix.get(canon_name(s), canon_name(s))

PLUS = {'Capital Mohamed': ('Apport en capital', 'Financement', 'Mohamed'), 'Capital Fatima': ('Apport en capital', 'Financement', 'Fatima'),
        'Prêt': ('Prêt reçu', 'Financement', None), 'Revenu locatif': ('Loyer', 'Courant', None),
        'Caution mois': ('Caution reçue', 'Financement', None), 'Caution Electricité': ('Caution reçue', 'Financement', None),
        'Elec / Eau': ('Charges refacturées', 'Courant', None), 'Ménage': ('Charges refacturées', 'Courant', None)}
cnt = collections.Counter()
for r in w4['+'].iter_rows(min_row=2, values_only=True):
    nat, typ, amt, date, _, _, loc, apt, com = (list(r) + [None] * 9)[:9]
    if typ not in PLUS: continue
    cat, nature, tiers = PLUS[typ]
    tiers = tiers or (cname(loc) if loc else clean(nat))
    detail = {'Elec / Eau': 'Eau & électricité', 'Ménage': 'Ménage', 'Caution Electricité': 'Caution électricité', 'Caution mois': 'Caution loyer'}.get(typ, '')
    sens = 'Revenu'
    if isinstance(amt, (int, float)) and amt < 0:
        amt = -amt; sens, cat, nature = 'Dépense', 'Distribution aux associés', 'Financement'
    ok = add_tx(date, 'Immobilier', sens, cat, clean(nat) or cat, amt, 'MAD', nature, tiers, canon_lot(apt), detail, clean(com))
    cnt['+'] += ok

MINUS = {'Administratif': 'Administratif', 'Agence location': 'Agence & commissions', 'Déplacement': 'Déplacements',
         'Remboursement prêt': 'Remboursement prêt', 'Facture Electricité / Eau': 'Eau & électricité', 'Bricolage': 'Entretien & bricolage',
         'Banque': 'Frais bancaires', 'Travaux': 'Travaux', 'Régularisation Locataire': 'Restitution caution', 'Taxes': 'Taxes',
         'Facture Ménage': 'Ménage'}
NAT_DEF = {'Travaux': 'Investissement', 'Remboursement prêt': 'Financement', 'Restitution caution': 'Financement'}
for r in w4['-'].iter_rows(min_row=2, values_only=True):
    nat, typ, amt, date, _, _, capex, opex, com, ttrav, mat = (list(r) + [None] * 11)[:11]
    if not typ: continue
    typ = clean(typ)
    if typ not in MINUS: continue
    cat = MINUS[typ]
    if clean(nat) == 'Acquisition': cat = 'Acquisition'
    nature = 'Investissement' if (capex or cat == 'Acquisition') else NAT_DEF.get(cat, 'Courant')
    note = ' · '.join(x for x in [clean(com), clean(mat)] if x)
    sens = 'Dépense'
    if isinstance(amt, (int, float)) and amt < 0:
        amt = -amt; sens = 'Revenu'
        cat, nature = ('Remboursement travaux', 'Investissement') if typ == 'Travaux' else ('Loyer', 'Courant')
        if typ != 'Travaux':   # remboursement de frais d'exploitation : on annule plutôt la charge
            sens, cat = 'Revenu', 'Charges refacturées'
    cnt['-'] += add_tx(date, 'Immobilier', sens, cat, clean(nat) or cat, amt, 'MAD', nature, '', '', clean(ttrav), note)
print("Amal: lignes + ", cnt['+'], " lignes - ", cnt['-'])

# Locataires / lots
TEN_H = ["ID","Lot","Locataire","Loyer (MAD)","Charges forfait (MAD)","Date entrée","Date sortie","Caution (MAD)","Contact","Métier","Note"]
LOT_H = ["ID","Code","Nom du lot","Loyer de référence (MAD)"]
charges_by_t = collections.defaultdict(lambda: collections.defaultdict(float))
for t in tx:
    if t[2] == 'Immobilier' and t[3] == 'Revenu' and t[4] == 'Charges refacturées':
        charges_by_t[t[12]][t[14]] += t[7]
tenants = []
for r in loc_rows:
    nom, apt, metier, contact, _, loyer, ent, sort, caution, _, com = (list(r) + [None] * 11)[:11]
    nm = cname(nom)
    active = sort is None or (isinstance(sort, datetime.datetime) and sort.date() >= TODAY)
    ch = 0
    if active and charges_by_t[nm]:
        months = sorted(charges_by_t[nm])[-4:-1] or sorted(charges_by_t[nm])[-1:]
        ch = round(sum(charges_by_t[nm][m] for m in months) / len(months) / 5) * 5
    tenants.append([None, fixlot(apt), nm, loyer or 0, ch, ent.date() if ent else None, sort.date() if sort else None,
                    caution or 0, clean(contact), clean(metier), clean(com)])
lots = []
for code in sorted(lot_label):
    ts = [t for t in tenants if t[1][:2] == code]
    act = [t for t in ts if t[6] is None or t[6] >= TODAY]
    ref = (act or ts)[-1][3] if ts else 0
    lots.append([None, code, lot_label[code], ref])

# Correction d'incohérences : une opération rattachée à un locataire dont le bail actif à cette date est sur un autre lot
fixed = 0
for t in tx:
    if t[2] != 'Immobilier' or not t[12] or not t[13] or t[4] not in ('Loyer', 'Charges refacturées'): continue
    d = t[1]
    cands = [tn for tn in tenants if tn[2] == t[12] and (tn[5] is None or tn[5] <= d) and (tn[6] is None or tn[6] >= d)]
    if cands and all(tn[1] != t[13] for tn in cands):
        old = t[13]; t[13] = cands[0][1]; t[16] = (t[16] + ' · ' if t[16] else '') + f"Lot corrigé à l'import (était : {old})"; fixed += 1
print("Opérations de loyer rattachées au bon lot :", fixed)

# ---------------------------------------------------------------- FREELANCE (fichier 03)
CLI_H = ["ID","Client","Devise","TJM","TVA","Compte dans la micro (Oui/Non)","Note"]
INV_H = ["ID","N° facture","Client","Période","Jours","TJM","Devise","Montant HT","TVA","Montant TTC","Date facture","Statut","Date paiement","Note"]
clients = [[None, 'Talan (Givenchy)', 'EUR', 810, 0.2, 'Oui', ''], [None, 'Algofi (OCP)', 'MAD', 3600, 0, 'Non', '']]
w3 = openpyxl.load_workbook(f('03. [PRO] Suivi Entreprise.xlsx'), data_only=True)
ws = w3['Projection Fin 27']
cols = []   # (col, period)
for c in range(2, 21):
    v = ws.cell(1, c).value
    if isinstance(v, datetime.datetime): cols.append((c, v.strftime('%Y-%m')))
paid_dates = {'2026-08': datetime.date(2026, 8, 28), '2026-09': datetime.date(2026, 9, 30), '2026-10': datetime.date(2026, 10, 31)}
invoices = []; seq = collections.Counter()
def last_day(period):
    y, m = map(int, period.split('-')); nxt = datetime.date(y + (m == 12), m % 12 + 1, 1)
    return nxt - datetime.timedelta(days=1)
for row, client, devise, tjm in ((3, 'Talan (Givenchy)', 'EUR', 810), (9, 'Algofi (OCP)', 'MAD', 3600)):
    for c, per in cols:
        jours = ws.cell(row, c).value
        if not isinstance(jours, (int, float)) or jours <= 0: continue
        tva = 0.2 if (client.startswith('Talan') and per >= '2027-01') else 0
        ht = jours * tjm
        statut, paiement = ('Payée', paid_dates[per]) if (client.startswith('Talan') and per in paid_dates) else ('Planifiée', None)
        seq[per[:4]] += 1
        invoices.append([None, '', client, per, jours, tjm, devise, ht, tva, round(ht * (1 + tva), 2),
                         last_day(per) if statut == 'Payée' else None, statut, paiement,
                         'Importée du fichier Suivi Entreprise' + (' — marquée payée car le virement apparaît dans ton PnL' if statut == 'Payée' else '')])
invoices.sort(key=lambda r: (r[3], r[2]))
cn = collections.Counter()
for r in invoices:
    cn[r[3][:4]] += 1; r[1] = f"F-{r[3][:4]}-{cn[r[3][:4]]:03d}"

# ---------------------------------------------------------------- Récurrents (détectés)
REC_H = ["ID","Libellé","Activité","Sens","Catégorie","Montant","Devise","Jour du mois","Début","Fin","Actif (Oui/Non)","Nature","Tiers","Lot"]
# Récurrents proposés d'après la stabilité des montants 2026 (démarrent en décembre : l'historique est déjà saisi)
SEED_REC = [("Loyer (InLi)", "Loyer", 1218.26, 10), ("EDF", "Charges", 54.00, 12), ("Navigo", "Transports en Commun", 90.80, 1),
            ("Mutuelle santé", "Assurance Santé", 12.02, 10), ("Internet Bouygues", "Internet", 23.99, 20), ("Forfait mobile", "Mobile", 8.99, 12),
            ("Assurance habitation", "Assurance Habitation", 12.85, 5), ("Basic-Fit", "Activité Sportive", 34.99, 5), ("Frais bancaires", "Frais Bancaires", 3.00, 26)]
recs = [[None, lib, 'Perso', 'Dépense', cat, amt, 'EUR', day, datetime.date(2026, 12, 1), None, 'Oui', 'Courant', '', ''] for lib, cat, amt, day in SEED_REC]
print("Récurrents proposés:", len(recs))

# ---------------------------------------------------------------- écriture
wb = openpyxl.Workbook(); wb.remove(wb.active)
def sheet(name, header, rows):
    ws = wb.create_sheet(name); ws.append(header)
    for r in rows: ws.append(r)
sheet('Transactions', TX_H, tx); sheet('Lots', LOT_H, lots); sheet('Locataires', TEN_H, tenants)
sheet('Clients', CLI_H, clients); sheet('Factures', INV_H, invoices); sheet('Récurrents', REC_H, recs)
sheet('Comptes', ["ID","Compte","Devise","Disponible (Oui/Non)","Ordre"], ACC)
sheet('Relevés', ["ID","Date","Compte","Solde","Devise","Solde EUR"], SNAP)
wb.save(OUT)

# ---------------------------------------------------------------- contrôles
tot = collections.defaultdict(float)
for t in tx: tot[(t[2], t[3], t[11])] += t[7]
print("Totaux par (activité, sens, nature):")
for k, v in sorted(tot.items()): print("  ", k, round(v))
imm = sum((t[7] if t[3] == 'Revenu' else -t[7]) for t in tx if t[2] == 'Immobilier')
print("Trésorerie Amal 1 (tous flux, MAD):", round(imm), "| lignes totales:", len(tx))
