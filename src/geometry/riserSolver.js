// RiserModel / RiserGeometryData — plain-data description of one podstopień, fully
// independent of Three.js. riserRenderer.js is the ONLY consumer that turns this into
// THREE.BufferGeometry.
//
// This model exists specifically so the "for some winder treads the riser is too wide or
// rotated" class of bug is detectable by inspecting `panels` and `directionSpreadDeg`
// directly — BEFORE any THREE.BufferGeometry exists. See
// src/geometry/__tests__/riserModel.test.js, and docs/architecture/CONSOLIDATION.md for the
// history of that bug.
//
// --- NOMINAL vs FINAL (see docs/architecture/CONSTRAINTS_AND_VALIDATION.md) --------------
//
// A riser board fills the gap under THIS tread's OWN frontEdge (czoło) — the same boundary
// TreadModel already splits into nominal/final (treadSolver.js). Before this fix, this file
// read `tread.innerChain`/`tread.outerChain` (straight/landing) or `tread.winderInfo.frontEdge`
// (winder) OPPORTUNISTICALLY, purely because those fields happened to exist — both are RAW/
// NOMINAL construction data, never touched by edgeOverrides.js, so a manual tread-edge edit
// silently never reached the riser panel. That was an undetected architectural gap (found via
// a full manual-edit trace, not a unit test), inconsistent with StringerModel's own explicit
// reference-line-vs-bearing split.
//
// The fix makes the choice EXPLICIT per quantity, using the SAME nominal/final source
// treadSolver.js already computes (`nominalEdgesOf`/`edgesEqual`, exported from there — one
// canonical answer to "what was this boundary before any edit", not one per solver):
//
//   - PANEL ENDPOINTS (the physical, visible boundary of the riser board) — always FINAL
//     (`tread.frontEdge`, i.e. `RiserModel.frontEdge.final`). This is the thing a manual edit
//     is supposed to change, and now does.
//   - PANEL DIRECTION for a WINDER riser's fan — stays the NOMINAL construction-reference
//     direction (`tread.winderInfo.frontEdge.innerDirection`/`outerDirection`). There is no
//     independently-computed "final direction" for a winder boundary — direction comes from
//     the solved turn geometry, not from a single dragged point — so treating it as anything
//     but a construction reference would be inventing geometry, not deriving it. This is a
//     DELIBERATE, DOCUMENTED choice (see requirement 5 in the task that produced this file's
//     current shape), not an oversight: `RiserModel.frontEdge.nominal` stays exposed
//     specifically so a future construction/manufacturing rule can compare final-vs-nominal
//     explicitly, rather than the choice being hidden inside an `if (tread.innerChain)` branch.
//   - PANEL DIRECTION for a straight/landing riser — derived from the tread's actual (already
//     FINAL — edgeOverrides.js mutates `tread.outline`/`tread.frontEdge` together) outline, via
//     the same `outwardNormalFromOutline` every other element uses. No separate nominal
//     reconstruction needed here, unlike the winder case.

import { normalizeVector } from './pathUtils.js';
import { outwardNormalFromOutline } from './nosingUtils.js';
import { edgesEqual, nominalEdgesOf } from './treadSolver.js';

// Liczba paneli, na jakie rozbijamy podstopień stopnia ZABIEGOWEGO. 2 to najmniejsza liczba,
// która w ogóle pozwala podstopniowi "złożyć się" (V-fold) między dwoma niezgodnymi
// kierunkami krawędzi wewnętrznej i zewnętrznej, zamiast być jednym, błędnie zorientowanym
// płaskim panelem. Nazwana stała zgodnie z .claude/RULES.md regułą 11/12.
export const WINDER_RISER_FAN_PANELS = 2;

