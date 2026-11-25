package main

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

type idHolder interface{ id() *int }

func round2(v float64) float64 { return math.Round(v*100) / 100 }

func (s *Store) param(key string, def float64) float64 {
	for _, p := range s.D.Params {
		if p.Cle == key {
			if v, err := strconv.ParseFloat(strings.ReplaceAll(p.Valeur, ",", "."), 64); err == nil {
				return v
			}
		}
	}
	return def
}

func upsertSlice[T any, PT interface {
	*T
	idHolder
}](dst *[]T, raw json.RawMessage, fix func(*T) error) (int, error) {
	var item T
	if err := json.Unmarshal(raw, &item); err != nil {
		return 0, err
	}
	p := PT(&item)
	if fix != nil {
		if err := fix(&item); err != nil {
			return 0, err
		}
	}
	id := *p.id()
	if id > 0 {
		for i := range *dst {
			if *PT(&(*dst)[i]).id() == id {
				(*dst)[i] = item
				return id, nil
			}
		}
	} else {
		max := 0
		for i := range *dst {
			if v := *PT(&(*dst)[i]).id(); v > max {
				max = v
			}
		}
		id = max + 1
		*p.id() = id
	}
	*dst = append(*dst, item)
	return id, nil
}

func deleteByID[T any, PT interface {
	*T
	idHolder
}](dst *[]T, id int) {
	out := (*dst)[:0]
	for i := range *dst {
		if *PT(&(*dst)[i]).id() != id {
			out = append(out, (*dst)[i])
		}
	}
	*dst = out
}

// ---- normalisation des transactions -------------------------------------

func (s *Store) categoryOf(act, sens, cat string) *Category {
	for i := range s.D.Categories {
		c := &s.D.Categories[i]
		if c.Activite == act && c.Sens == sens && c.Categorie == cat {
			return c
		}
	}
	return nil
}

func (s *Store) fixTx(t *Tx) error {
	if _, err := time.Parse("2006-01-02", t.Date); err != nil {
		return fmt.Errorf("date invalide")
	}
	if t.Montant <= 0 || math.IsNaN(t.Montant) || math.IsInf(t.Montant, 0) {
		return fmt.Errorf("le montant doit être supérieur à 0")
	}
	switch t.Activite {
	case "Perso", "Freelance", "Immobilier":
	default:
		return fmt.Errorf("activité invalide")
	}
	if t.Sens != "Revenu" && t.Sens != "Dépense" {
		return fmt.Errorf("sens invalide")
	}
	if strings.TrimSpace(t.Categorie) == "" {
		return fmt.Errorf("choisis une catégorie")
	}
	t.Montant = round2(t.Montant)
	if t.Devise != "MAD" {
		t.Devise = "EUR"
	}
	if t.Devise == "EUR" {
		t.Taux = 1
	} else if t.Taux <= 0 || t.Taux == 1 {
		t.Taux = s.param("taux_mad_eur", 0.093)
	}
	t.MontantEUR = round2(t.Montant * t.Taux)
	if t.Nature == "" {
		if c := s.categoryOf(t.Activite, t.Sens, t.Categorie); c != nil {
			t.Nature = c.Nature
		} else {
			t.Nature = "Courant"
		}
	}
	if t.Periode == "" {
		t.Periode = t.Date[:7]
	}
	t.Libelle = strings.TrimSpace(t.Libelle)
	return nil
}

func (s *Store) fixInvoice(v *Invoice) error {
	if v.Client == "" {
		return fmt.Errorf("choisis un client")
	}
	if len(v.Periode) != 7 {
		return fmt.Errorf("période invalide (AAAA-MM)")
	}
	if v.Devise != "MAD" {
		v.Devise = "EUR"
	}
	if v.HT == 0 {
		v.HT = v.Jours * v.TJM
	}
	v.HT = round2(v.HT)
	v.TTC = round2(v.HT * (1 + v.TVA))
	switch v.Statut {
	case "Planifiée", "Envoyée", "Payée":
	default:
		v.Statut = "Planifiée"
	}
	if v.Numero == "" {
		year := v.Periode[:4]
		if len(v.Emission) >= 4 {
			year = v.Emission[:4]
		}
		n := 1
		for _, o := range s.D.Invoices {
			if strings.HasPrefix(o.Numero, "F-"+year+"-") {
				if k, err := strconv.Atoi(o.Numero[len("F-"+year+"-"):]); err == nil && k >= n {
					n = k + 1
				}
			}
		}
		v.Numero = fmt.Sprintf("F-%s-%03d", year, n)
	}
	return nil
}

