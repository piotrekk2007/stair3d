import * as THREE from 'three';
import { buildPrism, planToWorld } from './geometryUtils.js';
import { shiftRearEdge } from './nosingUtils.js';

const CORNER_JOIN_EPS = 1; // mm, tolerancja dopasowania punktu do załamania

function sameAs(p, q) {
  return Math.abs(p.x - q.x) < CORNER_JOIN_EPS && Math.abs(p.y - q.y) < CORNER_JOIN_EPS;
}

// Gdy brak słupa narożnego, panele stykające się z ostrym załamaniem policzka (Oc dla
// zewnętrznego, IcFront dla wewnętrznego przy podeście) są wydłużane o grubość policzka
// wzdłuż własnego kierunku — zamiast pustki po słupie powstaje zakładka, w której oba
// panele fizycznie się przenikają na styku (prosty odpowiednik złącza na zakładkę).
function extendToCloseCorner(p0, p1, bendPoints, extendBy) {
  if (!bendPoints || bendPoints.length === 0) return [p0, p1];
  const dir = { x: p1.x - p0.x, y: p1.y - p0.y };
  const len = Math.hypot(dir.x, dir.y) || 1;
  const ux = dir.x / len, uy = dir.y / len;
  let out0 = p0, out1 = p1;
  for (const bp of bendPoints) {
    if (sameAs(p0, bp)) out0 = { x: p0.x - ux * extendBy, y: p0.y - uy * extendBy };
    if (sameAs(p1, bp)) out1 = { x: p1.x + ux * extendBy, y: p1.y + uy * extendBy };
  }
  return [out0, out1];
}

function outwardNormal(p0, p1, refCentroid) {
  const dir = { x: p1.x - p0.x, y: p1.y - p0.y };
  let n = { x: -dir.y, y: dir.x };
  const len = Math.hypot(n.x, n.y) || 1;
  n = { x: n.x / len, y: n.y / len };
  const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const toOutside = { x: mid.x - refCentroid.x, y: mid.y - refCentroid.y };
  if (n.x * toOutside.x + n.y * toOutside.y < 0) n = { x: -n.x, y: -n.y };
  return n;
}

function centroid(outline) {
  let cx = 0, cy = 0;
  for (const p of outline) { cx += p.x; cy += p.y; }
  return { x: cx / outline.length, y: cy / outline.length };
}

// Buduje panel prostokątny (widok boczny: [u0..u1] x [zBottom..zTop]) leżący na odcinku (p0,p1).
// Wyciągnięty DO WEWNĄTRZ (pod stopień) — zewnętrzna, widoczna ściana policzka leży dokładnie
// na krawędzi stopnia (flush), a nie wystaje na zewnątrz o grubość policzka. To standardowa
// konstrukcja policzka wycinanego: stopień "siedzi" na policzku, jego bok wyznacza lico.
function buildFlatPanel(p0, p1, zBottom, zTop, refCentroid, stringerThickness) {
  const n = outwardNormal(p0, p1, refCentroid);
  const dir = { x: p1.x - p0.x, y: p1.y - p0.y };
  const segLen = Math.hypot(dir.x, dir.y);
  if (segLen < 1e-6 || zTop <= zBottom) return null;
  const ux = dir.x / segLen;
  const uy = dir.y / segLen;

  const toWorld = (u, v) => {
    const px = p0.x + ux * u;
    const py = p0.y + uy * u;
    return planToWorld(px, py, v);
  };

  const pts2D = [
    { u: 0, v: zBottom },
    { u: segLen, v: zBottom },
    { u: segLen, v: zTop },
    { u: 0, v: zTop },
  ];

  const extrudeDir = new THREE.Vector3(-n.x, 0, n.y);
  return buildPrism(pts2D, toWorld, extrudeDir, stringerThickness);
}

// side: 'outer' | 'inner'
export function buildStringerGeometries(planLayout, config, side) {
  const { riserHeight, treadThickness } = config;
  const { stringerHeight, stringerThickness } = config;
  const geometries = [];

  const bendPoints = config.hasCornerPost
    ? []
    : planLayout.turns
        .map((t) => (side === 'outer' ? t.outerBendPoint : t.innerBendPoint))
        .filter(Boolean);

  // Wanga to BAZA: zygzak liczony z surowych punktów łańcucha (chain), czyli bazowej
  // (nienoskowanej) głębokości stopnia. Jedyny wyjątek: gdy są podstopnie, wanga oddaje
  // im miejsce od strony tylnej krawędzi stopnia — cofa się o dokładnie `nosing`, żeby
  // w powstałą szczelinę (między surową linią konstrukcyjną a nowym, cofniętym licem wangi)
  // wszedł podstopień i uzupełnił ten ubytek (patrz riserGeometry.js — grubość podstopnia
  // jest wtedy równa `nosing`, żeby dokładnie wypełnić tę szczelinę, bez szpary i bez zakładki).
  for (const tread of planLayout.treads) {
    const chain = side === 'outer' ? tread.outerChain : tread.innerChain;
    if (!chain || chain.length < 2) continue;

    const ref = centroid(tread.outline);
    // Siedzisko (spód stopnia) i-tego stopnia = góra i-tego podstopnia minus grubość stopnia.
    const zGoing = (tread.index + 1) * riserHeight - treadThickness;
    const zBottom = zGoing - stringerHeight;

    const recess = config.hasRiserBoards && tread.type !== 'landing' ? config.nosing : 0;

    for (let j = 0; j < chain.length - 1; j++) {
      let [p0, p1] = extendToCloseCorner(chain[j], chain[j + 1], bendPoints, stringerThickness);
      if (j === 0 && recess > 0) {
        const shifted = shiftRearEdge(tread, -recess);
        p0 = side === 'outer' ? shifted.newOuter0 : shifted.newInner0;
      }
      const geo = buildFlatPanel(p0, p1, zBottom, zGoing, ref, stringerThickness);
      if (geo) geometries.push(geo);
    }
  }

  return geometries;
}
