// Union of axis-aligned rectangles in a (u, v) plane, as closed outline polygons — pure, no Three.js.
//
// Used for a housed wanga's pockets (stringerConstructionGeometry.js housingPockets): a tread's housing and the
// riser's housing below it overlap, and consecutive steps' housings touch, so the pockets cut into the board's inner
// face are the UNION of those rectangles, not the rectangles themselves (overlapping holes cannot be triangulated).
// Method: coordinate-compressed grid of the rectangles' own edges, covered cells marked, and the boundary between a
// covered and an uncovered cell traced into loops (counter-clockwise around covered area). Only outer loops are
// returned (a region fully enclosed by pockets does not occur for housings); collinear points are merged.

const EPS = 1e-6;

/**
 * @param {{uStart:number, uEnd:number, vBottom:number, vTop:number}[]} rects
 * @returns {{u:number, v:number}[][]} outer outlines, counter-clockwise
 */
export function unionRectangles(rects) {
  const valid = rects.filter((r) => r.uEnd - r.uStart > EPS && r.vTop - r.vBottom > EPS);
  if (valid.length === 0) return [];
  const uniq = (vals) => [...new Set(vals.map((x) => Math.round(x * 1e6) / 1e6))].sort((a, b) => a - b);
  const us = uniq(valid.flatMap((r) => [r.uStart, r.uEnd]));
  const vs = uniq(valid.flatMap((r) => [r.vBottom, r.vTop]));
  const nu = us.length - 1;
  const nv = vs.length - 1;
  const covered = (i, j) => {
    if (i < 0 || j < 0 || i >= nu || j >= nv) return false;
    const cu = (us[i] + us[i + 1]) / 2;
    const cv = (vs[j] + vs[j + 1]) / 2;
    return valid.some((r) => cu > r.uStart && cu < r.uEnd && cv > r.vBottom && cv < r.vTop);
  };
  const grid = [];
  for (let i = 0; i < nu; i++) {
    grid.push([]);
    for (let j = 0; j < nv; j++) grid[i].push(covered(i, j));
  }
  const cell = (i, j) => i >= 0 && j >= 0 && i < nu && j < nv && grid[i][j];

  // directed boundary edges (grid index points), covered area on the LEFT -> CCW loops
  const edges = new Map(); // "i,j" -> list of next points
  const add = (a, b) => {
    const k = `${a[0]},${a[1]}`;
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push(b);
  };
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      if (!grid[i][j]) continue;
      if (!cell(i, j - 1)) add([i, j], [i + 1, j]); // bottom, left -> right
      if (!cell(i + 1, j)) add([i + 1, j], [i + 1, j + 1]); // right, up
      if (!cell(i, j + 1)) add([i + 1, j + 1], [i, j + 1]); // top, right -> left
      if (!cell(i - 1, j)) add([i, j + 1], [i, j]); // left, down
    }
  }

  const loops = [];
  while (edges.size > 0) {
    const [startKey, nexts] = edges.entries().next().value;
    let current = startKey.split(',').map(Number);
    const loop = [current];
    let next = nexts.shift();
    if (nexts.length === 0) edges.delete(startKey);
    while (next) {
      if (next[0] === loop[0][0] && next[1] === loop[0][1]) break;
      loop.push(next);
      const k = `${next[0]},${next[1]}`;
      const list = edges.get(k);
      if (!list || list.length === 0) break;
      current = next;
      next = list.shift();
      if (list.length === 0) edges.delete(k);
    }
    // close the loop's own start edge list if still pending
    const k0 = `${loop[0][0]},${loop[0][1]}`;
    const pending = edges.get(k0);
    if (pending && pending.length === 0) edges.delete(k0);
    const pts = loop.map(([i, j]) => ({ u: us[i], v: vs[j] }));
    const merged = mergeCollinear(pts);
    if (merged.length >= 3 && signedArea(merged) > EPS) loops.push(merged);
  }
  return loops;
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.u * q.v - q.u * p.v;
  }
  return a / 2;
}

function mergeCollinear(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[(i - 1 + pts.length) % pts.length];
    const p = pts[i];
    const next = pts[(i + 1) % pts.length];
    const cross = (p.u - prev.u) * (next.v - p.v) - (p.v - prev.v) * (next.u - p.u);
    if (Math.abs(cross) > EPS) out.push(p);
  }
  return out;
}

/** Point strictly inside or on the boundary of a simple polygon (even-odd rule, boundary counted inside). */
export function pointInPolygonUV(p, poly, tolerance = 1e-6) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    // on the edge?
    const cross = (b.u - a.u) * (p.v - a.v) - (b.v - a.v) * (p.u - a.u);
    const dot = (p.u - a.u) * (b.u - a.u) + (p.v - a.v) * (b.v - a.v);
    const len2 = (b.u - a.u) ** 2 + (b.v - a.v) ** 2;
    if (Math.abs(cross) <= tolerance * Math.sqrt(len2 || 1) && dot >= -tolerance && dot <= len2 + tolerance) return true;
    if (a.v > p.v !== b.v > p.v && p.u < ((b.u - a.u) * (p.v - a.v)) / (b.v - a.v) + a.u) inside = !inside;
  }
  return inside;
}
