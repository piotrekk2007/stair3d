// QR CODE ENCODER (ISO/IEC 18004) — no dependency (user decision 2026-11-06, the modern offer's contact code). Only what
// the offer needs: BYTE mode (the text as UTF-8), error correction level M (~15 % of the code may be damaged), versions
// 1–10 (21 … 57 modules, up to 213 bytes), the mask chosen by the standard's four penalty rules. Output: a matrix of
// booleans (true = dark) and an SVG built from one <path>.
//
// The steps follow the standard: the bit stream (mode 0100, the byte count — 8 bits up to version 9, 16 bits from 10 —,
// the bytes, a terminator, pad bytes 0xEC / 0x11) → data codewords split into blocks → Reed-Solomon EC codewords per
// block (GF(256), polynomial 0x11D, generator roots α^0 … α^(n-1)) → interleaved → placed in the zigzag order outside the
// function patterns (finders, separators, timing, alignment, dark module, format and version areas) → masked → format
// bits (level + mask, BCH(15,5) 0x537, XOR 0x5412) and, from version 7, version bits (BCH(18,6) 0x1F25).

/** Level M per version 1–10: [EC codewords per block, blocks in group 1, data codewords each, blocks in group 2, data each]. */
const EC_M = [
  null,
  [10, 1, 16, 0, 0],
  [16, 1, 28, 0, 0],
  [26, 1, 44, 0, 0],
  [18, 2, 32, 0, 0],
  [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0],
  [18, 4, 31, 0, 0],
  [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37],
  [26, 4, 43, 1, 44],
];
/** Alignment pattern centres (rows / columns) per version. */
const ALIGNMENT = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
export const QR_MAX_VERSION = 10;
const LEVEL_M_BITS = 0b00; // the format's level field: L 01, M 00, Q 11, H 10

const dataCodewords = (v) => {
  const [, b1, d1, b2, d2] = EC_M[v];
  return b1 * d1 + b2 * d2;
};
const countBits = (v) => (v <= 9 ? 8 : 16);

/** The most bytes a version-v level-M code holds in byte mode. */
export const qrCapacityBytes = (v) => Math.floor((dataCodewords(v) * 8 - 4 - countBits(v)) / 8);

/** UTF-8 bytes of a string (TextEncoder where there is one — browsers and node both have it). */
export const utf8Bytes = (text) => Array.from(new TextEncoder().encode(String(text)));

// --- GF(256), polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D)
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** The RS generator's coefficients (highest power first, the leading 1 left out), degree n. */
function rsDivisor(n) {
  const result = new Array(n).fill(0);
  result[n - 1] = 1;
  let root = 1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < n) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

/** The n EC codewords of one block (the remainder of data · x^n divided by the generator). */
export function reedSolomonEc(data, n) {
  const divisor = rsDivisor(n);
  const result = new Array(n).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    for (let i = 0; i < n; i++) result[i] ^= gfMul(divisor[i], factor);
  }
  return result;
}

/** The 15 format bits (level M, the mask). */
export function formatBits(mask) {
  const data = (LEVEL_M_BITS << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
}

/** The 18 version bits (versions 7+). */
export function versionBits(v) {
  let rem = v;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (v << 12) | (rem & 0xfff);
}

/** The data + EC codewords in their final, interleaved order. */
function codewords(bytes, v) {
  const bits = [];
  const put = (value, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, countBits(v));
  for (const b of bytes) put(b, 8);
  const capacity = dataCodewords(v) * 8;
  put(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < dataCodewords(v); pad ^= 0xec ^ 0x11) data.push(pad);

  const [ecn, b1, d1, b2, d2] = EC_M[v];
  const blocks = [];
  let k = 0;
  for (let i = 0; i < b1 + b2; i++) {
    const len = i < b1 ? d1 : d2;
    const block = data.slice(k, k + len);
    k += len;
    blocks.push({ data: block, ec: reedSolomonEc(block, ecn) });
  }
  const out = [];
  for (let i = 0; i < Math.max(d1, d2); i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  for (let i = 0; i < ecn; i++) for (const b of blocks) out.push(b.ec[i]);
  return out;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** The function patterns of version v: {size, dark: bool[][], isFunction: bool[][]} (format / version areas reserved). */
function functionPatterns(v) {
  const size = 17 + 4 * v;
  const dark = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, d) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    dark[y][x] = d;
    isFunction[y][x] = true;
  };
  // timing
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  // finders + separators
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
  }
  // alignment (not over the finders)
  const pos = ALIGNMENT[v];
  for (let i = 0; i < pos.length; i++)
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  // format areas (filled later) + the dark module
  for (let i = 0; i < 9; i++) {
    if (i === 6) continue; // (the timing patterns cross there)
    set(8, i, false);
    set(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    set(size - 1 - i, 8, false);
    set(8, size - 1 - i, false);
  }
  set(8, size - 8, true);
  // version areas
  if (v >= 7) {
    const bits = versionBits(v);
    for (let i = 0; i < 18; i++) {
      const d = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, d);
      set(b, a, d);
    }
  }
  return { size, dark, isFunction };
}

