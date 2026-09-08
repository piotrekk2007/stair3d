import { downloadTextFile } from '../export/downloadTextFile.js';

const PROJECT_TYPE = 'schody3d-project';
const PROJECT_VERSION = 1;

export function exportProjectJSON(config, filename = 'schody_projekt.json') {
  const payload = {
    _type: PROJECT_TYPE,
    _version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    config,
  };
  downloadTextFile(JSON.stringify(payload, null, 2), filename, 'application/json');
}

// Rzuca błąd z czytelnym komunikatem, jeśli plik nie jest projektem schody3d.
export function parseProjectJSON(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('Plik nie jest poprawnym JSON-em.');
  }
  if (!data || data._type !== PROJECT_TYPE || typeof data.config !== 'object') {
    throw new Error('To nie jest plik projektu schody3d (brak znacznika _type/config).');
  }
  return data.config;
}
