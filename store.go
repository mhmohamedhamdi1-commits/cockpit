package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/xuri/excelize/v2"
)

// ---------------------------------------------------------------------------
// Codec Excel <-> structs (réflexion sur les tags x / k / w)
// ---------------------------------------------------------------------------

type colSpec struct {
	idx  int
	name string
	kind string
	w    float64
}

func specsOf(t reflect.Type) []colSpec {
	var out []colSpec
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		name := f.Tag.Get("x")
		if name == "" {
			continue
		}
		w, _ := strconv.ParseFloat(f.Tag.Get("w"), 64)
		if w == 0 {
			w = 14
		}
		out = append(out, colSpec{i, name, f.Tag.Get("k"), w})
	}
	return out
}

func parseDate(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if f, err := strconv.ParseFloat(s, 64); err == nil && f > 20000 && f < 80000 {
		if t, err := excelize.ExcelDateToTime(f, false); err == nil {
			return t.Format("2006-01-02")
		}
	}
	for _, l := range []string{"2006-01-02", "2006-01-02T15:04:05Z", "2006-01-02 15:04:05", "02/01/2006", "2/1/2006", "02/01/06", "02-01-2006", "2006/01/02"} {
		if t, err := time.Parse(l, s); err == nil {
			return t.Format("2006-01-02")
		}
	}
	return ""
}

func parseNum(s string) float64 {
	s = strings.TrimSpace(strings.NewReplacer(" ", "", "\u00a0", "", "\u202f", "").Replace(s))
	if s == "" {
		return 0
	}
	s = strings.ReplaceAll(s, ",", ".")
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
		return 0
	}
	return f
}

// readSheet lit un onglet dans une slice de structs (pointeur vers slice).
func readSheet(f *excelize.File, sheet string, out any) error {
	rows, err := f.GetRows(sheet, excelize.Options{RawCellValue: true})
	if err != nil || len(rows) == 0 {
		return nil // onglet absent ou vide : on laisse la slice vide
	}
	sv := reflect.ValueOf(out).Elem()
	et := sv.Type().Elem()
	specs := specsOf(et)
	hdr := map[string]int{}
	for i, h := range rows[0] {
		hdr[strings.TrimSpace(h)] = i
	}
	for _, r := range rows[1:] {
		empty := true
		for _, c := range r {
			if strings.TrimSpace(c) != "" {
				empty = false
				break
			}
		}
		if empty {
			continue
		}
		item := reflect.New(et).Elem()
		for _, sp := range specs {
			ci, ok := hdr[sp.name]
			if !ok || ci >= len(r) {
				continue
			}
			raw := r[ci]
			fv := item.Field(sp.idx)
			switch fv.Kind() {
			case reflect.String:
				if sp.kind == "date" {
					fv.SetString(parseDate(raw))
				} else {
					fv.SetString(strings.TrimSpace(raw))
				}
			case reflect.Int:
				fv.SetInt(int64(math.Round(parseNum(raw))))
			case reflect.Float64:
				fv.SetFloat(parseNum(raw))
			}
		}
		sv.Set(reflect.Append(sv, item))
	}
	return nil
}

type styleSet struct{ head, date, money, rate, intg int }

func newStyles(f *excelize.File) styleSet {
	head, _ := f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Color: "FFFFFF", Size: 11},
		Fill:      excelize.Fill{Type: "pattern", Color: []string{"1F2937"}, Pattern: 1},
		Alignment: &excelize.Alignment{Vertical: "center", WrapText: false},
	})
	dfmt := "dd/mm/yyyy"
	date, _ := f.NewStyle(&excelize.Style{CustomNumFmt: &dfmt, Alignment: &excelize.Alignment{Horizontal: "left"}})
	mfmt := "#,##0.00"
	money, _ := f.NewStyle(&excelize.Style{CustomNumFmt: &mfmt})
	rfmt := "0.0000"
	rate, _ := f.NewStyle(&excelize.Style{CustomNumFmt: &rfmt})
	ifmt := "0"
	intg, _ := f.NewStyle(&excelize.Style{CustomNumFmt: &ifmt, Alignment: &excelize.Alignment{Horizontal: "left"}})
	return styleSet{head, date, money, rate, intg}
}

func excelSerial(t time.Time) float64 {
	base := time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC)
	d := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	return math.Round(d.Sub(base).Hours() / 24)
}

