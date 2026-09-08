export function cumulativeDistances(vertices) {
  const cum = [0];
  for (let i = 1; i < vertices.length; i++) {
    const dx = vertices[i].x - vertices[i - 1].x;
    const dy = vertices[i].y - vertices[i - 1].y;
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  return cum;
}

export function pathLength(vertices) {
  const cum = cumulativeDistances(vertices);
  return cum[cum.length - 1];
}

export function pointAtDistance(vertices, cum, d) {
  const total = cum[cum.length - 1];
  const clamped = Math.max(0, Math.min(total, d));
  for (let i = 1; i < cum.length; i++) {
    if (clamped <= cum[i] || i === cum.length - 1) {
      const segLen = cum[i] - cum[i - 1];
      const t = segLen === 0 ? 0 : (clamped - cum[i - 1]) / segLen;
      return {
        x: vertices[i - 1].x + (vertices[i].x - vertices[i - 1].x) * t,
        y: vertices[i - 1].y + (vertices[i].y - vertices[i - 1].y) * t,
      };
    }
  }
  return vertices[vertices.length - 1];
}

// Zwraca punkty ścieżki od odległości d0 do d1 (włącznie), w tym wierzchołki pośrednie (np. narożnik).
export function subPathPoints(vertices, cum, d0, d1) {
  const total = cum[cum.length - 1];
  const a = Math.max(0, Math.min(total, d0));
  const b = Math.max(0, Math.min(total, d1));
  const pts = [pointAtDistance(vertices, cum, a)];
  for (let i = 0; i < vertices.length; i++) {
    if (cum[i] > a && cum[i] < b) pts.push(vertices[i]);
  }
  pts.push(pointAtDistance(vertices, cum, b));
  return pts;
}
