package main

import (
	"encoding/json"
	"path/filepath"
	"testing"
)

func raw(v any) json.RawMessage { b, _ := json.Marshal(v); return b }

func TestRoundTrip(t *testing.T) {
	p := filepath.Join(t.TempDir(), "d.xlsx")
	s, err := OpenStore(p)
	if err != nil {
		t.Fatal(err)
	}
	err = s.Apply([]Op{
		{E: "tx", Item: raw(Tx{Date: "2026-11-24", Activite: "Perso", Sens: "Dépense", Categorie: "Café", Libelle: "Café é€ \"x\"", Montant: 3.5})},
		{E: "tx", Item: raw(Tx{Date: "2026-11-25", Activite: "Immobilier", Sens: "Revenu", Categorie: "Loyer", Montant: 2000, Devise: "MAD", Lot: "11. 1er étage"})},
		{E: "invoice", Item: raw(Invoice{Client: "Talan", Periode: "2026-12", Jours: 22, TJM: 810, TVA: 0.2, Devise: "EUR"})},
		{E: "recurring", Item: raw(Recurring{Libelle: "Loyer", Activite: "Perso", Sens: "Dépense", Categorie: "Loyer", Montant: 1000, Jour: 31})},
		{E: "action", Key: "generate_recurring", Item: raw(map[string]string{"month": "2026-02"})},
		{E: "action", Key: "generate_recurring", Item: raw(map[string]string{"month": "2026-02"})}, // idempotent
	})
	if err != nil {
		t.Fatal(err)
	}
	s2, err := OpenStore(p)
	if err != nil {
		t.Fatal(err)
	}
	if len(s2.D.Tx) != 3 {
		t.Fatalf("tx = %d", len(s2.D.Tx))
	}
	var rec, cafe, loyer *Tx
	for i := range s2.D.Tx {
		x := &s2.D.Tx[i]
		switch {
		case x.Ref != "":
			rec = x
		case x.Categorie == "Café":
			cafe = x
		default:
			loyer = x
		}
	}
	if cafe == nil || cafe.Montant != 3.5 || cafe.Date != "2026-11-24" || cafe.Libelle != "Café é€ \"x\"" || cafe.Nature != "Courant" {
		t.Fatalf("cafe: %+v", cafe)
	}
	if loyer == nil || loyer.MontantEUR != 186 || loyer.Taux != 0.093 || loyer.Periode != "2026-11" {
		t.Fatalf("loyer: %+v", loyer)
	}
	if rec == nil || rec.Date != "2026-02-28" {
		t.Fatalf("rec: %+v", rec)
	}
	if len(s2.D.Invoices) != 1 || s2.D.Invoices[0].HT != 17820 || s2.D.Invoices[0].TTC != 21384 || s2.D.Invoices[0].Numero != "F-2026-001" {
		t.Fatalf("invoice: %+v", s2.D.Invoices)
	}
	if len(s2.D.Categories) < 30 || len(s2.D.Params) < 8 {
		t.Fatalf("defaults missing")
	}
	// rollback si erreur
	err = s2.Apply([]Op{{E: "tx", Item: raw(Tx{Date: "2026-11-24", Activite: "Perso", Sens: "Dépense", Categorie: "Café", Montant: 1})}, {E: "tx", Item: raw(Tx{Date: "bad"})}})
	if err == nil || len(s2.D.Tx) != 3 {
		t.Fatalf("rollback failed: %v %d", err, len(s2.D.Tx))
	}
}
