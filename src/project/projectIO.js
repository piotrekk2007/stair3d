import { downloadTextFile } from '../export/downloadTextFile.js';

// Schemat pliku projektu — patrz docs/model/STAIRCASE_DATA_MODEL.md §7.1 dla pełnego
// uzasadnienia wersji 2: `edgeOverrides` (ręczne korekty krawędzi — patrz §3, Nominal ->
// Override -> Final) są koncepcyjnie WARSTWĄ KOREKT, nie parametrem wejściowym Staircase, więc
// w wersji 2 pliku żyją jako osobne, top-level pole zamiast być zagnieżdżone w `config`.
//
// UWAGA O ZAKRESIE: to jest zmiana FORMATU PLIKU, nie modelu w pamięci. `config` używany
// wewnątrz aplikacji (main.js, planLayout.js, ...) nadal ma `manualEdgeOverrides` zagnieżdżone
// — ten moduł konwertuje między dwoma reprezentacjami przy zapisie/odczycie. Rozdzielenie
// runtime'owego kształtu configu to osobny, większy refaktor modelu danych, świadomie
// zostawiony na później (poza zakresem etapu konsolidacji — patrz CLAUDE.md).
const PROJECT_TYPE = 'schody3d-project';
export const CURRENT_PROJECT_VERSION = 2;

// Buduje payload wersji 2 z bieżącego (płaskiego, runtime'owego) configu — czysta funkcja,
// oddzielona od exportProjectJSON() specjalnie po to, żeby dało się ją przetestować bez
// środowiska przeglądarki (downloadTextFile potrzebuje document/Blob, których nie ma w
// środowisku testowym node:test).
//
// `meta` (opcjonalne, etap 10): metadane projektu NIEBĘDĄCE parametrami geometrii — nazwa,
// notatki oraz ustawienia wyceny (cennik, odpady). Trafiają jako osobne top-level pola pliku,
// obok `config`/`edgeOverrides` (tak samo jak wcześniej edgeOverrides) — nigdy do `config`, bo
// cena/notatka nie jest wejściem solvera i nie ma wchodzić do historii modelu. Pola są
// OPCJONALNE, więc starszy plik v2 bez nich nadal się wczytuje (brak pola ≠ błąd) i wersja
// schematu się nie zmienia.
export function buildProjectPayloadV2(config, meta = {}) {
  const { manualEdgeOverrides, ...configWithoutOverrides } = config;
  const payload = {
    _type: PROJECT_TYPE,
    _version: CURRENT_PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    config: configWithoutOverrides,
    edgeOverrides: manualEdgeOverrides || {},
  };
  if (meta.projectName) payload.projectName = meta.projectName;
  if (meta.notes) payload.notes = meta.notes;
  if (meta.takeoffSettings) payload.takeoffSettings = meta.takeoffSettings;
  return payload;
}

export function exportProjectJSON(config, filename = 'schody_projekt.json', meta = {}) {
  const payload = buildProjectPayloadV2(config, meta);
  downloadTextFile(JSON.stringify(payload, null, 2), filename, 'application/json');
}

// Migruje payload wersji 1 (edgeOverrides zagnieżdżone jako config.manualEdgeOverrides) do
// kształtu wersji 2 (edgeOverrides jako osobne, top-level pole). Rejestr MIGRATIONS jest
// otwarty na kolejne wersje w przyszłości — parseProjectJSON stosuje je po kolei, aż dojdzie
// do CURRENT_PROJECT_VERSION, więc plik sprzed dwóch wersji też się wczyta.
function migrateV1ToV2(data) {
  const { manualEdgeOverrides, ...configWithoutOverrides } = data.config || {};
  return {
    ...data,
    _version: 2,
    config: configWithoutOverrides,
    edgeOverrides: manualEdgeOverrides || {},
  };
}

const MIGRATIONS = {
  1: migrateV1ToV2,
};

// Rzuca błąd z czytelnym komunikatem, jeśli plik nie jest projektem schody3d albo nie da się
// go zmigrować do bieżącej wersji. Zwraca PŁASKI config gotowy do użycia w runtime (z
// manualEdgeOverrides z powrotem zagnieżdżonym — patrz uwaga o zakresie na górze pliku).
export function parseProjectJSON(text) {
  return parseProjectFile(text).config;
}

// Pełny odczyt pliku: płaski config (jak parseProjectJSON) + metadane (nazwa, notatki, ustawienia
// wyceny, wersja schematu pliku, czas zapisu). Brakujące pola metadanych => wartości puste.
export function parseProjectFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('Plik nie jest poprawnym JSON-em.');
  }
  if (!data || data._type !== PROJECT_TYPE || typeof data.config !== 'object') {
    throw new Error('To nie jest plik projektu schody3d (brak znacznika _type/config).');
  }

  let version = data._version || 1;
  while (version < CURRENT_PROJECT_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) throw new Error(`Brak migracji ze schematu wersji ${version} do ${CURRENT_PROJECT_VERSION}.`);
    data = migrate(data);
    version = data._version;
  }

  return {
    config: { ...data.config, manualEdgeOverrides: data.edgeOverrides || {} },
    meta: {
      projectName: typeof data.projectName === 'string' ? data.projectName : '',
      notes: typeof data.notes === 'string' ? data.notes : '',
      takeoffSettings: data.takeoffSettings && typeof data.takeoffSettings === 'object' ? data.takeoffSettings : null,
      schemaVersion: version,
      savedAt: typeof data.savedAt === 'string' ? data.savedAt : null,
    },
  };
}
