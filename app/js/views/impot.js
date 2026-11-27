// Écran « Impôt » : estimation de l'impôt sur le revenu du foyer et paramètres fiscaux.
// (module en cours de construction)
import { h } from '../util.js';
import { empty } from '../ui.js';
export function meta() { return { title: 'Impôt', sub: 'Impôt sur le revenu et paramètres fiscaux', period: false, immoToggle: false }; }
export function badge() { return 0; }
export function render() { return h('div', { class: 'card' }, empty('Impôt', 'En cours de construction.')); }
