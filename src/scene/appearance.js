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

// Domyślne kolory: elementy drewniane w kolorze zdjęcia dębu (z wykończeniem 'oakPhoto' = zdjęcie bez zmian),
// słupy ciemniejsze jako akcent (jak dotąd). Starszy projekt ma swoje kolory zapisane w pliku.
export const DEFAULT_APPEARANCE = Object.freeze({
  tread: '#c19f71',
  riser: '#c19f71',
  stringer: '#c19f71',
  post: '#5a3d24',
  railing: '#c19f71',
  baluster: '#c19f71',
});

// Wykończenie każdego elementu (klucz w obiekcie: `${element}Finish`):
//   'oakPhoto' = zdjęcie dębu (src/assets/textures/oak-natural.jpg) — domyślne;
//   'oak'      = tekstura dębu generowana w kodzie (scene/woodTexture.js);
//   'solid'    = gładki kolor (np. podstopnie malowane na biało).
export const FINISHES = Object.freeze({ OAK_PHOTO: 'oakPhoto', OAK: 'oak', SOLID: 'solid' });
export const FINISH_LABELS_PL = Object.freeze({ oakPhoto: 'dąb (zdjęcie)', oak: 'dąb (generowany)', solid: 'gładkie (kryjące)' });
// Średni kolor zdjęcia dębu (zmierzony z pliku) — wybranie go pokazuje zdjęcie w oryginalnych kolorach.
export const OAK_PHOTO_COLOR = '#c19f71';
export const finishKey = (key) => `${key}Finish`;

export const COLOR_PRESETS = Object.freeze([
  { id: 'oak-photo', label: 'Dąb (kolor ze zdjęcia)', hex: OAK_PHOTO_COLOR },
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
  const out = { ...DEFAULT_APPEARANCE };
  for (const { key } of APPEARANCE_ELEMENTS) out[finishKey(key)] = FINISHES.OAK_PHOTO;
  return out;
}

/** Bierze tylko znane elementy z poprawnym kolorem #rrggbb; reszta wraca do domyślnych. */
export function sanitizeAppearance(raw) {
  const out = defaultAppearance();
  if (!raw || typeof raw !== 'object') return out;
  for (const { key } of APPEARANCE_ELEMENTS) {
    if (typeof raw[key] === 'string' && HEX.test(raw[key])) out[key] = raw[key].toLowerCase();
    if (Object.values(FINISHES).includes(raw[finishKey(key)])) out[finishKey(key)] = raw[finishKey(key)];
  }
  return out;
}

/**
 * Ustawia kolory (i wykończenie) na materiałach ({tread, riser, …} -> obiekt z `.color.set`).
 * `wood` = { texture, meanLuminance, bumpScale, photo: { texture, meanHex } } (scene/woodGrain.js).
 * 'oak' (generowany): kolor dzielony przez średnią jasność tekstury (najwyżej do 1 na kanał), żeby deska ŚREDNIO
 * miała wybrany kolor. 'oakPhoto': kolor dzielony KANAŁ PO KANALE przez średni kolor zdjęcia (najwyżej ×2) — wybranie
 * dokładnie koloru zdjęcia daje zdjęcie bez zmian, inny kolor „bejcuje" je na ten kolor. Bez `wood` (np. w testach)
 * — sam kolor, jak dotąd.
 */
export function applyAppearanceToMaterials(materials, appearance, wood = null) {
  const clean = sanitizeAppearance(appearance);
  for (const { key } of APPEARANCE_ELEMENTS) {
    const m = materials[key];
    if (!m?.color?.set) continue;
    m.color.set(clean[key]);
    const finish = clean[finishKey(key)];
    const photo = finish === FINISHES.OAK_PHOTO && !!wood?.photo?.texture;
    const oak = !photo && !!wood?.texture && (finish === FINISHES.OAK || finish === FINISHES.OAK_PHOTO);
    if (oak && wood.meanLuminance > 0) {
      const maxChannel = Math.max(m.color.r, m.color.g, m.color.b, 1e-6);
      m.color.multiplyScalar(Math.min(1 / wood.meanLuminance, 1 / maxChannel));
    }
    if (photo) {
      const mean = m.color.clone().set(wood.photo.meanHex || OAK_PHOTO_COLOR);
      m.color.setRGB(Math.min(2, m.color.r / Math.max(mean.r, 1e-6)), Math.min(2, m.color.g / Math.max(mean.g, 1e-6)), Math.min(2, m.color.b / Math.max(mean.b, 1e-6)));
    }
    if (wood && 'map' in m) {
      const next = photo ? wood.photo.texture : oak ? wood.texture : null;
      if (m.map !== next) {
        m.map = next;
        m.bumpMap = next;
        m.needsUpdate = true;
      }
      if (typeof wood.bumpScale === 'number') m.bumpScale = oak || photo ? wood.bumpScale : 0;
    }
  }
}
