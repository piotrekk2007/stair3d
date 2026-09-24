// APPEARANCE (kolory prezentacji) — wybór koloru osobno dla stopni, podstopni, wang i słupów, żeby
// klientowi pokazać np. białe albo czarne podstopnie. Czysty moduł danych: żadnej geometrii i żadnego
// Three.js — tylko słownik kolorów, ich walidacja i ustawienie ich na już istniejących materiałach.
// To ustawienie PREZENTACJI: żyje w pliku projektu jako osobne pole `appearance` (poza `config`,
// więc nie wchodzi do historii modelu ani do solvera), nie zmienia geometrii ani kosztorysu.

export const APPEARANCE_ELEMENTS = Object.freeze([
  { key: 'tread', label: 'Stopnie' },
  { key: 'riser', label: 'Podstopnie' },
  { key: 'stringer', label: 'Wangi' },
  { key: 'post', label: 'Słupy' },
  { key: 'railing', label: 'Poręcz' },
  { key: 'baluster', label: 'Tralki' },
]);

// Domyślne kolory = dotychczasowe kolory materiałów (nic się nie zmienia, dopóki ktoś nie wybierze).
export const DEFAULT_APPEARANCE = Object.freeze({
  tread: '#d8c39a',
  riser: '#e8ddc4',
  stringer: '#8a5a34',
  post: '#5a3d24',
  railing: '#d8c39a',
  baluster: '#d8c39a',
});

export const COLOR_PRESETS = Object.freeze([
  { id: 'oak-natural', label: 'Dąb naturalny', hex: '#d8c39a' },
  { id: 'oak-light', label: 'Dąb jasny', hex: '#e6d3ac' },
  { id: 'oak-dark', label: 'Dąb ciemny', hex: '#8a5a34' },
  { id: 'walnut', label: 'Orzech', hex: '#5a3d24' },
  { id: 'white', label: 'Biały', hex: '#f4f4f2' },
  { id: 'grey', label: 'Szary', hex: '#8d9096' },
  { id: 'anthracite', label: 'Antracyt', hex: '#3a3d42' },
  { id: 'black', label: 'Czarny', hex: '#1a1a1a' },
]);

const HEX = /^#[0-9a-f]{6}$/i;

export function defaultAppearance() {
  return { ...DEFAULT_APPEARANCE };
}

/** Bierze tylko znane elementy z poprawnym kolorem #rrggbb; reszta wraca do domyślnych. */
export function sanitizeAppearance(raw) {
  const out = defaultAppearance();
  if (!raw || typeof raw !== 'object') return out;
  for (const { key } of APPEARANCE_ELEMENTS) {
    if (typeof raw[key] === 'string' && HEX.test(raw[key])) out[key] = raw[key].toLowerCase();
  }
  return out;
}

/** Ustawia kolory na materiałach ({tread, riser, stringer, post} -> obiekt z `.color.set`). */
export function applyAppearanceToMaterials(materials, appearance) {
  const clean = sanitizeAppearance(appearance);
  for (const { key } of APPEARANCE_ELEMENTS) {
    if (materials[key]?.color?.set) materials[key].color.set(clean[key]);
  }
}
