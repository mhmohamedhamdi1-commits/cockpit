// Écran « À valider » : opérations importées d'un relevé bancaire (Revolut…) en attente de validation.
// (module en cours de construction)
import { h } from '../util.js';
import { empty } from '../ui.js';
export function meta() { return { title: 'Opérations à valider', sub: 'Import d’un relevé de compte', period: false, immoToggle: false }; }
export function badge() { return 0; }
export function render() { return h('div', { class: 'card' }, empty('Import de relevé', 'En cours de construction.')); }