func colName(i int) string { n, _ := excelize.ColumnNumberToName(i + 1); return n }

// writeSheet écrit une slice de structs (valeur) dans un onglet, mis en forme.
func writeSheet(f *excelize.File, sheet string, items any, st styleSet, tableName string) error {
	if _, err := f.NewSheet(sheet); err != nil {
		return err
	}
	sv := reflect.ValueOf(items)
	specs := specsOf(sv.Type().Elem())
	for ci, sp := range specs {
		cell, _ := excelize.CoordinatesToCellName(ci+1, 1)
		f.SetCellValue(sheet, cell, sp.name)
		f.SetColWidth(sheet, colName(ci), colName(ci), sp.w)
	}
	f.SetRowHeight(sheet, 1, 22)
	n := sv.Len()
	for ri := 0; ri < n; ri++ {
		item := sv.Index(ri)
		for ci, sp := range specs {
			cell, _ := excelize.CoordinatesToCellName(ci+1, ri+2)
			fv := item.Field(sp.idx)
			switch fv.Kind() {
			case reflect.String:
				s := fv.String()
				if sp.kind == "date" {
					if t, err := time.Parse("2006-01-02", s); err == nil {
						f.SetCellValue(sheet, cell, excelSerial(t))
					}
				} else if s != "" {
					f.SetCellValue(sheet, cell, s)
				}
			case reflect.Int:
				f.SetCellValue(sheet, cell, fv.Int())
			case reflect.Float64:
				f.SetCellValue(sheet, cell, fv.Float())
			}
		}
	}
	lastCol := len(specs)
	hs, _ := excelize.CoordinatesToCellName(1, 1)
	he, _ := excelize.CoordinatesToCellName(lastCol, 1)
	f.SetCellStyle(sheet, hs, he, st.head)
	if n > 0 {
		for ci, sp := range specs {
			style := 0
			switch sp.kind {
			case "date":
				style = st.date
			case "money":
				style = st.money
			case "rate":
				style = st.rate
			case "int":
				style = st.intg
			}
			if style != 0 {
				a, _ := excelize.CoordinatesToCellName(ci+1, 2)
				b, _ := excelize.CoordinatesToCellName(ci+1, n+1)
				f.SetCellStyle(sheet, a, b, style)
			}
		}
		end, _ := excelize.CoordinatesToCellName(lastCol, n+1)
		show := true
		if err := f.AddTable(sheet, &excelize.Table{
			Range: "A1:" + end, Name: tableName, StyleName: "TableStyleLight1",
			ShowRowStripes: &show,
		}); err != nil {
			f.AutoFilter(sheet, "A1:"+end, nil)
		}
	}
	f.SetPanes(sheet, &excelize.Panes{Freeze: true, Split: true, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft"})
	return nil
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type Store struct {
	mu    sync.Mutex
	path  string
	mtime time.Time
	D     Data
}

func OpenStore(path string) (*Store, error) {
	s := &Store{path: path}
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		s.D = Data{}
		s.fillDefaults()
		if err := s.save(); err != nil {
			return nil, err
		}
		return s, nil
	}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) fillDefaults() {
	if len(s.D.Categories) == 0 {
		s.D.Categories = seedCategories()
	}
	have := map[string]bool{}
	for _, p := range s.D.Params {
		have[p.Cle] = true
	}
	for _, p := range defaultParams {
		if !have[p.Cle] {
			s.D.Params = append(s.D.Params, p)
		}
	}
	if len(s.D.Accounts) == 0 {
		for i, a := range []Account{
			{Nom: "Compte courant", Devise: "EUR", Dispo: "Oui"},
			{Nom: "Épargne", Devise: "EUR", Dispo: "Oui"},
		} {
			a.ID = i + 1
			a.Ordre = i + 1
			s.D.Accounts = append(s.D.Accounts, a)
		}
	}
}

func (s *Store) load() error {
	f, err := excelize.OpenFile(s.path)
	if err != nil {
		return fmt.Errorf("lecture de %s impossible : %w", filepath.Base(s.path), err)
	}
	defer f.Close()
	var d Data
	for _, step := range []struct {
		sh  string
		out any
	}{
		{shTx, &d.Tx}, {shCat, &d.Categories}, {shLots, &d.Lots}, {shTen, &d.Tenants},
		{shCli, &d.Clients}, {shInv, &d.Invoices}, {shRec, &d.Recurring},
		{shAcc, &d.Accounts}, {shSnap, &d.Snapshots}, {shParam, &d.Params},
	} {
		if err := readSheet(f, step.sh, step.out); err != nil {
			return err
		}
	}
	s.D = d
	s.fillDefaults()
	s.assignMissingIDs()
	s.normalizeLoaded()
	if st, err := os.Stat(s.path); err == nil {
		s.mtime = st.ModTime()
	}
	return nil
}

func (s *Store) assignMissingIDs() {
	fix := func(get func(i int) *int, n int) {
		max := 0
		for i := 0; i < n; i++ {
			if v := *get(i); v > max {
				max = v
			}
		}
		for i := 0; i < n; i++ {
			if *get(i) == 0 {
				max++
				*get(i) = max
			}
		}
	}
	fix(func(i int) *int { return &s.D.Tx[i].ID }, len(s.D.Tx))
	fix(func(i int) *int { return &s.D.Lots[i].ID }, len(s.D.Lots))
	fix(func(i int) *int { return &s.D.Tenants[i].ID }, len(s.D.Tenants))
	fix(func(i int) *int { return &s.D.Clients[i].ID }, len(s.D.Clients))
	fix(func(i int) *int { return &s.D.Invoices[i].ID }, len(s.D.Invoices))
	fix(func(i int) *int { return &s.D.Recurring[i].ID }, len(s.D.Recurring))
	fix(func(i int) *int { return &s.D.Accounts[i].ID }, len(s.D.Accounts))
	fix(func(i int) *int { return &s.D.Snapshots[i].ID }, len(s.D.Snapshots))
}

// ReloadIfChanged recharge le fichier si il a été modifié en dehors de l'appli (Excel).
func (s *Store) ReloadIfChanged() {
	st, err := os.Stat(s.path)
	if err != nil || st.ModTime().Equal(s.mtime) {
		return
	}
	_ = s.load() // en cas d'erreur (fichier en cours d'écriture), on garde la mémoire
}

func (s *Store) save() error {
	f := excelize.NewFile()
	defer f.Close()
	st := newStyles(f)
	sort.SliceStable(s.D.Tx, func(i, j int) bool {
		if s.D.Tx[i].Date != s.D.Tx[j].Date {
			return s.D.Tx[i].Date < s.D.Tx[j].Date
		}
		return s.D.Tx[i].ID < s.D.Tx[j].ID
	})
	for _, step := range []struct {
		sh, tbl string
		items   any
	}{
		{shTx, "tblTransactions", s.D.Tx}, {shCat, "tblCategories", s.D.Categories},
		{shLots, "tblLots", s.D.Lots}, {shTen, "tblLocataires", s.D.Tenants},
		{shCli, "tblClients", s.D.Clients}, {shInv, "tblFactures", s.D.Invoices},
		{shRec, "tblRecurrents", s.D.Recurring}, {shAcc, "tblComptes", s.D.Accounts},
		{shSnap, "tblReleves", s.D.Snapshots}, {shParam, "tblParametres", s.D.Params},
	} {
		if err := writeSheet(f, step.sh, step.items, st, step.tbl); err != nil {
			return err
		}
	}
	// Lisez-moi
	f.NewSheet(shRead)
	lines := []string{
		"COCKPIT — fichier de données",
		"",
		"Ce classeur est la base de données de l'application Cockpit (Finances.exe).",
		"Tu peux l'ouvrir dans Excel pour filtrer, faire un tableau croisé dynamique ou corriger une ligne.",
		"Ferme-le dans Excel avant d'enregistrer depuis l'application (sinon Windows bloque l'écriture).",
		"",
		"Ne renomme pas les onglets et les en-têtes de colonnes : l'application les relit tels quels.",
		"Montants toujours positifs : la colonne Sens (Revenu / Dépense) indique le signe.",
		"Nature : Courant (compte dans le résultat) · Investissement (bourse, immobilier, travaux) · Financement (apports, prêts, cautions : hors résultat).",
		"Les sauvegardes automatiques sont dans le dossier « Sauvegardes ».",
	}
	for i, l := range lines {
		c, _ := excelize.CoordinatesToCellName(1, i+1)
		f.SetCellValue(shRead, c, l)
	}
	f.SetColWidth(shRead, "A", "A", 120)
	f.DeleteSheet("Sheet1")
	f.SetActiveSheet(0)

	tmp := strings.TrimSuffix(s.path, ".xlsx") + ".tmp.xlsx"
	if err := f.SaveAs(tmp); err != nil {
		return fmt.Errorf("écriture impossible : %w", err)
	}
	// OneDrive / l'antivirus peuvent verrouiller le fichier un instant : quelques tentatives avant d'abandonner.
	var rerr error
	for i := 0; i < 10; i++ {
		if rerr = os.Rename(tmp, s.path); rerr == nil {
			break
		}
		time.Sleep(250 * time.Millisecond)
	}
	if rerr != nil {
		os.Remove(tmp)
		return fmt.Errorf("le fichier %s est ouvert dans Excel (ou verrouillé) — ferme-le dans Excel puis réessaie", filepath.Base(s.path))
	}
	if st, err := os.Stat(s.path); err == nil {
		s.mtime = st.ModTime()
	}
	return nil
}

// Snapshot en mémoire pour annuler une mutation si l'écriture échoue.
func (s *Store) clone() Data {
	b, _ := json.Marshal(s.D)
	var d Data
	json.Unmarshal(b, &d)
	return d
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

func (s *Store) Backup(dir string, force bool) (string, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	base := strings.TrimSuffix(filepath.Base(s.path), filepath.Ext(s.path))
	day := time.Now().Format("20060102")
	if !force {
		if m, _ := filepath.Glob(filepath.Join(dir, base+"_"+day+"*.xlsx")); len(m) > 0 {
			return "", nil // déjà sauvegardé aujourd'hui
		}
	}
	dst := filepath.Join(dir, fmt.Sprintf("%s_%s.xlsx", base, time.Now().Format("20060102_150405")))
	in, err := os.Open(s.path)
	if err != nil {
		return "", err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return "", err
	}
	out.Close()
	// conserver les 40 plus récentes
	all, _ := filepath.Glob(filepath.Join(dir, base+"_*.xlsx"))
	sort.Strings(all)
	for len(all) > 40 {
		os.Remove(all[0])
		all = all[1:]
	}
	return dst, nil
}

// normalizeLoaded complète les champs calculés des lignes saisies à la main dans Excel
// (devise, taux, montant en euros, nature, période, TTC, solde en euros).
func (s *Store) normalizeLoaded() {
	rate := s.param("taux_mad_eur", 0.093)
	for i := range s.D.Tx {
		t := &s.D.Tx[i]
		if t.Devise != "MAD" {
			t.Devise = "EUR"
		}
		if t.Taux <= 0 {
			if t.Devise == "MAD" {
				t.Taux = rate
			} else {
				t.Taux = 1
			}
		}
		if t.MontantEUR == 0 && t.Montant != 0 {
			t.MontantEUR = round2(t.Montant * t.Taux)
		}
		if t.Nature == "" {
			if c := s.categoryOf(t.Activite, t.Sens, t.Categorie); c != nil {
				t.Nature = c.Nature
			} else {
				t.Nature = "Courant"
			}
		}
		if t.Periode == "" && len(t.Date) >= 7 {
			t.Periode = t.Date[:7]
		}
		if t.Montant < 0 { // montants toujours positifs : le sens porte le signe
			t.Montant, t.MontantEUR = -t.Montant, -t.MontantEUR
			if t.Sens == "Revenu" {
				t.Sens = "Dépense"
			} else {
				t.Sens = "Revenu"
			}
		}
	}
	for i := range s.D.Invoices {
		v := &s.D.Invoices[i]
		if v.HT == 0 {
			v.HT = round2(v.Jours * v.TJM)
		}
		if v.TTC == 0 {
			v.TTC = round2(v.HT * (1 + v.TVA))
		}
		if v.Devise != "MAD" {
			v.Devise = "EUR"
		}
		if v.Statut == "" {
			v.Statut = "Planifiée"
		}
	}
	for i := range s.D.Snapshots {
		v := &s.D.Snapshots[i]
		if v.Devise != "MAD" {
			v.Devise = "EUR"
		}
		if v.SoldeEUR == 0 && v.Solde != 0 {
			if v.Devise == "MAD" {
				v.SoldeEUR = round2(v.Solde * rate)
			} else {
				v.SoldeEUR = v.Solde
			}
		}
	}
}