func (s *Store) fixSnapshot(v *Snapshot) error {
	if _, err := time.Parse("2006-01-02", v.Date); err != nil {
		return fmt.Errorf("date invalide")
	}
	if v.Devise != "MAD" {
		v.Devise = "EUR"
	}
	rate := 1.0
	if v.Devise == "MAD" {
		rate = s.param("taux_mad_eur", 0.093)
	}
	v.SoldeEUR = round2(v.Solde * rate)
	return nil
}

// ---- opérations -------------------------------------------------------

type Op struct {
	E    string          `json:"e"`
	Op   string          `json:"op"`
	Item json.RawMessage `json:"item"`
	ID   int             `json:"id"`
	Key  string          `json:"key"`
}

func (s *Store) applyOp(o Op) error {
	switch o.E {
	case "tx":
		if o.Op == "delete" {
			deleteByID(&s.D.Tx, o.ID)
			return nil
		}
		_, err := upsertSlice(&s.D.Tx, o.Item, func(t *Tx) error { return s.fixTx(t) })
		return err
	case "lot":
		if o.Op == "delete" {
			deleteByID(&s.D.Lots, o.ID)
			return nil
		}
		_, err := upsertSlice(&s.D.Lots, o.Item, nil)
		return err
	case "tenant":
		if o.Op == "delete" {
			deleteByID(&s.D.Tenants, o.ID)
			return nil
		}
		_, err := upsertSlice(&s.D.Tenants, o.Item, func(t *Tenant) error {
			if strings.TrimSpace(t.Nom) == "" || t.Lot == "" {
				return fmt.Errorf("nom et lot obligatoires")
			}
			return nil
		})
		return err
	case "client":
		if o.Op == "delete" {
			deleteByID(&s.D.Clients, o.ID)
			return nil
		}
		_, err := upsertSlice(&s.D.Clients, o.Item, func(t *Client) error {
			if strings.TrimSpace(t.Nom) == "" {
				return fmt.Errorf("nom du client obligatoire")
			}
			if t.Devise != "MAD" {
				t.Devise = "EUR"
			}
			return nil
		})
		return err
	case "invoice":
		if o.Op == "delete" {
			deleteByID(&s.D.Invoices, o.ID)
			return nil
		}
		_, err := upsertSlice(&s.D.Invoices, o.Item, func(t *Invoice) error { return s.fixInvoice(t) })
		return err
	case "recurring":
		if o.Op == "delete" {
			deleteByID(&s.D.Recurring, o.ID)
			return nil
		}
		_, err := upsertSlice(&s.D.Recurring, o.Item, func(t *Recurring) error {
			if t.Montant <= 0 || t.Categorie == "" || strings.TrimSpace(t.Libelle) == "" {
				return fmt.Errorf("libellé, catégorie et montant obligatoires")
			}
			if t.Jour < 1 || t.Jour > 31 {
				t.Jour = 1
			}
			if t.Actif != "Non" {
				t.Actif = "Oui"
			}
			if t.Devise != "MAD" {
				t.Devise = "EUR"
			}
			return nil
		})
		return err
	case "account":
		if o.Op == "delete" {
			deleteByID(&s.D.Accounts, o.ID)
			return nil
		}
		_, err := upsertSlice(&s.D.Accounts, o.Item, func(t *Account) error {
			if strings.TrimSpace(t.Nom) == "" {
				return fmt.Errorf("nom du compte obligatoire")
			}
			if t.Devise != "MAD" {
				t.Devise = "EUR"
			}
			return nil
		})
		return err
	case "snapshot":
		if o.Op == "delete" {
			deleteByID(&s.D.Snapshots, o.ID)
			return nil
		}
		_, err := upsertSlice(&s.D.Snapshots, o.Item, func(t *Snapshot) error { return s.fixSnapshot(t) })
		return err
	case "param":
		var p Param
		if err := json.Unmarshal(o.Item, &p); err != nil {
			return err
		}
		for i := range s.D.Params {
			if s.D.Params[i].Cle == p.Cle {
				s.D.Params[i].Valeur = p.Valeur
				return nil
			}
		}
		s.D.Params = append(s.D.Params, p)
		return nil
	case "category":
		var c Category
		if err := json.Unmarshal(o.Item, &c); err != nil {
			return err
		}
		if c.Categorie == "" || c.Activite == "" || c.Sens == "" {
			return fmt.Errorf("catégorie incomplète")
		}
		if o.Op == "delete" {
			out := s.D.Categories[:0]
			for _, x := range s.D.Categories {
				if !(x.Activite == c.Activite && x.Sens == c.Sens && x.Categorie == c.Categorie) {
					out = append(out, x)
				}
			}
			s.D.Categories = out
			return nil
		}
		if c.Nature == "" {
			c.Nature = "Courant"
		}
		if c.Icone == "" {
			c.Icone = "•"
		}
		for i, x := range s.D.Categories {
			if x.Activite == c.Activite && x.Sens == c.Sens && x.Categorie == c.Categorie {
				s.D.Categories[i] = c
				return nil
			}
		}
		s.D.Categories = append(s.D.Categories, c)
		return nil
	case "action":
		return s.applyAction(o.Key, o.Item)
	}
	return fmt.Errorf("opération inconnue : %s", o.E)
}