function drawFormat(dark, size, mask) {
  const bits = formatBits(mask);
  const bit = (i) => ((bits >>> i) & 1) === 1;
  const set = (x, y, d) => (dark[y][x] = d);
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);
}

function penalty(m) {
  const n = m.length;
  let p = 0;
  const lineScore = (get) => {
    let s = 0;
    for (let a = 0; a < n; a++) {
      let run = 1;
      for (let b = 1; b <= n; b++) {
        if (b < n && get(a, b) === get(a, b - 1)) run++;
        else {
          if (run >= 5) s += 3 + run - 5;
          run = 1;
        }
      }
      // 1:1:3:1:1 finder-like patterns with four light modules on one side
      for (let b = 0; b + 11 <= n; b++) {
        const seq = Array.from({ length: 11 }, (_, k) => (get(a, b + k) ? 1 : 0)).join('');
        if (seq === '10111010000' || seq === '00001011101') s += 40;
      }
    }
    return s;
  };
  p += lineScore((r, c) => m[r][c]);
  p += lineScore((c, r) => m[r][c]);
  for (let y = 0; y + 1 < n; y++)
    for (let x = 0; x + 1 < n; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
    }
  const darkCount = m.reduce((s, row) => s + row.filter(Boolean).length, 0);
  p += Math.floor(Math.abs((darkCount * 100) / (n * n) - 50) / 5) * 10;
  return p;
}

/** The smallest version (1–10) the text fits in at level M, or null when it is too long. */
export function qrVersionFor(text) {
  const n = utf8Bytes(text).length;
  for (let v = 1; v <= QR_MAX_VERSION; v++) if (n <= qrCapacityBytes(v)) return v;
  return null;
}

/**
 * The QR code of a text (byte mode, UTF-8, level M).
 * @param {string} text
 * @param {{mask?: number}} [opts] — a fixed mask 0–7 (tests); else the one with the lowest penalty
 * @returns {{version: number, size: number, mask: number, modules: boolean[][]}|null} null = too long for version 10
 */
export function encodeQr(text, { mask: fixedMask = null } = {}) {
  const bytes = utf8Bytes(text);
  const version = qrVersionFor(text);
  if (!version) return null;
  const cw = codewords(bytes, version);
  const { size, dark, isFunction } = functionPatterns(version);
  // the zigzag: two-column strips from the right, alternately upward and downward, skipping the timing column
  let i = 0;
  const total = cw.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && i < total) {
          dark[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
  }
  const masked = (mk) => {
    const m = dark.map((row) => row.slice());
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!isFunction[y][x] && MASKS[mk](x, y)) m[y][x] = !m[y][x];
    drawFormat(m, size, mk);
    return m;
  };
  let best = null;
  for (let mk = 0; mk < 8; mk++) {
    if (fixedMask != null && mk !== fixedMask) continue;
    const m = masked(mk);
    const score = fixedMask != null ? 0 : penalty(m);
    if (!best || score < best.score) best = { mask: mk, modules: m, score };
  }
  return { version, size, mask: best.mask, modules: best.modules };
}

/** The dark modules as one SVG path (unit squares, merged along rows), offset by the quiet zone. */
export function qrPathData(modules, quiet = 4) {
  let d = '';
  modules.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      let w = 1;
      while (x + w < row.length && row[x + w]) w++;
      d += `M${x + quiet} ${y + quiet}h${w}v1h-${w}z`;
      x += w - 1;
    }
  });
  return d;
}

/**
 * An SVG of the code (a white square with the quiet zone, the modules in `color`), sized by the caller's CSS.
 * @returns {string|null} null when the text is too long
 */
export function qrSvg(text, { quiet = 4, color = '#000', className = '' } = {}) {
  const qr = encodeQr(text);
  if (!qr) return null;
  const n = qr.size + 2 * quiet;
  return `<svg xmlns="http://www.w3.org/2000/svg"${className ? ` class="${className}"` : ''} viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path fill="${color}" d="${qrPathData(qr.modules, quiet)}"/></svg>`;
}
