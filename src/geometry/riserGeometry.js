import * as THREE from 'three';
import { buildPrism, planToWorld } from './geometryUtils.js';
import { outwardRearNormal } from './nosingUtils.js';

// Jeden podstopień na stopień, budowany z jego SUROWEJ (strukturalnej) KRAWĘDZI TYLNEJ
// (rearRiser) — czyli granicy między poprzednim poziomem (albo podłogą, dla pierwszego
// stopnia) a tym stopniem. Dzięki temu automatycznie wychodzi też podstopień przy samej
// podłodze (dla stopnia 0), a nie tylko między kolejnymi stopniami.
//
// Tylna ściana podstopnia opiera się DOKŁADNIE na surowej, konstrukcyjnej linii tylnej
// krawędzi stopnia. Dla zwykłego stopnia grubość idzie DO WEWNĄTRZ (w stronę środka stopnia)
// — dokładnie w tę szczelinę, o którą w tym samym miejscu cofa się wanga (patrz
// stringerGeometry.js) — więc podstopień dokładnie ją wypełnia, styka się z nowym, cofniętym
// licem wangi bez szpary i bez kolizji z noskiem, który swobodnie zwisa przed nim w powietrzu.
// Dla podestu (bez noska, bez cofniętej wangi) grubość idzie po staremu NA ZEWNĄTRZ, żeby
// podstopień zwyczajnie zwisał pod krawędzią podestu.
//
// Cała bryła jest obniżona o `treadThickness` względem teoretycznej linii podziału
// (index*riserHeight) — bo góra podstopnia ma dochodzić do SPODU (nie do wierzchu) wyższego
// stopnia, a spód stopnia leży dokładnie `treadThickness` poniżej jego teoretycznego poziomu.
function buildOneRiserBoard(tread, riserHeight, treadThickness, thickness, inward) {
  const zTop = tread.index * riserHeight + riserHeight - treadThickness;
  const zBottom = tread.index * riserHeight - treadThickness;

  const [inner0, outer0] = tread.rearRiser;
  const { normal } = outwardRearNormal(tread);

  const dir = { x: outer0.x - inner0.x, y: outer0.y - inner0.y };
  const width = Math.hypot(dir.x, dir.y);
  if (width < 1e-6) return null;
  const ux = dir.x / width;
  const uy = dir.y / width;

  const toWorld = (u, v) => {
    const px = inner0.x + ux * u;
    const py = inner0.y + uy * u;
    return planToWorld(px, py, v);
  };

  const pts2D = [
    { u: 0, v: zBottom },
    { u: width, v: zBottom },
    { u: width, v: zTop },
    { u: 0, v: zTop },
  ];

  const sign = inward ? -1 : 1;
  const extrudeDir = new THREE.Vector3(sign * normal.x, 0, -sign * normal.y);
  return buildPrism(pts2D, toWorld, extrudeDir, thickness);
}

export function buildRiserBoards(planLayout, config) {
  const { riserHeight, treadThickness, nosing, riserBoardThickness } = config;
  const geometries = [];
  for (const tread of planLayout.treads) {
    const isLanding = tread.type === 'landing';
    // Podest nie ma noska — nie ma więc szczeliny do wypełnienia według `nosing`; tam
    // podstopień zachowuje swoją niezależnie skonfigurowaną grubość i stary kierunek.
    const thickness = isLanding ? riserBoardThickness : nosing;
    if (thickness <= 0) continue;
    const geo = buildOneRiserBoard(tread, riserHeight, treadThickness, thickness, !isLanding);
    if (geo) geometries.push(geo);
  }
  return geometries;
}
