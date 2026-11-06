// The QR encoder against known vectors (the RS example of "HELLO WORLD" 1-M, the level-M format strings, the version
// strings 7–10) and an independent decoder written from the standard here — reads the format, unmasks, reads the
// zigzag, de-interleaves, checks every block's Reed-Solomon SYNDROMES are zero (evaluation, not the encoder's division)
// and parses the byte-mode text back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeQr, reedSolomonEc, formatBits, versionBits, qrCapacityBytes, qrVersionFor, qrSvg, qrPathData } from '../qrCode.js';

test('Reed-Solomon: the known 1-M example (HELLO WORLD data codewords → 10 EC codewords)', () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(reedSolomonEc(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('format strings of level M, masks 0–7, and the version strings 7–10 (the standard\'s tables)', () => {
  const m = ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000'];
  m.forEach((bits, mask) => assert.equal(formatBits(mask).toString(2).padStart(15, '0'), bits, `mask ${mask}`));
  assert.deepEqual([7, 8, 9, 10].map(versionBits), [0x07c94, 0x085bc, 0x09a99, 0x0a4d3]);
});

test('capacity of level M in byte mode (versions 1, 9, 10) and the version chosen', () => {
  assert.deepEqual([1, 2, 9, 10].map(qrCapacityBytes), [14, 26, 180, 213]);
  assert.equal(qrVersionFor('a'.repeat(14)), 1);
  assert.equal(qrVersionFor('a'.repeat(15)), 2);
  assert.equal(qrVersionFor('ł'.repeat(107)), null, '214 bytes of UTF-8 do not fit');
});

// ---------------- an independent decoder (from the standard) ----------------
const EXP = new Array(512);
const LOG = new Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
const TABLE_M = { 1: [10, [[1, 16]]], 2: [16, [[1, 28]]], 3: [26, [[1, 44]]], 4: [18, [[2, 32]]], 5: [24, [[2, 43]]], 6: [16, [[4, 27]]], 7: [18, [[4, 31]]], 8: [22, [[2, 38], [2, 39]]], 9: [22, [[3, 36], [2, 37]]], 10: [26, [[4, 43], [1, 44]]] };
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
const MASK = [(r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0, (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0, (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0];

function reserved(r, c, v, n) {
  if ((r < 9 && c < 9) || (r < 9 && c >= n - 8) || (r >= n - 8 && c < 9)) return true; // finders, separators, format
  if (r === 6 || c === 6) return true;
  if (v >= 7 && ((r < 6 && c >= n - 11 && c < n - 8) || (c < 6 && r >= n - 11 && r < n - 8))) return true;
  const a = ALIGN[v];
  for (const ar of a)
    for (const ac of a) {
      if ((ar === 6 && ac === 6) || (ar === 6 && ac === a[a.length - 1]) || (ar === a[a.length - 1] && ac === 6)) continue;
      if (Math.abs(r - ar) <= 2 && Math.abs(c - ac) <= 2) return true;
    }
  return false;
}

function decode(m) {
  const n = m.length;
  const v = (n - 17) / 4;
  const at = (r, c) => (m[r][c] ? 1 : 0);
  // format, both copies (bit 14 first)
  const f1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]].map(([r, c]) => at(r, c)).join('');
  const f2 = [...Array.from({ length: 7 }, (_, i) => [n - 1 - i, 8]), ...Array.from({ length: 8 }, (_, i) => [8, n - 8 + i])].map(([r, c]) => at(r, c)).join('');
  assert.equal(f1, f2, 'both format copies agree');
  const fmt = parseInt(f1, 2) ^ 0b101010000010010;
  assert.equal(fmt >> 13, 0b00, 'level M');
  const mask = (fmt >> 10) & 7;
  assert.equal(at(n - 8, 8), 1, 'the dark module');
  for (let i = 8; i < n - 8; i++) assert.equal(at(6, i), (i + 1) % 2, 'timing row');
  // the zigzag
  const bits = [];
  let up = true;
  for (let c = n - 1; c > 0; c -= 2) {
    if (c === 6) c = 5;
    for (let k = 0; k < n; k++) {
      const r = up ? n - 1 - k : k;
      for (const cc of [c, c - 1]) if (!reserved(r, cc, v, n)) bits.push(at(r, cc) ^ (MASK[mask](r, cc) ? 1 : 0));
    }
    up = !up;
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  // de-interleave
  const [ec, groups] = TABLE_M[v];
  const lens = groups.flatMap(([count, len]) => Array(count).fill(len));
  const blocks = lens.map(() => []);
  let k = 0;
  for (let i = 0; i < Math.max(...lens); i++) lens.forEach((len, b) => i < len && blocks[b].push(bytes[k++]));
  for (let i = 0; i < ec; i++) lens.forEach((_, b) => blocks[b].push(bytes[k++])); // (the EC codewords interleaved too)
  // every block: the codeword polynomial vanishes at α^0 … α^(ec-1)
  for (const block of blocks)
    for (let i = 0; i < ec; i++) {
      let s = 0;
      for (const cw of block) s = mul(s, EXP[i]) ^ cw;
      assert.equal(s, 0, `syndrome ${i}`);
    }
  const data = blocks.flatMap((b, i) => b.slice(0, lens[i]));
  const stream = data.map((b) => b.toString(2).padStart(8, '0')).join('');
  assert.equal(stream.slice(0, 4), '0100', 'byte mode');
  const cb = v <= 9 ? 8 : 16;
  const count = parseInt(stream.slice(4, 4 + cb), 2);
  const out = [];
  for (let i = 0; i < count; i++) out.push(parseInt(stream.slice(4 + cb + 8 * i, 12 + cb + 8 * i), 2));
  return { version: v, mask, text: new TextDecoder().decode(new Uint8Array(out)) };
}

function finderOk(m, r0, c0) {
  for (let r = 0; r < 7; r++)
    for (let c = 0; c < 7; c++) {
      const d = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      if (m[r0 + r][c0 + c] !== (d !== 2)) return false;
    }
  return true;
}

test('round trip through the independent decoder: every version 1–10, every mask, Polish letters', () => {
  const texts = ['A', 'HELLO WORLD', 'Zażółć gęślą jaźń', 'x'.repeat(60), 'BEGIN:VCARD\nVERSION:3.0\n' + 'ł'.repeat(80), 'q'.repeat(213)];
  for (let len = 1; len <= 213; len += 17) texts.push('ab3'.repeat(80).slice(0, len));
  const versions = new Set();
  for (const t of texts)
    for (const mask of [null, 0, 3, 5, 7]) {
      const qr = encodeQr(t, mask == null ? {} : { mask });
      const n = qr.size;
      assert.ok(finderOk(qr.modules, 0, 0) && finderOk(qr.modules, 0, n - 7) && finderOk(qr.modules, n - 7, 0), 'the finders');
      const d = decode(qr.modules);
      assert.equal(d.text, t);
      if (mask != null) assert.equal(d.mask, mask);
      versions.add(d.version);
    }
  assert.deepEqual([...versions].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(encodeQr('q'.repeat(214)), null, 'too long');
});

test('the SVG: one path, the quiet zone, null when too long', () => {
  const svg = qrSvg('HELLO');
  assert.match(svg, /^<svg [^>]*viewBox="0 0 29 29"/);
  assert.equal((svg.match(/<path /g) || []).length, 1);
  const qr = encodeQr('HELLO');
  // the path covers exactly the dark modules
  const d = qrPathData(qr.modules, 4);
  const area = [...d.matchAll(/h(\d+)v1/g)].reduce((s, x) => s + Number(x[1]), 0);
  assert.equal(area, qr.modules.flat().filter(Boolean).length);
  assert.equal(qrSvg('q'.repeat(214)), null);
});
