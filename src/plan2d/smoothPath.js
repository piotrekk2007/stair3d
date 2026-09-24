// Smooth DISPLAY curve through a plan polyline (the walkline in the 2D plan). Pure and purely visual:
// the model keeps its exact points (walklineModel.js, the validator's winder-width check) — this only
// resamples a centripetal Catmull-Rom spline THROUGH them, so the drawn line is a smooth arc on a winder
// turn and stays exactly straight where the points are collinear. It passes through every input point.

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

function withoutDuplicates(points) {
  const out = [];
  for (const p of points) if (out.length === 0 || dist(out[out.length - 1], p) > 1e-6) out.push({ x: p.x, y: p.y });
  return out;
}

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// Barry-Goldman evaluation of the centripetal Catmull-Rom segment p1 -> p2 (p0, p3 are its neighbours).
function segmentPoint(p0, p1, p2, p3, u) {
  const t0 = 0;
  const t1 = t0 + Math.sqrt(dist(p0, p1));
  const t2 = t1 + Math.sqrt(dist(p1, p2));
  const t3 = t2 + Math.sqrt(dist(p2, p3));
  const t = t1 + (t2 - t1) * u;
  const a1 = lerp(p0, p1, (t - t0) / (t1 - t0));
  const a2 = lerp(p1, p2, (t - t1) / (t2 - t1));
  const a3 = lerp(p2, p3, (t - t2) / (t3 - t2));
  const b1 = lerp(a1, a2, (t - t0) / (t2 - t0));
  const b2 = lerp(a2, a3, (t - t1) / (t3 - t1));
  return lerp(b1, b2, (t - t1) / (t2 - t1));
}

/**
 * @param {{x:number,y:number}[]} points  the exact points to pass through
 * @param {number} [stepMm]  about how far apart the resampled points are
 * @returns {{x:number,y:number}[]}  a polyline that goes through every input point
 */
export function smoothPath(points, stepMm = 40) {
  const pts = withoutDuplicates(points || []);
  if (pts.length < 3) return pts;
  // ghost end points (a reflection of the neighbour), so the ends keep their direction
  const first = { x: 2 * pts[0].x - pts[1].x, y: 2 * pts[0].y - pts[1].y };
  const n = pts.length;
  const last = { x: 2 * pts[n - 1].x - pts[n - 2].x, y: 2 * pts[n - 1].y - pts[n - 2].y };
  const ext = [first, ...pts, last];
  const out = [pts[0]];
  for (let i = 1; i < n; i++) {
    const p0 = ext[i - 1];
    const p1 = ext[i];
    const p2 = ext[i + 1];
    const p3 = ext[i + 2];
    const samples = Math.max(1, Math.ceil(dist(p1, p2) / stepMm));
    for (let s = 1; s < samples; s++) out.push(segmentPoint(p0, p1, p2, p3, s / samples));
    out.push({ ...p2 });
  }
  return out;
}