func (s *Store) applyAction(name string, raw json.RawMessage) error {
	switch name {
	case "generate_recurring":
		var a struct {
			Month string `json:"month"`
		}
		if err := json.Unmarshal(raw, &a); err != nil || len(a.Month) != 7 {
			return fmt.Errorf("mois invalide")
		}
		first, err := time.Parse("2006-01", a.Month)
		if err != nil {
			return fmt.Errorf("mois invalide")
		}
		last := first.AddDate(0, 1, -1)
		have := map[string]bool{}
		for _, t := range s.D.Tx {
			if t.Ref != "" {
				have[t.Ref] = true
			}
		}
		for _, r := range s.D.Recurring {
			if r.Actif == "Non" {
				continue
			}
			if r.Debut != "" && r.Debut > last.Format("2006-01-02") {
				continue
			}
			if r.Fin != "" && r.Fin < first.Format("2006-01-02") {
				continue
			}
			ref := fmt.Sprintf("REC%d:%s", r.ID, a.Month)
			if have[ref] {
				continue
			}
			day := r.Jour
			if day > last.Day() {
				day = last.Day()
			}
			t := Tx{
				Date: fmt.Sprintf("%s-%02d", a.Month, day), Activite: r.Activite, Sens: r.Sens,
				Categorie: r.Categorie, Libelle: r.Libelle, Montant: r.Montant, Devise: r.Devise,
				Nature: r.Nature, Tiers: r.Tiers, Lot: r.Lot, Ref: ref,
			}
			if err := s.fixTx(&t); err != nil {
				return fmt.Errorf("récurrent « %s » : %v", r.Libelle, err)
			}
			max := 0
			for _, x := range s.D.Tx {
				if x.ID > max {
					max = x.ID
				}
			}
			t.ID = max + 1
			s.D.Tx = append(s.D.Tx, t)
		}
		return nil
	case "recompute_rates":
		rate := s.param("taux_mad_eur", 0.093)
		for i := range s.D.Tx {
			if s.D.Tx[i].Devise == "MAD" {
				s.D.Tx[i].Taux = rate
				s.D.Tx[i].MontantEUR = round2(s.D.Tx[i].Montant * rate)
			}
		}
		for i := range s.D.Snapshots {
			if s.D.Snapshots[i].Devise == "MAD" {
				s.D.Snapshots[i].SoldeEUR = round2(s.D.Snapshots[i].Solde * rate)
			}
		}
		return nil
	}
	return fmt.Errorf("action inconnue : %s", name)
}

// Apply exécute un lot d'opérations puis écrit le fichier (une seule fois).
// En cas d'erreur, l'état en mémoire est restauré.
func (s *Store) Apply(ops []Op) error {
	backup := s.clone()
	for _, o := range ops {
		if err := s.applyOp(o); err != nil {
			s.D = backup
			return err
		}
	}
	if err := s.save(); err != nil {
		s.D = backup
		return err
	}
	return nil
}
