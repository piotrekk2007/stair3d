// Wspólna matematyka noska — używana przez stopień (treadGeometry.js), podstopień
// (riserGeometry.js) i policzek (stringerGeometry.js), żeby wszystkie trzy elementy
// zawsze zgadzały się co do tego, GDZIE dokładnie leży noskowana krawędź tylna stopnia.

const EPS = 1e-6;
export const sameAs = (p, q) => Math.abs(p.x - q.x) < EPS && Math.abs(p.y - q.y) < EPS;

// Przecięcie prostej (p1 + t*d1) z prostą (p2 + s*d2); zwraca punkt lub null gdy równoległe.
function lineIntersect(p1, d1, p2, d2) {
  const denom = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denom) < 1e-9) return null;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const t = (dx * d2.y - dy * d2.x) / denom;
  return { x: p1.x + t * d1.x, y: p1.y + t * d1.y };
}

// Wyznacza kierunek "na zewnątrz/do tyłu" (prostopadły do rearRiser, odwrócony od środka
// konturu) — ten sam test wszędzie, żeby znak nigdy się nie rozjechał między plikami.
export function outwardRearNormal(tread) {
  const { outline, rearRiser } = tread;
  const [inner0, outer0] = rearRiser;
  const rearDir = { x: outer0.x - inner0.x, y: outer0.y - inner0.y };
  let normal = { x: -rearDir.y, y: rearDir.x };
  const len = Math.hypot(normal.x, normal.y) || 1;
  normal = { x: normal.x / len, y: normal.y / len };

  let cx = 0, cy = 0;
  for (const p of outline) { cx += p.x; cy += p.y; }
  cx /= outline.length; cy /= outline.length;
  const toRear = { x: (inner0.x + outer0.x) / 2 - cx, y: (inner0.y + outer0.y) / 2 - cy };
  if (normal.x * toRear.x + normal.y * toRear.y < 0) {
    normal = { x: -normal.x, y: -normal.y };
  }
  return { normal, rearDir };
}

// Przesuwa tylną krawędź stopnia (rearRiser) o `distance` wzdłuż normalnej (dodatnie = na
// zewnątrz/do tyłu, jak przy nosku; ujemne = do wewnątrz/do przodu, jak przy cofaniu wangi
// pod podstopień), a boczne krawędzie (innerChain/outerChain) PRZEDŁUŻA wzdłuż ich własnego
// kierunku aż do przecięcia z tą przesuniętą prostą — dzięki temu boki zostają równoległe
// do wang nawet w zabiegu, gdzie tylna krawędź nie jest prostopadła do boków.
export function shiftRearEdge(tread, distance) {
  const { rearRiser, innerChain, outerChain } = tread;
  const [inner0, outer0] = rearRiser;
  if (distance === 0) return { newInner0: inner0, newOuter0: outer0 };

  const { normal, rearDir } = outwardRearNormal(tread);
  const shiftedRearPoint = { x: inner0.x + normal.x * distance, y: inner0.y + normal.y * distance };

  const innerNext = innerChain[1];
  const innerDir = { x: innerNext.x - inner0.x, y: innerNext.y - inner0.y };
  const newInner0 = lineIntersect(inner0, innerDir, shiftedRearPoint, rearDir) || {
    x: inner0.x + normal.x * distance,
    y: inner0.y + normal.y * distance,
  };

  const outerNext = outerChain[1];
  const outerDir = { x: outerNext.x - outer0.x, y: outerNext.y - outer0.y };
  const newOuter0 = lineIntersect(outer0, outerDir, shiftedRearPoint, rearDir) || {
    x: outer0.x + normal.x * distance,
    y: outer0.y + normal.y * distance,
  };

  return { newInner0, newOuter0 };
}