function lerpPoint(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function blendDirection(a, b, t) {
  return normalizeVector({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
}

function panelWidth(p0, p1) {
  return Math.hypot(p1.x - p0.x, p1.y - p0.y);
}

// Kąt (w stopniach) między dwoma kierunkami jednostkowymi — 0° = zgodne, 90° = prostopadłe.
// To jest dokładnie ta liczba, która pozwala wykryć "nienaturalnie obrócony podstopień" NA
// POZIOMIE DANYCH: duży directionSpreadDeg oznacza, że strona wewnętrzna i zewnętrzna
// patrzą w wyraźnie różne strony, więc pojedynczy płaski panel byłby geometrycznie
// niepoprawny — dokładnie to ustalenie doprowadziło do wachlarza paneli.
export function angleBetweenDeg(a, b) {
  const cross = a.x * b.y - a.y * b.x;
  const dot = a.x * b.x + a.y * b.y;
  return (Math.atan2(Math.abs(cross), dot) * 180) / Math.PI;
}

/**
 * @typedef {Object} RiserPanel
 * @property {{x:number,y:number}} p0
 * @property {{x:number,y:number}} p1
 * @property {{x:number,y:number}} direction  Kierunek "wzdłuż biegu" (forward-like) dla tego
 *   panelu — renderer neguje go, żeby dostać rzeczywistą normalną wytłoczenia. Dla zabiegu
 *   jest to kierunek KONSTRUKCYJNY/NOMINALNY (patrz nagłówek pliku); dla prostego/podestu —
 *   liczony z aktualnego (czyli już FINALNEGO) konturu stopnia.
 * @property {number} width  mm, hypot(p1-p0) — bezpośrednio testowalne bez Three.js.
 */

/**
 * @typedef {Object} RiserFrontEdge
 * @property {[{x:number,y:number},{x:number,y:number}]} nominal  [inner, outer] — konstrukcyjny
 *   punkt odniesienia, z SUROWEGO łańcucha stopnia (ta sama funkcja co
 *   `TreadModel.frontEdge.nominal` — patrz treadSolver.js `nominalEdgesOf`). NIGDY nie jest
 *   źródłem pozycji panelu — wystawiony wyłącznie po to, żeby przyszła reguła konstrukcyjna/
 *   produkcyjna mogła jawnie porównać final względem nominal.
 * @property {[{x:number,y:number},{x:number,y:number}]} final  [inner, outer] —
 *   `tread.frontEdge`, czyli PO ewentualnej ręcznej edycji krawędzi. Z TEGO liczona jest
 *   rzeczywista geometria panelu podstopnia.
 * @property {boolean} overridden  True, jeśli final różni się od nominal na którymkolwiek końcu.
 */

/**
 * @typedef {Object} RiserModel
 * @property {string} riserId    e.g. "riser-3"
 * @property {string} stepId     e.g. "step-3" — którego stopnia czoło ten podstopień wypełnia.
 * @property {'straight'|'winder'|'landing'} type
 * @property {{bottom:number, top:number}} elevation
 * @property {number} thickness  mm
 * @property {boolean} inward    Czy grubość idzie do wnętrza schodów (stopień) czy na
 *   zewnątrz (podest) — patrz historyczny komentarz w git log tego pliku.
 * @property {RiserFrontEdge} frontEdge  Nominal/final split — patrz nagłówek pliku.
 * @property {RiserPanel[]} panels  1 panel (prosty/podest) albo WINDER_RISER_FAN_PANELS
 *   (zabieg) — ZAWSZE zbudowane z `frontEdge.final`.
 * @property {number} directionSpreadDeg  0 dla prostego/podestu; kąt między kierunkiem
 *   wewnętrznym i zewnętrznym dla zabiegu — DIAGNOSTYKA problemu "zbyt szeroki/obrócony".
 * @property {number} maxPanelWidth  mm — DIAGNOSTYKA: nienaturalnie duża wartość sygnalizuje
 *   problem geometryczny zanim powstanie jakikolwiek mesh.
 */

function buildFrontEdgeInfo(tread) {
  const nominal = nominalEdgesOf(tread).front;
  const final = tread.frontEdge;
  return { nominal, final, overridden: !edgesEqual(nominal, final) };
}

// Zabieg: punkty KOŃCOWE panelu(-i) liczone z finalEdge (po edycji); KIERUNEK zostaje
// konstrukcyjny/nominalny — patrz uzasadnienie w nagłówku pliku.
function buildWinderPanels(tread, finalEdge) {
  const { innerDirection, outerDirection } = tread.winderInfo.frontEdge;
  const [inner, outer] = finalEdge;
  const points = [];
  for (let i = 0; i <= WINDER_RISER_FAN_PANELS; i++) points.push(lerpPoint(inner, outer, i / WINDER_RISER_FAN_PANELS));

  const panels = [];
  for (let i = 0; i < WINDER_RISER_FAN_PANELS; i++) {
    const tMid = (i + 0.5) / WINDER_RISER_FAN_PANELS;
    const direction = blendDirection(innerDirection, outerDirection, tMid);
    panels.push({ p0: points[i], p1: points[i + 1], direction, width: panelWidth(points[i], points[i + 1]) });
  }
  return { panels, directionSpreadDeg: angleBetweenDeg(innerDirection, outerDirection) };
}

// Prosty/podest: JEDEN panel, punkty końcowe I kierunek liczone z aktualnego (już FINALNEGO —
// edgeOverrides.js mutuje `tread.outline`/`tread.frontEdge` razem) konturu stopnia. W
// przeciwieństwie do zabiegu, tu jest dostępny niezależnie policzalny "finalny" kierunek, więc
// nie ma powodu sięgać po osobną nominalną rekonstrukcję.
function buildStraightOrLandingPanel(tread, finalEdge) {
  const { normal } = outwardNormalFromOutline({ outline: tread.outline, frontEdge: tread.frontEdge });
  const direction = { x: -normal.x, y: -normal.y };
  const [inner, outer] = finalEdge;
  return { panels: [{ p0: inner, p1: outer, direction, width: panelWidth(inner, outer) }], directionSpreadDeg: 0 };
}

/**
 * @param {import('./planLayout.js').Tread} tread
 * @param {Object} config  Full staircase config, plus `riserHeight`
 * @returns {RiserModel}
 */
export function buildRiserModel(tread, config) {
  const { riserHeight, treadThickness, nosing, riserBoardThickness } = config;
  const isLanding = tread.type === 'landing';
  // Podest nie ma noska — nie ma szczeliny do wypełnienia według `nosing`; tam podstopień
  // zachowuje swoją niezależnie skonfigurowaną grubość i "na zewnątrz" zamiast "do wnętrza".
  const thickness = isLanding ? riserBoardThickness : nosing;
  const inward = !isLanding;

  // Góra podstopnia i-tego = spód i-tego stopnia (patrz treadSolver.js: spód = (i+1)*h -
  // grubość_stopnia); cała bryła obniżona o treadThickness względem teoretycznej linii
  // podziału (index*riserHeight), bo góra podstopnia dochodzi do SPODU wyższego stopnia.
  const top = tread.index * riserHeight + riserHeight - treadThickness;
  const bottom = tread.index * riserHeight - treadThickness;

  const frontEdge = buildFrontEdgeInfo(tread);
  const { panels, directionSpreadDeg } = tread.type === 'winder' ? buildWinderPanels(tread, frontEdge.final) : buildStraightOrLandingPanel(tread, frontEdge.final);

  return {
    riserId: `riser-${tread.index}`,
    stepId: `step-${tread.index}`,
    type: tread.type,
    elevation: { bottom, top },
    thickness,
    inward,
    frontEdge,
    panels,
    directionSpreadDeg,
    maxPanelWidth: Math.max(...panels.map((p) => p.width)),
  };
}

// Pomija stopnie, dla których podstopień miałby zerową/ujemną grubość (config niespójny albo
// hasRiserBoards wyłączone) — filtrowanie na poziomie WSADU modeli, nie wewnątrz buildRiserModel
// (który zawsze opisuje "jak wyglądałby podstopień", niezależnie od tego, czy ma sens go pokazać).
export function buildRiserModels(planLayout, config) {
  if (!config.hasRiserBoards) return [];
  return planLayout.treads.map((tread) => buildRiserModel(tread, config)).filter((model) => model.thickness > 0);
}
