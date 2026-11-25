package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"
)

//go:embed web
var webFS embed.FS

const dataFile = "Finances_Data.xlsx"

var (
	store    *Store
	token    string
	lastPing atomic.Int64
	byeAt    atomic.Int64
	baseDir  string
	port     int
)

func fatal(msg string) {
	_ = os.WriteFile(filepath.Join(baseDir, "Finances_erreur.txt"), []byte(time.Now().Format(time.RFC3339)+"\n"+msg+"\n"), 0o644)
	msgBox("Cockpit — erreur", msg)
	os.Exit(1)
}

func main() {
	mime.AddExtensionType(".js", "text/javascript; charset=utf-8")
	mime.AddExtensionType(".css", "text/css; charset=utf-8")
	mime.AddExtensionType(".svg", "image/svg+xml")
	dirFlag := flag.String("dir", "", "dossier des données (défaut : dossier de l'exécutable)")
	portFlag := flag.Int("port", 47831, "port local")
	noBrowser := flag.Bool("no-browser", false, "ne pas ouvrir la fenêtre")
	normalize := flag.Bool("normalize", false, "relire puis réécrire le classeur (mise en forme) et quitter")
	flag.Parse()

	baseDir = *dirFlag
	if baseDir == "" {
		exe, err := os.Executable()
		if err != nil {
			baseDir, _ = os.Getwd()
		} else {
			baseDir = filepath.Dir(exe)
		}
	}
	baseDir, _ = filepath.Abs(baseDir)
	port = *portFlag

	// Instance unique : si le port répond déjà, on rouvre simplement la fenêtre.
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		if pingExisting(port) {
			if !*noBrowser {
				launchWindow(fmt.Sprintf("http://127.0.0.1:%d/", port))
			}
			return
		}
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			fatal("Impossible d'ouvrir un port local : " + err.Error())
		}
		port = ln.Addr().(*net.TCPAddr).Port
	}

	path := filepath.Join(baseDir, dataFile)
	store, err = OpenStore(path)
	if err != nil {
		fatal("Impossible de lire " + dataFile + " :\n" + err.Error())
	}
	if *normalize {
		store.mu.Lock()
		err := store.save()
		store.mu.Unlock()
		if err != nil {
			fmt.Println("Erreur:", err)
			os.Exit(1)
		}
		fmt.Println("OK :", path)
		return
	}
	_, _ = store.Backup(filepath.Join(baseDir, "Sauvegardes"), false)

	b := make([]byte, 16)
	rand.Read(b)
	token = hex.EncodeToString(b)

	mux := http.NewServeMux()
	sub, _ := fs.Sub(webFS, "web")
	static := http.FileServer(http.FS(sub))
	index, _ := fs.ReadFile(sub, "index.html")
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if !hostOK(r) {
			http.Error(w, "forbidden", 403)
			return
		}
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			w.Write([]byte(strings.ReplaceAll(string(index), "__TOKEN__", token)))
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		static.ServeHTTP(w, r)
	})
	mux.HandleFunc("/api/ping", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"app": "cockpit"})
	})
	api := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if !hostOK(r) || (r.Header.Get("X-Token") != token && r.URL.Query().Get("t") != token) {
				http.Error(w, "forbidden", 403)
				return
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			h(w, r)
		}
	}
	mux.HandleFunc("/api/data", api(handleData))
	mux.HandleFunc("/api/ops", api(handleOps))
	mux.HandleFunc("/api/hb", api(func(w http.ResponseWriter, r *http.Request) {
		lastPing.Store(time.Now().Unix())
		byeAt.Store(0)
		w.Write([]byte(`{"ok":true}`))
	}))
	mux.HandleFunc("/api/bye", api(func(w http.ResponseWriter, r *http.Request) {
		byeAt.Store(time.Now().Unix())
		w.Write([]byte(`{"ok":true}`))
	}))
	mux.HandleFunc("/api/open-excel", api(func(w http.ResponseWriter, r *http.Request) {
		if err := openPath(path); err != nil {
			jsonErr(w, err, 500)
			return
		}
		w.Write([]byte(`{"ok":true}`))
	}))
	mux.HandleFunc("/api/open-folder", api(func(w http.ResponseWriter, r *http.Request) {
		if err := openFolder(baseDir); err != nil {
			jsonErr(w, err, 500)
			return
		}
		w.Write([]byte(`{"ok":true}`))
	}))
	mux.HandleFunc("/api/backup", api(func(w http.ResponseWriter, r *http.Request) {
		store.mu.Lock()
		p, err := store.Backup(filepath.Join(baseDir, "Sauvegardes"), true)
		store.mu.Unlock()
		if err != nil {
			jsonErr(w, err, 500)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"ok": true, "file": filepath.Base(p)})
	}))

	// Arrêt automatique quand la fenêtre est fermée.
	start := time.Now().Unix()
	if !*noBrowser {
		go func() {
			for range time.Tick(3 * time.Second) {
				now := time.Now().Unix()
				lp, bye := lastPing.Load(), byeAt.Load()
				switch {
				case lp == 0 && now-start > 90: // fenêtre jamais ouverte
					os.Exit(0)
				case bye > 0 && now-bye > 8 && lp <= bye:
					os.Exit(0)
				case lp > 0 && now-lp > 180: // onglet gelé / fenêtre disparue
					os.Exit(0)
				}
			}
		}()
		go launchWindow(fmt.Sprintf("http://127.0.0.1:%d/", port))
	}
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	if err := srv.Serve(ln); err != nil {
		fatal(err.Error())
	}
}

func hostOK(r *http.Request) bool {
	h := r.Host
	return h == fmt.Sprintf("127.0.0.1:%d", port) || h == fmt.Sprintf("localhost:%d", port)
}

func pingExisting(p int) bool {
	c := http.Client{Timeout: 1500 * time.Millisecond}
	resp, err := c.Get(fmt.Sprintf("http://127.0.0.1:%d/api/ping", p))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	var v map[string]any
	return json.NewDecoder(resp.Body).Decode(&v) == nil && v["app"] == "cockpit"
}

func jsonErr(w http.ResponseWriter, err error, code int) {
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
}

func handleData(w http.ResponseWriter, r *http.Request) {
	store.mu.Lock()
	store.ReloadIfChanged()
	out := map[string]any{"ok": true, "data": store.D, "file": dataFile, "dir": baseDir, "today": time.Now().Format("2006-01-02")}
	store.mu.Unlock()
	json.NewEncoder(w).Encode(out)
}

func handleOps(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method", 405)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
	var req struct {
		Ops []Op `json:"ops"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, err, 400)
		return
	}
	store.mu.Lock()
	store.ReloadIfChanged()
	err := store.Apply(req.Ops)
	out := map[string]any{"ok": err == nil, "data": store.D, "file": dataFile, "dir": baseDir, "today": time.Now().Format("2006-01-02")}
	store.mu.Unlock()
	if err != nil {
		jsonErr(w, err, 422)
		return
	}
	json.NewEncoder(w).Encode(out)
}
