//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

func hide(cmd *exec.Cmd) *exec.Cmd {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	return cmd
}

// openPath ouvre un fichier / dossier / URL avec l'application par défaut.
func openPath(p string) error {
	return hide(exec.Command("rundll32", "url.dll,FileProtocolHandler", p)).Start()
}

func openFolder(p string) error {
	return hide(exec.Command("explorer.exe", p)).Start()
}

func msgBox(title, text string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	proc := user32.NewProc("MessageBoxW")
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(text)
	proc.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), 0x40)
}

// launchWindow ouvre l'interface dans une fenêtre d'application (Edge/Chrome en mode --app).
func launchWindow(url string) {
	local := os.Getenv("LOCALAPPDATA")
	pf := os.Getenv("ProgramFiles")
	pf86 := os.Getenv("ProgramFiles(x86)")
	cands := []string{
		filepath.Join(pf86, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(pf, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(pf, `Google\Chrome\Application\chrome.exe`),
		filepath.Join(pf86, `Google\Chrome\Application\chrome.exe`),
		filepath.Join(local, `Google\Chrome\Application\chrome.exe`),
	}
	profile := filepath.Join(local, "CockpitFinances", "profil")
	os.MkdirAll(profile, 0o755)
	for _, c := range cands {
		if _, err := os.Stat(c); err == nil {
			cmd := exec.Command(c, "--app="+url, "--window-size=1480,940",
				"--user-data-dir="+profile, "--no-first-run", "--no-default-browser-check",
				"--disable-features=Translate")
			if cmd.Start() == nil {
				return
			}
		}
	}
	_ = openPath(url)
}
