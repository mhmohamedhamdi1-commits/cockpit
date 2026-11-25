# Cockpit — façon de travailler

## Branches
| Branche | Rôle | Déployée sur |
|---|---|---|
| `main` | développement courant (intégration) | **DEV** : projet Supabase `cockpit-dev` + site `cockpit-finances-dev.pages.dev` |
| `release` | ce qui est en production | **PROD** : projet Supabase `cockpit` + site de production |
| `feature/…` | une évolution, fusionnée dans `main` par pull request | — |

Mise en production : pull request `main` → `release`, une fois les tests DEV au vert.

## Commandes
```bash
export PATH=~/.local/node/bin:$PATH
node --test tests/                                   # tests base, calculs, Excel (sans aucune base réelle)
COCKPIT_ENV=dev node tools/cloud/deploy.mjs supabase # base + fonctions sur DEV
COCKPIT_ENV=dev node tools/cloud/deploy.mjs app      # site DEV
COCKPIT_ENV=dev node tests/e2e.mjs <url dev>         # tests de bout en bout sur DEV (comptes jetables)
node tools/cloud/deploy.mjs app                      # PROD : refusé hors de la branche release / avec des modifications non commitées
```
Secrets : uniquement dans `.env` (jamais commité) ou dans les secrets GitHub.
