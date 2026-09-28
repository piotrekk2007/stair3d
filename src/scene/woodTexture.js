// Proceduralna tekstura DĘBU — czysty generator pikseli (bez Three.js, bez DOM, testowalny w node).
//
// Wygląd deski dębowej ciętej stycznie (flat-sawn), tak jak na typowym stopniu:
//   - słoje roczne: jasne drewno wczesne i ciemniejsze pasmo drewna późnego, falujące i miejscami łukowate;
//   - drobne włókna: długie, cienkie smugi wzdłuż słojów;
//   - pory: krótkie ciemne kreski wzdłuż włókien, gęstsze w drewnie wczesnym (dąb jest pierścieniowonaczyniowy);
//   - promienie rdzeniowe: drobne jaśniejsze plamki (charakterystyczne dla dębu);
//   - wielkoskalowa zmienność koloru deski.
// Oś x tekstury = WZDŁUŻ włókien, oś y = w poprzek. Szum jest okresowy (siatka zawijana), więc tekstura
// powtarza się bez szwu (RepeatWrapping). Wartości to JASNOŚĆ z lekkim ciepłym odcieniem — właściwy kolor
// daje kolor materiału (scene/appearance.js), mnożony przez tę teksturę.

// Ile drewna (mm) pokrywa jedno powtórzenie tekstury — wzdłuż i w poprzek włókien (wizualizacja, do dostrojenia).
export const OAK_TEXTURE_SPAN_MM = Object.freeze({ along: 1600, across: 400 });
export const OAK_TEXTURE_SIZE = Object.freeze({ width: 1024, height: 256 });

function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);
const mod = (a, n) => ((a % n) + n) % n;

/** Szum wartości, okresowy: noise(x + px, y) = noise(x, y + py) = noise(x, y) dla całkowitych px, py. */
export function periodicNoise(x, y, px, py, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const ax = mod(x0, px);
  const bx = mod(x0 + 1, px);
  const ay = mod(y0, py);
  const by = mod(y0 + 1, py);
  const v00 = hash2(ax, ay, seed);
  const v10 = hash2(bx, ay, seed);
  const v01 = hash2(ax, by, seed);
  const v11 = hash2(bx, by, seed);
  return v00 + (v10 - v00) * fx + (v01 - v00) * fy + (v00 - v10 - v01 + v11) * fx * fy;
}

