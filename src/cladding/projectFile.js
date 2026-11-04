// The project file of the module "Schody na beton" — its own type, separate from the self-supporting projectIO.js
// (docs/architecture/CONCRETE_CLADDING_MODULE.md, the isolation rule). Pure.

import { sanitizeCladdingConfig } from './schema.js';

export const CLADDING_PROJECT_TYPE = 'schody3d-beton';
export const CLADDING_PROJECT_VERSION = 1;

export function claddingProjectToFile({ config, projectName = '', notes = '' }) {
  return { _type: CLADDING_PROJECT_TYPE, _version: CLADDING_PROJECT_VERSION, savedAt: new Date().toISOString(), projectName, notes, cladding: sanitizeCladdingConfig(config) };
}

/** @returns {{config, projectName, notes}} — throws with a Polish message on a file of another kind */
export function parseCladdingProjectFile(text) {
  let data;
  try {
    data = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    throw new Error('to nie jest plik JSON');
  }
  if (data?._type === 'schody3d-project') throw new Error('to projekt schodów samonośnych — wczytaj go w zakładce „Samonośne”');
  if (data?._type !== CLADDING_PROJECT_TYPE || typeof data.cladding !== 'object') throw new Error('to nie jest plik projektu schodów na beton');
  if (Number(data._version) > CLADDING_PROJECT_VERSION) throw new Error(`plik z nowszej wersji programu (${data._version})`);
  return { config: sanitizeCladdingConfig(data.cladding), projectName: typeof data.projectName === 'string' ? data.projectName : '', notes: typeof data.notes === 'string' ? data.notes : '' };
}
