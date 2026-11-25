//go:build !windows

package main

import (
	"fmt"
	"os/exec"
)

func openPath(p string) error   { return exec.Command("xdg-open", p).Start() }
func openFolder(p string) error { return exec.Command("xdg-open", p).Start() }
func msgBox(title, text string) { fmt.Println(title+":", text) }
func launchWindow(url string)   { fmt.Println("Ouvre", url) }