// Suma oktaw (okresowa: okres rośnie razem z częstotliwością), wynik w [0, 1].
function fbm(x, y, px, py, seed, octaves) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicNoise(x * f, y * f, px * f, py * f, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Model deski ciętej stycznie: pień to współśrodkowe słoje (walce), deska przecina je płaszczyzną w odległości h od
// rdzenia. Na powierzchni słój o promieniu r leży tam, gdzie √(x² + h²) = r (x = odległość w poprzek od linii nad
// rdzeniem) — przy brzegach deski gęste, niemal równoległe linie, w środku szerokie łuki („katedry"). Pień jest
// zbieżysty, a cięcie lekko skośne, więc wzdłuż deski płaszczyzna schodzi na kolejne słoje: indeks słoja przesuwa
// się o CATHEDRAL_RINGS_PER_TILE na jedno powtórzenie (liczba całkowita — tekstura dalej bez szwu) i łuki otwierają
// się w jedną stronę jak na prawdziwej desce. Wartości w mm dobrane z oka pod wygląd dębu (słój ≈ 4 mm), nie z
// pomiaru — to tylko wizualizacja.
const RING_SPACING_MM = 4.2;
const PITH_DISTANCE_MM = { mean: 150, swing: 0, noise: 26 };
const CATHEDRAL_RINGS_PER_TILE = 12;

/** Jasność dębu w punkcie tekstury (s wzdłuż, t w poprzek włókien; oba w [0,1), okres 1). */
export function oakLuminance(s, t, seed = 7) {
  const acrossMm = OAK_TEXTURE_SPAN_MM.across;
  // linia nad rdzeniem lekko falująca wzdłuż deski; x zawinięte okresowo (tekstura bez szwu w poprzek)
  const center = 0.5 + 0.06 * (fbm(s * 2, 0.5, 2, 1, seed + 5, 2) - 0.5);
  let x = t - center;
  x -= Math.round(x); // [-0.5, 0.5)
  const xMm = x * acrossMm;
  const hMm = PITH_DISTANCE_MM.mean + PITH_DISTANCE_MM.swing * Math.sin(2 * Math.PI * s) + PITH_DISTANCE_MM.noise * (fbm(s * 3, t * 2, 3, 2, seed, 3) - 0.5);
  const wobble = 1.6 * (fbm(s * 4, t * 8, 4, 8, seed + 9, 3) - 0.5); // nieregularność słojów
  const ring = Math.sqrt(xMm * xMm + hMm * hMm) / RING_SPACING_MM - CATHEDRAL_RINGS_PER_TILE * s + wobble;
  const f = ring - Math.floor(ring);

  // drewno wczesne (początek słoja) = pasmo dużych porów — ciemniejsza, „gruba" linia rysunku dębu;
  // drewno późne gęstsze i nieco ciemniejsze w tonie, ale gładkie
  const earlyBand = 1 - smoothstep(0.0, 0.28, f) + smoothstep(0.94, 1.0, f);
  const late = smoothstep(0.45, 0.8, f) * (1 - smoothstep(0.9, 0.97, f));
  const poreN = periodicNoise(s * 48, t * 520, 48, 520, seed + 23); // pory: długie cienkie kreski wzdłuż włókien
  const pores = smoothstep(0.45, 0.8, poreN) * (0.05 + 0.22 * earlyBand);
  const streak = (fbm(s * 2, t * 160, 2, 160, seed + 11, 3) - 0.5) * 0.08; // drobne włókna
  const rayN = periodicNoise(s * 140, t * 700, 140, 700, seed + 37); // promienie rdzeniowe: krótkie ciemne wrzeciona
  const rays = smoothstep(0.86, 0.95, rayN) * 0.12;
  const variation = (fbm(s, t * 2, 1, 2, seed + 51, 2) - 0.5) * 0.1; // zmienność koloru deski
  return Math.min(1, Math.max(0.42, 0.96 - 0.13 * late - 0.1 * earlyBand - pores + streak - rays + variation));
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/**
 * Piksele RGBA tekstury dębu (Uint8ClampedArray, wiersz po wierszu, x = wzdłuż włókien) i średnia jasność
 * w przestrzeni LINIOWEJ — appearance.js dzieli przez nią kolor materiału, żeby średnio deska miała
 * dokładnie wybrany kolor (tekstura tylko rozkłada jasność wokół niego).
 */
export function generateOakPixels({ width = OAK_TEXTURE_SIZE.width, height = OAK_TEXTURE_SIZE.height, seed = 7 } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  let linSum = 0;
  for (let y = 0; y < height; y++) {
    const t = y / height;
    for (let x = 0; x < width; x++) {
      const L = oakLuminance(x / width, t, seed);
      const i = (y * width + x) * 4;
      // lekki ciepły odcień w cieniach (drewno późne/pory są bardziej brązowe niż szare)
      const r = L;
      const g = L * (0.955 + 0.03 * L);
      const b = L * (0.89 + 0.08 * L);
      data[i] = Math.round(r * 255);
      data[i + 1] = Math.round(g * 255);
      data[i + 2] = Math.round(b * 255);
      data[i + 3] = 255;
      linSum += 0.2126 * srgbToLinear(data[i] / 255) + 0.7152 * srgbToLinear(data[i + 1] / 255) + 0.0722 * srgbToLinear(data[i + 2] / 255);
    }
  }
  return { data, width, height, meanLinearLuminance: linSum / (width * height) };
}
