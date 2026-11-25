// Lanceur Chromium headless partagé par les tests d'interface
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import os from 'node:os';
export async function launch() {
  const libs = execSync(`find ${os.homedir()}/.local/chromelibs -name "*.so*" -printf "%h\\n" | sort -u | tr '\\n' ':'`).toString();
  return chromium.launch({ env: { ...process.env, LD_LIBRARY_PATH: libs } });
}
